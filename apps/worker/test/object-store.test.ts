/**
 * The S3 side of the Files bucket (v1.16 ticket 06): the contract of a presigned URL, which a Host app and ws rely on, and the credentials secret.
 * The multipart control calls are exercised through the tools in files-without-limit.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { parseS3Credentials, s3ObjectStore, type S3Credentials } from '../src/workspace/object-store.ts'

const credentials: S3Credentials = { endpoint: 'https://acct.r2.cloudflarestorage.com', bucketName: 'files', region: 'auto', accessKeyId: 'AKID', secretAccessKey: 'secret' }

/** The signer makes no request: a fetch that fails the test if it is ever called. */
const noNetwork = (() => { throw new Error('presigning makes no request') }) as typeof fetch

describe('presign', () => {
  it('signs a GET for one key in path style, with the expiry in the query and the key\'s slashes kept', async () => {
    const store = s3ObjectStore(credentials, noNetwork)
    const url = new URL(await store.presign({ method: 'GET', key: 'robots/r-1/in box/a b.bin', expiresSeconds: 900 }))
    expect(url.origin).toBe('https://acct.r2.cloudflarestorage.com')
    expect(url.pathname).toBe('/files/robots/r-1/in%20box/a%20b.bin')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^AKID\/\d{8}\/auto\/s3\/aws4_request$/)
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('puts the part number and the upload id into the signed query of a part', async () => {
    const store = s3ObjectStore(credentials, noNetwork)
    const url = new URL(await store.presign({ method: 'PUT', key: 'robots/r-1/big.bin', query: { partNumber: '3', uploadId: 'UP1' }, expiresSeconds: 60 }))
    expect(url.searchParams.get('partNumber')).toBe('3')
    expect(url.searchParams.get('uploadId')).toBe('UP1')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
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
