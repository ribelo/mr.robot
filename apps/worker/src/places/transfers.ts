/**
 * Files in and out of the Workspace without the Worker in the pipe (v1.16 ticket 06, ob-qshq, ob-63nt, ob-o6aw). This service mints what a Host app or
 * ws needs for one key under one Robot's prefix: a presigned GET, the presigned PUTs of a single or multipart upload, and the control calls
 * that end or abort an upload. A key outside the prefix cannot be asked for: the path is parsed into a key under the prefix first, and
 * nothing else reaches the signer. Both callers use it: the Robot's own copy (for a Host) and the Box's token door (for ws).
 */
import type { UploadPart } from '@mr-robot/host-protocol'
import { workspacePrefix } from '../workspace/workspace.ts'
import type { CompletedPart, ObjectStore } from '../workspace/object-store.ts'
import { ObjectStoreError } from '../workspace/object-store.ts'
import { workspaceKey, writableWorkspaceKey } from './files.ts'

/** The size of one part of a multipart upload, and the longest a presigned URL lives (long enough for a slow upload of a large file). */
export const PART_BYTES = 64 * 1024 * 1024
export const URL_SECONDS = 6 * 3600
/** R2's limit on the parts of one upload. */
export const MAX_PARTS = 10_000

/** A result the caller can pass on: its value, or the HTTP status and the words for the Robot. */
export type Transfer<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly status: 400 | 404 | 409 | 502 | 503; readonly error: string }

const done = <A>(value: A): Transfer<A> => ({ ok: true, value })
const failed = (status: 400 | 404 | 409 | 502 | 503, error: string): Transfer<never> => ({ ok: false, status, error })

/** The plan of an upload: one part with no upload id when the file fits in a part, else the parts of a multipart upload. */
export interface UploadPlan {
  readonly uploadId?: string
  readonly partBytes: number
  readonly parts: readonly UploadPart[]
}

export interface DownloadPlan {
  readonly url: string
  readonly size: number
  readonly partBytes: number
}

export interface ListedFile {
  readonly path: string
  readonly size: number
  readonly uploaded: number
}

const LIST_LIMIT = 2000

export interface TransfersDeps {
  readonly robotId: string
  readonly bucket: R2Bucket
  /** The S3 side of the bucket; undefined where the deployment has no S3 credentials (a local run). */
  readonly store: ObjectStore | undefined
  readonly partBytes: number
}

export class Transfers {
  constructor(private readonly deps: TransfersDeps) {}

  private get prefix(): string {
    return workspacePrefix(this.deps.robotId)
  }

  private store(): ObjectStore | Transfer<never> {
    return this.deps.store ?? failed(503, 'files cannot be copied here: this deployment has no S3 credentials for the Files bucket (the Alchemy stack creates them)')
  }

  /** The path as a key, for a read or a write; a refused path is a 400 with the reason. */
  private key(path: string, writable: boolean): string | Transfer<never> {
    try {
      return writable ? writableWorkspaceKey(path) : workspaceKey(path)
    } catch (error) {
      return failed(400, error instanceof Error ? error.message : String(error))
    }
  }

  /** What to fetch to read one file of the Workspace: a presigned GET, the size and the range size. */
  async download(path: string): Promise<Transfer<DownloadPlan>> {
    const key = this.key(path, false)
    const store = this.store()
    if (typeof key !== 'string') return key
    if ('ok' in store) return store
    const object = await this.deps.bucket.head(this.prefix + key)
    if (object === null) return failed(404, `no file "${key}" in your Workspace`)
    const url = await this.sign(store, { method: 'GET', key: this.prefix + key })
    return url.ok ? done({ url: url.value, size: object.size, partBytes: this.deps.partBytes }) : url
  }

  /** What to send to write one file of the Workspace: a presigned PUT, or the presigned parts of a multipart upload. */
  async upload(path: string, size: number): Promise<Transfer<UploadPlan>> {
    const key = this.key(path, true)
    const store = this.store()
    if (typeof key !== 'string') return key
    if ('ok' in store) return store
    if (!Number.isSafeInteger(size) || size < 0) return failed(400, `"${size}" is not a file size`)
    const full = this.prefix + key
    // A file with more parts than R2 allows gets larger parts, in whole MiB.
    const partBytes = Math.max(this.deps.partBytes, Math.ceil(size / MAX_PARTS / 1_048_576) * 1_048_576)
    if (size <= partBytes) {
      const url = await this.sign(store, { method: 'PUT', key: full })
      return url.ok ? done({ partBytes, parts: [{ number: 1, url: url.value, offset: 0, length: size }] }) : url
    }
    let uploadId: string
    try {
      uploadId = await store.startMultipart(full)
    } catch (error) {
      return failed(502, error instanceof Error ? error.message : String(error))
    }
    const parts: UploadPart[] = []
    for (let number = 1; (number - 1) * partBytes < size; number++) {
      const signed = await this.sign(store, { method: 'PUT', key: full, query: { partNumber: String(number), uploadId } })
      if (!signed.ok) {
        await store.abortMultipart(full, uploadId).catch(() => undefined)
        return signed
      }
      parts.push({ number, url: signed.value, offset: (number - 1) * partBytes, length: Math.min(partBytes, size - (number - 1) * partBytes) })
    }
    return done({ uploadId, partBytes, parts })
  }

  /** The upload arrived: complete a multipart one with the ETags the client got; for a single PUT, check the object is there. Returns the size. */
  async finish(path: string, uploadId: string | undefined, parts: readonly CompletedPart[]): Promise<Transfer<{ size: number }>> {
    const key = this.key(path, true)
    const store = this.store()
    if (typeof key !== 'string') return key
    if ('ok' in store) return store
    if (uploadId !== undefined) {
      try {
        await store.completeMultipart(this.prefix + key, uploadId, parts)
      } catch (error) {
        return failed(502, error instanceof Error ? error.message : String(error))
      }
    }
    const object = await this.deps.bucket.head(this.prefix + key)
    return object === null ? failed(409, `the upload of "${key}" did not arrive`) : done({ size: object.size })
  }

