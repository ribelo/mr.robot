/**
 * R2 through its S3 API (v1.16 ticket 06): the one place that signs. The Worker mints presigned URLs for a Host app or ws and makes the small
 * control calls of a multipart upload (create, complete, abort) itself; every byte of a file goes between the client and R2. The credentials
 * are the Files bucket's S3 credentials from the Alchemy stack (an R2 API token scoped to that bucket), held as a Worker secret.
 */
import { AwsClient } from 'aws4fetch'
import * as Data from 'effect/Data'
import * as Schema from 'effect/Schema'

const NonEmpty = Schema.String.check(Schema.isMinLength(1))

/** What Alchemy's Cloudflare.R2.S3Credentials delivers to the Worker, as JSON. */
export const S3Credentials = Schema.Struct({
  endpoint: NonEmpty,
  bucketName: NonEmpty,
  region: Schema.Literal('auto'),
  accessKeyId: NonEmpty,
  secretAccessKey: NonEmpty,
})
export type S3Credentials = typeof S3Credentials.Type

const parseCredentialsJson = Schema.decodeUnknownOption(Schema.fromJsonString(S3Credentials))

/** The credentials in the secret, or undefined when there is none or it is not what Alchemy writes. */
export function parseS3Credentials(raw: string | undefined): S3Credentials | undefined {
  if (raw === undefined || raw === '') return undefined
  const parsed = parseCredentialsJson(raw)
  return parsed._tag === 'None' ? undefined : { ...parsed.value, endpoint: parsed.value.endpoint.replace(/\/+$/, '') }
}

/** One part of a multipart upload as the client reported it: its number and the ETag R2 returned for it. */
export interface CompletedPart {
  readonly number: number
  readonly etag: string
}

/** A control call to R2 that did not succeed; the message is for the Robot. */
export class ObjectStoreError extends Data.TaggedError('ObjectStoreError')<{ readonly message: string }> {}

export interface ObjectStore {
  /** A URL that lets its holder GET or PUT one object (or one part of a multipart upload, with its query) until it expires. */
  presign(request: { readonly method: 'GET' | 'PUT'; readonly key: string; readonly query?: Readonly<Record<string, string>>; readonly expiresSeconds: number }): Promise<string>
  /** Begin a multipart upload; its upload id. */
  startMultipart(key: string): Promise<string>
  completeMultipart(key: string, uploadId: string, parts: readonly CompletedPart[]): Promise<void>
  abortMultipart(key: string, uploadId: string): Promise<void>
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The S3 API of one bucket, signed with aws4fetch. `fetcher` is the network; tests give a recorded one. */
export function s3ObjectStore(credentials: S3Credentials, fetcher: typeof fetch = fetch): ObjectStore {
  const client = new AwsClient({ accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, service: 's3', region: credentials.region })
  const urlOf = (key: string, query: Readonly<Record<string, string>> = {}): URL => {
    const url = new URL(`${credentials.endpoint}/${encodeURIComponent(credentials.bucketName)}/${key.split('/').map(encodeURIComponent).join('/')}`)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    return url
  }
  /** One signed control call; its body text, or an ObjectStoreError that says what R2 answered. */
  const control = async (what: string, method: 'POST' | 'DELETE', url: URL, body?: string): Promise<string> => {
    const signed = await client.sign(url.toString(), { method, ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/xml' } }) })
    const response = await fetcher(signed).catch((error: unknown) => {
      throw new ObjectStoreError({ message: `${what}: R2 could not be reached (${error instanceof Error ? error.message : String(error)})` })
    })
    const text = await response.text()
    // S3 can answer a completed call with 200 and an error in the body.
    if (!response.ok || /<Error>/.test(text)) {
      const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1]
      throw new ObjectStoreError({ message: `${what}: R2 answered ${response.status}${code === undefined ? '' : ` ${code}`}` })
    }
    return text
  }
  return {
    presign: async ({ method, key, query, expiresSeconds }) => {
      const url = urlOf(key, { ...query, 'X-Amz-Expires': String(expiresSeconds) })
      return (await client.sign(url.toString(), { method, aws: { signQuery: true } })).url
    },
    startMultipart: async (key) => {
      const text = await control('start of the upload', 'POST', urlOf(key, { uploads: '' }))
      const id = /<UploadId>([^<]+)<\/UploadId>/.exec(text)?.[1]
      if (id === undefined) throw new ObjectStoreError({ message: 'start of the upload: R2 gave no upload id' })
      return id
    },
    completeMultipart: async (key, uploadId, parts) => {
      const body = `<CompleteMultipartUpload>${[...parts].sort((a, b) => a.number - b.number).map((part) => `<Part><PartNumber>${part.number}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
      await control('end of the upload', 'POST', urlOf(key, { uploadId }), body)
    },
    abortMultipart: async (key, uploadId) => {
      await control('abort of the upload', 'DELETE', urlOf(key, { uploadId }))
    },
  }
}
