/**
 * Files in and out of the Workspace without the Worker in the pipe (v1.16 ticket 06, ob-qshq, ob-63nt, ob-o6aw). This service mints what a Host app or ws
 * needs for one key under one Robot's prefix: a presigned GET, the presigned PUTs of a single or multipart upload, and the control calls
 * that end or abort an upload. A key outside the prefix cannot be asked for: the path is parsed into a key under the prefix first, and
 * nothing else reaches the signer. The Workspace itself (head, list, delete) is reached through the Workspace service, like every other
 * access to it. Both callers use this: the Robot's own copy (for a Host) and the Box's token door (for ws).
 *
 * A link lives only as long as its holder needs it (S4): a Box link fifteen minutes (ws asks again for each part), a Host link an hour
 * (the Worker mints the link of each part just before it hands the part to the Host). Nothing is minted for a whole file at once.
 */
import * as Data from 'effect/Data'
import * as Schema from 'effect/Schema'
import type { UploadPart } from '@mr-robot/host-protocol'
import type { WorkspaceHost } from '../agent/host.ts'
import type { CompletedPart, ObjectStore } from '../workspace/object-store.ts'
import { ObjectStoreError } from '../workspace/object-store.ts'
import { BadPath, MissingFile, ReadOnlyPath } from './errors.ts'
import { workspaceKey, writableWorkspaceKey } from './files.ts'
import { isTrackedFile } from '../workspace/file-history.ts'

/** The size of one part of a multipart upload. */
export const PART_BYTES = 64 * 1024 * 1024
/** R2's limit on the parts of one upload. */
export const MAX_PARTS = 10_000

/** Who holds a link: the Box (through ws, which asks again for each part) or a Host app. It decides how long the link lives. */
export type LinkHolder = 'box' | 'host'
export const LINK_SECONDS: Readonly<Record<LinkHolder, number>> = { box: 15 * 60, host: 60 * 60 }

/** The request is not one the door answers. */
export class BadTransfer extends Data.TaggedError('BadTransfer')<{ readonly message: string }> {}
/** The upload the caller said it finished is not in the bucket. */
export class UploadMissing extends Data.TaggedError('UploadMissing')<{ readonly message: string }> {}
/** R2 or the signer failed. */
export class StoreFailed extends Data.TaggedError('StoreFailed')<{ readonly message: string }> {}
/** This deployment has no S3 credentials for the bucket (a local run). */
export class StoreUnavailable extends Data.TaggedError('StoreUnavailable')<{ readonly message: string }> {}

/** What can go wrong in a transfer; the door turns each into an HTTP status, a copy into words. */
export type TransferFailure = BadTransfer | UploadMissing | StoreFailed | StoreUnavailable | BadPath | ReadOnlyPath | MissingFile

export function isTransferFailure(error: unknown): error is TransferFailure {
  return error instanceof BadTransfer || error instanceof UploadMissing || error instanceof StoreFailed || error instanceof StoreUnavailable
    || error instanceof BadPath || error instanceof ReadOnlyPath || error instanceof MissingFile
}

/** The HTTP status of a failure at the Box's door. */
export function httpStatus(error: TransferFailure): 400 | 404 | 409 | 502 | 503 {
  switch (error._tag) {
    case 'BadTransfer': case 'BadPath': case 'ReadOnlyPath': return 400
    case 'MissingFile': return 404
    case 'UploadMissing': return 409
    case 'StoreFailed': return 502
    case 'StoreUnavailable': return 503
  }
}

/** One part of an upload to be made: where it starts and how long it is. */
export interface PartPlan {
  readonly number: number
  readonly offset: number
  readonly length: number
}

/** The plan of an upload: one part with no upload id when the file fits in a part, else the parts of a multipart upload. */
export interface UploadPlan {
  readonly uploadId?: string
  readonly partBytes: number
  readonly parts: readonly PartPlan[]
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
  readonly workspace: WorkspaceHost
  /** The S3 side of the bucket; undefined where the deployment has no S3 credentials (a local run). */
  readonly store: ObjectStore | undefined
  readonly partBytes: number
}

export class Transfers {
  constructor(private readonly deps: TransfersDeps) {}

  private get prefix(): string {
    return this.deps.workspace.workspace.prefix
  }

  private get shape() {
    return this.deps.workspace.workspace
  }