  /** An upload that failed: R2 drops the parts it holds. */
  async abort(path: string, uploadId: string): Promise<Transfer<null>> {
    const key = this.key(path, true)
    const store = this.store()
    if (typeof key !== 'string') return key
    if ('ok' in store) return store
    try {
      await store.abortMultipart(this.prefix + key, uploadId)
      return done(null)
    } catch (error) {
      return failed(502, error instanceof Error ? error.message : String(error))
    }
  }

  /** The files under a directory of the Workspace (all of it when empty): the objects in R2, not the platform's own files. */
  async list(directory: string): Promise<Transfer<{ files: ListedFile[]; truncated: boolean }>> {
    const under = directory === '' || directory === '.' ? '' : this.key(directory, false)
    if (typeof under !== 'string') return under
    const files: ListedFile[] = []
    let cursor: string | undefined
    let more = false
    do {
      const page = await this.deps.bucket.list({ prefix: this.prefix + (under === '' ? '' : `${under}/`), ...(cursor === undefined ? {} : { cursor }) })
      files.push(...page.objects.map((object) => ({ path: object.key.slice(this.prefix.length), size: object.size, uploaded: object.uploaded.getTime() })))
      more = page.truncated
      cursor = page.truncated && files.length < LIST_LIMIT ? page.cursor : undefined
    } while (cursor !== undefined)
    return done({ files: files.slice(0, LIST_LIMIT), truncated: more || files.length > LIST_LIMIT })
  }

  async remove(path: string): Promise<Transfer<{ path: string }>> {
    const key = this.key(path, true)
    if (typeof key !== 'string') return key
    if ((await this.deps.bucket.head(this.prefix + key)) === null) return failed(404, `no file "${key}" in your Workspace; nothing was deleted`)
    await this.deps.bucket.delete(this.prefix + key)
    return done({ path: key })
  }

  /** Everything under one staging directory (copy between two Hosts, or the Box and a Host, passes through the Workspace): deleted. */
  async removeStaged(directory: string): Promise<void> {
    const key = this.key(directory, true)
    if (typeof key !== 'string') return
    let cursor: string | undefined
    do {
      const page = await this.deps.bucket.list({ prefix: `${this.prefix}${key}/`, ...(cursor === undefined ? {} : { cursor }) })
      if (page.objects.length > 0) await this.deps.bucket.delete(page.objects.map((object) => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
  }

  private async sign(store: ObjectStore, request: { method: 'GET' | 'PUT'; key: string; query?: Record<string, string> }): Promise<Transfer<string>> {
    try {
      return done(await store.presign({ ...request, expiresSeconds: URL_SECONDS }))
    } catch (error) {
      return failed(502, error instanceof ObjectStoreError ? error.message : `could not sign a link: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** A request of ws to the presign endpoint, parsed: nothing else reaches the service. */
export type TransferRequest =
  | { readonly op: 'ls'; readonly path: string }
  | { readonly op: 'get'; readonly path: string }
  | { readonly op: 'put'; readonly path: string; readonly size: number }
  | { readonly op: 'complete'; readonly path: string; readonly uploadId?: string; readonly parts: readonly CompletedPart[] }
  | { readonly op: 'abort'; readonly path: string; readonly uploadId: string }
  | { readonly op: 'rm'; readonly path: string }

/** The body of a request as a TransferRequest, or the reason it is not one. */
export function parseTransferRequest(body: unknown): TransferRequest | string {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const path = typeof record['path'] === 'string' ? record['path'] : undefined
  const op = record['op']
  if (op === 'ls') return { op, path: path ?? '' }
  if (path === undefined || path === '') return 'a path is required'
  if (op === 'get' || op === 'rm') return { op, path }
  if (op === 'put') return typeof record['size'] === 'number' && Number.isSafeInteger(record['size']) && record['size'] >= 0 ? { op, path, size: record['size'] } : 'put needs the size of the file in bytes'
  if (op === 'abort') return typeof record['uploadId'] === 'string' && record['uploadId'] !== '' ? { op, path, uploadId: record['uploadId'] } : 'abort needs the upload id'
  if (op === 'complete') {
    const uploadId = typeof record['uploadId'] === 'string' && record['uploadId'] !== '' ? record['uploadId'] : undefined
    const parts = Array.isArray(record['parts']) ? record['parts'] : []
    const listed: CompletedPart[] = []
    for (const part of parts) {
      const entry = part !== null && typeof part === 'object' ? (part as Record<string, unknown>) : {}
      if (typeof entry['number'] !== 'number' || typeof entry['etag'] !== 'string') return 'every part needs its number and its etag'
      listed.push({ number: entry['number'], etag: entry['etag'] })
    }
    return { op, path, ...(uploadId === undefined ? {} : { uploadId }), parts: listed }
  }
  return 'op must be ls, get, put, complete, abort or rm'
}

/** Carry a parsed request out: the reply ws gets. */
export async function carryOut(transfers: Transfers, request: TransferRequest): Promise<Transfer<unknown>> {
  switch (request.op) {
    case 'ls': return transfers.list(request.path)
    case 'get': return transfers.download(request.path)
    case 'put': return transfers.upload(request.path, request.size)
    case 'complete': return transfers.finish(request.path, request.uploadId, request.parts)
    case 'abort': return transfers.abort(request.path, request.uploadId)
    case 'rm': return transfers.remove(request.path)
  }
}
