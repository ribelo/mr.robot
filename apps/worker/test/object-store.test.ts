/**
 * The S3 side of the Files bucket (v1.16 ticket 06): the URLs the Worker signs and the control calls of a multipart upload, against a
 * recorded fetch (no network). The XML in the answers is as S3 documents it.
 */
import { describe, expect, it } from 'vitest'
import { parseS3Credentials, s3ObjectStore, ObjectStoreError, type S3Credentials } from '../src/workspace/object-store.ts'

const credentials: S3Credentials = { endpoint: 'https://acct.r2.cloudflarestorage.com', bucketName: 'files', region: 'auto', accessKeyId: 'AKID', secretAccessKey: 'secret' }

function recorded(answers: Response[]) {
  const seen: Array<{ method: string; url: string; body: string; authorization: string | null }> = []
  const fetcher = (async (input: Request | string) => {
    const request = input as Request
    seen.push({ method: request.method, url: request.url, body: await request.clone().text(), authorization: request.headers.get('authorization') })
    return answers.shift() ?? new Response('', { status: 500 })
  }) as typeof fetch
  return { fetcher, seen }
}

describe('presign', () => {
  it('signs a GET for one key in path style, with the expiry in the query and the key\'s slashes kept', async () => {
    const store = s3ObjectStore(credentials, recorded([]).fetcher)
    const url = new URL(await store.presign({ method: 'GET', key: 'robots/r-1/in box/a b.bin', expiresSeconds: 900 }))
    expect(url.origin).toBe('https://acct.r2.cloudflarestorage.com')
    expect(url.pathname).toBe('/files/robots/r-1/in%20box/a%20b.bin')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^AKID\/\d{8}\/auto\/s3\/aws4_request$/)
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('puts the part number and the upload id into the signed query of a part', async () => {
    const store = s3ObjectStore(credentials, recorded([]).fetcher)
    const url = new URL(await store.presign({ method: 'PUT', key: 'robots/r-1/big.bin', query: { partNumber: '3', uploadId: 'UP1' }, expiresSeconds: 60 }))
    expect(url.searchParams.get('partNumber')).toBe('3')
    expect(url.searchParams.get('uploadId')).toBe('UP1')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
  })
})

describe('multipart control calls', () => {
  it('starts an upload with POST ?uploads and reads the upload id from the XML', async () => {
    const { fetcher, seen } = recorded([new Response('<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>files</Bucket><Key>k</Key><UploadId>VXBsb2FkSUQ</UploadId></InitiateMultipartUploadResult>')])
    expect(await s3ObjectStore(credentials, fetcher).startMultipart('robots/r-1/big.bin')).toBe('VXBsb2FkSUQ')
    expect(seen[0]).toMatchObject({ method: 'POST', url: 'https://acct.r2.cloudflarestorage.com/files/robots/r-1/big.bin?uploads=' })
    expect(seen[0]!.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//)
  })

  it('completes with the parts in order, each with its number and ETag', async () => {
    const { fetcher, seen } = recorded([new Response('<CompleteMultipartUploadResult><ETag>"abc-2"</ETag></CompleteMultipartUploadResult>')])
    await s3ObjectStore(credentials, fetcher).completeMultipart('robots/r-1/big.bin', 'UP1', [{ number: 2, etag: '"b"' }, { number: 1, etag: '"a"' }])
    expect(seen[0]).toMatchObject({ method: 'POST', url: 'https://acct.r2.cloudflarestorage.com/files/robots/r-1/big.bin?uploadId=UP1' })
    expect(seen[0]!.body).toBe('<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;a&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;b&quot;</ETag></Part></CompleteMultipartUpload>')
  })

  it('treats an error inside a 200 answer, a refusal and a dead network as failures with words', async () => {
    const inside = recorded([new Response('<Error><Code>InvalidPart</Code><Message>one or more parts</Message></Error>', { status: 200 })])
    await expect(s3ObjectStore(credentials, inside.fetcher).completeMultipart('k', 'UP', [])).rejects.toThrow('end of the upload: R2 answered 200 InvalidPart')
    const refused = recorded([new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })])
    await expect(s3ObjectStore(credentials, refused.fetcher).abortMultipart('k', 'UP')).rejects.toBeInstanceOf(ObjectStoreError)
    const down = (async () => { throw new TypeError('offline') }) as typeof fetch
    await expect(s3ObjectStore(credentials, down).startMultipart('k')).rejects.toThrow('R2 could not be reached (offline)')
  })

  it('aborts with DELETE ?uploadId', async () => {
    const { fetcher, seen } = recorded([new Response(null, { status: 204 })])
    await s3ObjectStore(credentials, fetcher).abortMultipart('robots/r-1/big.bin', 'UP1')
    expect(seen[0]).toMatchObject({ method: 'DELETE', url: 'https://acct.r2.cloudflarestorage.com/files/robots/r-1/big.bin?uploadId=UP1' })
  })
})

describe('the credentials secret', () => {
  it('reads what Alchemy writes and nothing else', () => {
    expect(parseS3Credentials(JSON.stringify({ ...credentials, endpoint: 'https://acct.r2.cloudflarestorage.com/' }))).toEqual(credentials)
    expect(parseS3Credentials(undefined)).toBeUndefined()
    expect(parseS3Credentials('not json')).toBeUndefined()
    expect(parseS3Credentials(JSON.stringify({ endpoint: 'https://x', bucketName: 'files' }))).toBeUndefined()
  })
})