  private store(): ObjectStore {
    if (this.deps.store === undefined) throw new StoreUnavailable({ message: 'files cannot be copied here: this deployment has no S3 credentials for the Files bucket (the Alchemy stack creates them)' })
    return this.deps.store
  }

  private key(path: string, writable: boolean): string {
    if (!writable) return workspaceKey(path)
    const key = writableWorkspaceKey(path)
    // A presigned PUT bypasses the Workspace's one write path, so a file with history is never written that way (v1.20.1, v1.18-review #10).
    if (isTrackedFile(key)) throw new ReadOnlyPath({ path: key, message: `${key} keeps a file history: write it with the file tools (write or edit on the Workspace), not by a copy or ws put` })
    return key
  }

  private async sign(request: { method: 'GET' | 'PUT'; key: string; query?: Record<string, string> }, holder: LinkHolder): Promise<string> {
    try {
      return await this.store().presign({ ...request, expiresSeconds: LINK_SECONDS[holder] })
    } catch (error) {
      if (error instanceof StoreUnavailable) throw error
      throw new StoreFailed({ message: error instanceof ObjectStoreError ? error.message : `could not sign a link: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  /** What to fetch to read one file of the Workspace: a presigned GET, the size and the range size. */
  async download(path: string, holder: LinkHolder): Promise<DownloadPlan> {
    const key = this.key(path, false)
    this.store()
    const object = await this.deps.workspace.run(this.shape.stat(key))
    if (object === undefined) throw new MissingFile({ place: 'your Workspace', path: key, message: `no file "${key}" in your Workspace` })
    return { url: await this.sign({ method: 'GET', key: this.prefix + key }, holder), size: object.size, partBytes: this.deps.partBytes }
  }

  /** How to send one file of `size` bytes into the Workspace: the parts, and the upload id of a multipart upload. No link is minted yet (partLink). */
  async upload(path: string, size: number): Promise<UploadPlan> {
    const key = this.key(path, true)
    const store = this.store()
    if (!Number.isSafeInteger(size) || size < 0) throw new BadTransfer({ message: `"${size}" is not a file size` })
    // A file with more parts than R2 allows gets larger parts, in whole MiB.
    const partBytes = Math.max(this.deps.partBytes, Math.ceil(size / MAX_PARTS / 1_048_576) * 1_048_576)
    if (size <= partBytes) return { partBytes, parts: [{ number: 1, offset: 0, length: size }] }
    let uploadId: string
    try {
      uploadId = await store.startMultipart(this.prefix + key)
    } catch (error) {
      throw new StoreFailed({ message: error instanceof Error ? error.message : String(error) })
    }
    const parts: PartPlan[] = []
    for (let number = 1; (number - 1) * partBytes < size; number++) parts.push({ number, offset: (number - 1) * partBytes, length: Math.min(partBytes, size - (number - 1) * partBytes) })
    return { uploadId, partBytes, parts }
  }

  /** The link to put one part (the only part of a single PUT when there is no upload id). */
  async partLink(path: string, part: { readonly uploadId?: string | undefined; readonly number: number }, holder: LinkHolder): Promise<string> {
    const key = this.key(path, true)
    if (part.uploadId === undefined && part.number !== 1) throw new BadTransfer({ message: 'a single upload has one part, number 1' })
    return this.sign({ method: 'PUT', key: this.prefix + key, ...(part.uploadId === undefined ? {} : { query: { partNumber: String(part.number), uploadId: part.uploadId } }) }, holder)
  }

  /** One part with its link, for a Host app to send. */
  async linkedPart(path: string, plan: UploadPlan, part: PartPlan): Promise<UploadPart> {
    return { ...part, url: await this.partLink(path, { uploadId: plan.uploadId, number: part.number }, 'host') }
  }

  /** The upload arrived: complete a multipart one with the ETags the client got; for a single PUT, check the object is there. Returns the size. */
  async finish(path: string, uploadId: string | undefined, parts: readonly CompletedPart[]): Promise<{ size: number }> {
    const key = this.key(path, true)
    const store = this.store()
    if (uploadId !== undefined) {
      try {
        await store.completeMultipart(this.prefix + key, uploadId, parts)
      } catch (error) {
        throw new StoreFailed({ message: error instanceof Error ? error.message : String(error) })
      }
    }
    const object = await this.deps.workspace.run(this.shape.stat(key))
    if (object === undefined) throw new UploadMissing({ message: `the upload of "${key}" did not arrive` })
    return { size: object.size }
  }

  /** An upload that failed: R2 drops the parts it holds. */
  async abort(path: string, uploadId: string): Promise<null> {
    const key = this.key(path, true)
    try {
      await this.store().abortMultipart(this.prefix + key, uploadId)
      return null
    } catch (error) {
      if (error instanceof StoreUnavailable) throw error
      throw new StoreFailed({ message: error instanceof Error ? error.message : String(error) })
    }
  }

  /** The files under a directory of the Workspace (all of it when empty): the objects in R2, not the platform's own files. */
  async list(directory: string): Promise<{ files: ListedFile[]; truncated: boolean }> {
    const under = directory === '' || directory === '.' ? '' : this.key(directory, false)
    const files: ListedFile[] = []
    let cursor: string | undefined
    let more = false
    do {
      const page = await this.deps.workspace.run(this.shape.page(under, cursor))
      files.push(...page.entries.map((entry) => ({ path: entry.path, size: entry.size, uploaded: entry.uploaded })))
      more = page.cursor !== undefined
      cursor = page.cursor !== undefined && files.length < LIST_LIMIT ? page.cursor : undefined
    } while (cursor !== undefined)
    return { files: files.slice(0, LIST_LIMIT), truncated: more || files.length > LIST_LIMIT }
  }

  async remove(path: string): Promise<{ path: string }> {
    const key = this.key(path, true)
    if ((await this.deps.workspace.run(this.shape.stat(key))) === undefined) throw new MissingFile({ place: 'your Workspace', path: key, message: `no file "${key}" in your Workspace; nothing was deleted` })
    await this.deps.workspace.run(this.shape.remove(key))
    return { path: key }
  }

  /** Everything under one staging directory (copy between two Hosts, or the Box and a Host, passes through the Workspace): deleted. */
  async removeStaged(directory: string): Promise<void> {
    await this.deps.workspace.run(this.shape.removeUnder(this.key(directory, true)))
  }
}

const Path = Schema.String.check(Schema.isMinLength(1))
const PartNumber = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: MAX_PARTS }))

/** A request of ws to the presign endpoint, as the door accepts it: nothing else reaches the service. */
export const TransferRequest = Schema.Union([
  Schema.Struct({ op: Schema.Literal('ls'), path: Schema.optional(Schema.String) }),
  Schema.Struct({ op: Schema.Literal('get'), path: Path }),
  Schema.Struct({ op: Schema.Literal('rm'), path: Path }),
  Schema.Struct({ op: Schema.Literal('put'), path: Path, size: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) }),
  Schema.Struct({ op: Schema.Literal('part'), path: Path, uploadId: Schema.optional(Path), number: PartNumber }),
  Schema.Struct({ op: Schema.Literal('abort'), path: Path, uploadId: Path }),
  Schema.Struct({ op: Schema.Literal('complete'), path: Path, uploadId: Schema.optional(Path), parts: Schema.Array(Schema.Struct({ number: PartNumber, etag: Schema.String })) }),
])
export type TransferRequest = typeof TransferRequest.Type

/** The body of a request as a TransferRequest. @throws BadTransfer when it is not one. */
export function parseTransferRequest(body: unknown): TransferRequest {
  const parsed = Schema.decodeUnknownOption(TransferRequest)(body)
  if (parsed._tag === 'None') throw new BadTransfer({ message: 'op must be ls, get, put, part, complete, abort or rm, each with its path (and the size, upload id, part number or numbered ETags it needs; part numbers are whole numbers from 1)' })
  return parsed.value
}

/** Carry a parsed request out for the Box: the reply ws gets. */
export async function answer(transfers: Transfers, request: TransferRequest): Promise<unknown> {
  switch (request.op) {
    case 'ls': return transfers.list(request.path ?? '')
    case 'get': return transfers.download(request.path, 'box')
    case 'put': return transfers.upload(request.path, request.size)
    case 'part': return { url: await transfers.partLink(request.path, { uploadId: request.uploadId, number: request.number }, 'box') }
    case 'complete': return transfers.finish(request.path, request.uploadId, request.parts)
    case 'abort': return transfers.abort(request.path, request.uploadId)
    case 'rm': return transfers.remove(request.path)
  }
}
