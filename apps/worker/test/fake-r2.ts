/**
 * R2 as its S3 API shows it to a client holding a presigned URL (v1.16 ticket 06): the test's stand-in for the network. A request is answered
 * from the FILES binding, so that what a Host app or ws sends can be read back from the bucket. The Worker's real signer made the URL; this
 * only checks it is one (host, bucket, a signature, an expiry) and plays the PUT, the part PUT and the ranged GET.
 */
import { s3ObjectStore, type ObjectStore, type S3Credentials } from '../src/workspace/object-store.ts'

export const testCredentials: S3Credentials = { endpoint: 'https://test-account.r2.cloudflarestorage.com', bucketName: 'files', region: 'auto', accessKeyId: 'AKIATESTKEY', secretAccessKey: 'test-secret' }

/** What the fake R2 was asked, newest last. */
export const r2Log: Array<{ method: string; key: string; part?: number; range?: string; expires: number }> = []
/** The next requests answered with a 500, to see retries. */
export const r2Faults = { next: 0 }

export function fakeR2(bucket: R2Bucket): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init = {}) => {
    const parsed = new URL(url)
    const method = (init.method ?? 'GET').toUpperCase()
    const prefix = `/${testCredentials.bucketName}/`
    if (parsed.origin !== testCredentials.endpoint || !parsed.pathname.startsWith(prefix)) return new Response('wrong host or bucket', { status: 403 })
    const key = decodeURIComponent(parsed.pathname.slice(prefix.length))
    const expires = Number(parsed.searchParams.get('X-Amz-Expires'))
    if (!(parsed.searchParams.get('X-Amz-Signature') ?? '').match(/^[0-9a-f]{64}$/) || !parsed.searchParams.get('X-Amz-Credential')?.startsWith(`${testCredentials.accessKeyId}/`) || !(expires >= 1 && expires <= 604_800)) return new Response('not a presigned URL', { status: 403 })
    const uploadId = parsed.searchParams.get('uploadId')
    const part = parsed.searchParams.get('partNumber')
    const range = new Headers(init.headers).get('range') ?? undefined
    r2Log.push({ method, key, ...(part === null ? {} : { part: Number(part) }), ...(range === undefined ? {} : { range }), expires })
    if (r2Faults.next > 0) {
      r2Faults.next--
      return new Response('slow down', { status: 500 })
    }
    if (method === 'PUT') {
      const body = init.body === undefined || init.body === null ? new Uint8Array() : new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer())
      if (uploadId !== null && part !== null) {
        const uploaded = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(Number(part), body)
        return new Response(null, { status: 200, headers: { etag: uploaded.etag } })
      }
      const object = await bucket.put(key, body)
      return new Response(null, { status: 200, headers: { etag: object?.httpEtag ?? '' } })
    }
    if (method === 'GET') {
      const wanted = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')
      const object = await bucket.get(key, wanted === null ? undefined : { range: { offset: Number(wanted[1]), length: Number(wanted[2]) - Number(wanted[1]) + 1 } })
      if (object === null) return new Response('no such key', { status: 404 })
      return new Response(object.body, { status: wanted === null ? 200 : 206 })
    }
    return new Response('method not allowed', { status: 405 })
  }
}

/**
 * The Worker's object store as tests have it: the real signer makes the URLs (so what the Host app and ws are handed is what production hands
 * them), and the multipart control calls, which would go over the network, are played by the bucket's multipart API.
 */
export function testObjectStore(bucket: R2Bucket): ObjectStore {
  const signer = s3ObjectStore(testCredentials, () => { throw new Error('the test makes no network request') })
  return {
    presign: (request) => signer.presign(request),
    startMultipart: async (key) => (await bucket.createMultipartUpload(key)).uploadId,
    completeMultipart: async (key, uploadId, parts) => { await bucket.resumeMultipartUpload(key, uploadId).complete(parts.map((part) => ({ partNumber: part.number, etag: part.etag }))) },
    abortMultipart: async (key, uploadId) => { await bucket.resumeMultipartUpload(key, uploadId).abort() },
  }
}
