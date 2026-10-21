/**
 * A Robot's Workspace: its files in R2 under one prefix (robot-scwl, robot-8pqy).
 * Paths are relative, normalized, and can never leave the prefix.
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { authorMetadata, authorOf, FileHistory, isTrackedFile, robotHistoryBase, type FileAuthor } from './file-history.ts'

export class WorkspaceError extends Data.TaggedError('WorkspaceError')<{ readonly message: string; readonly cause?: unknown }> {}

export interface WorkspaceEntry {
  readonly path: string
  readonly size: number
  readonly uploaded: number
  readonly etag: string
}

export interface WorkspaceFile extends WorkspaceEntry {
  readonly contentType: string
  readonly body: ArrayBuffer
}

/** A file opened for streaming: its entry and its body, which the caller must read or cancel. */
export interface WorkspaceStream extends WorkspaceEntry {
  readonly body: ReadableStream
}

/** One page of a listing and where the next one starts (undefined on the last). */
export interface WorkspacePage {
  readonly entries: WorkspaceEntry[]
  readonly cursor: string | undefined
}

export interface WorkspaceShape {
  readonly prefix: string
  read(path: string): Effect.Effect<WorkspaceFile | undefined, WorkspaceError>
  readText(path: string): Effect.Effect<string | undefined, WorkspaceError>
  stat(path: string): Effect.Effect<WorkspaceEntry | undefined, WorkspaceError>
  /** Write a file; a persona or memory file keeps the version it replaces, and `by` (the Robot unless named) is who wrote this one (v1.18). */
  write(path: string, body: string | ArrayBuffer | Uint8Array | ReadableStream, contentType?: string, by?: FileAuthor): Effect.Effect<WorkspaceEntry, WorkspaceError>
  /** Delete a file; a persona or memory file keeps its last version. */
  remove(path: string, by?: FileAuthor): Effect.Effect<void, WorkspaceError>
  /** The kept versions of a persona or memory file (v1.18, rm-7jo4). */
  readonly history: FileHistory
  /** Every file under a relative directory ('' for all). */
  list(directory?: string): Effect.Effect<WorkspaceEntry[], WorkspaceError>
  /** One page of the files under a relative directory ('' for all); pass the previous page's cursor for the next. */
  page(directory: string, cursor?: string): Effect.Effect<WorkspacePage, WorkspaceError>
  /** A file as a stream, so that a large one is never held in memory; undefined when there is none. */
  open(path: string): Effect.Effect<WorkspaceStream | undefined, WorkspaceError>
  /** Delete every file under a relative directory. */
  removeUnder(directory: string): Effect.Effect<void, WorkspaceError>
}

export class Workspace extends Context.Service<Workspace, WorkspaceShape>()('mr-robot/Workspace') {}

/** The R2 prefix of a Robot's Workspace. */
export function workspacePrefix(robotId: string): string {
  return `robots/${robotId}/`
}

/**
 * Delete every object under a Robot's Workspace prefix (Start over, destroy). The product docs are
 * not objects: they are served from the Worker bundle and cannot be lost here.
 */
export async function clearWorkspace(bucket: R2Bucket, robotId: string): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: workspacePrefix(robotId), ...(cursor === undefined ? {} : { cursor }) })
    if (page.objects.length > 0) await bucket.delete(page.objects.map((object) => object.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
}

/**
 * The R2 prefix of a Robot's screenshots: the platform's, not the Robot's. It is not under the
 * Workspace prefix, so Files, glob and grep never see what is stored there (v1.11, sk-m7t1).
 */
export function screenPrefix(robotId: string): string {
  return `screens/${robotId}/`
}

/**
 * Normalize a Workspace path: forward slashes, no leading slash, no '.' or '..' segments
 * that escape. Returns undefined for a path outside the Workspace.
 */
export function normalizePath(path: string): string | undefined {
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const normalized = parts.join('/')
  return normalized === '' ? undefined : normalized
}

const fail = (message: string) => (cause: unknown) => new WorkspaceError({ message, cause })

/** `writer`: who writes when a write names nobody (the Robot, or the memory sweep while it runs). */
/** After a write or a delete: the file's path, its text when the write gave one (undefined for a stream or a delete), its new etag (undefined for a delete). */
export type WorkspaceChange = (path: string, text: string | undefined, etag: string | undefined) => void

export function makeWorkspace(bucket: R2Bucket, robotId: string, writer: FileAuthor = { kind: 'robot' }, onChange?: WorkspaceChange): WorkspaceShape {
  const prefix = workspacePrefix(robotId)
  const history = new FileHistory(bucket, robotHistoryBase(robotId))
  /** Before a persona or memory file changes, the version it has goes to its history with who wrote it. */
  const keepPrevious = async (path: string, k: string) => {
    const normalized = normalizePath(path)
    if (normalized === undefined || !isTrackedFile(normalized)) return
    const previous = await bucket.get(k)
    if (previous === null) return
    const { by, at } = authorOf(previous.customMetadata, previous.uploaded.getTime())
    await history.keep(normalized, { body: await previous.arrayBuffer(), by, at }, Date.now())
  }
  const key = (path: string): Effect.Effect<string, WorkspaceError> => {
    const normalized = normalizePath(path)
    return normalized === undefined
      ? Effect.fail(new WorkspaceError({ message: `"${path}" is outside your Workspace` }))
      : Effect.succeed(prefix + normalized)
  }
  const entry = (object: R2Object): WorkspaceEntry => ({
    path: object.key.slice(prefix.length),
    size: object.size,
    uploaded: object.uploaded.getTime(),
    etag: object.etag,
  })
  const read = (path: string) => key(path).pipe(Effect.flatMap((k) => Effect.tryPromise({
    try: async () => {
      const object = await bucket.get(k)
      if (object === null) return undefined
      const body = await object.arrayBuffer()
      return { ...entry(object), contentType: object.httpMetadata?.contentType ?? 'application/octet-stream', body }
    },
    catch: fail(`cannot read ${path}`),
  })))
  const bucketPage = (directory: string, cursor: string | undefined) => {
    const normalized = directory === '' ? '' : normalizePath(directory)
    if (normalized === undefined) throw new Error(`"${directory}" is outside your Workspace`)
    return bucket.list({ prefix: prefix + (normalized === '' ? '' : `${normalized}/`), ...(cursor === undefined ? {} : { cursor }) })
  }
  const listed = async (directory: string, cursor: string | undefined): Promise<WorkspacePage> => {
    const page = await bucketPage(directory, cursor)
    return { entries: page.objects.map(entry), cursor: page.truncated ? page.cursor : undefined }
  }
  return {
    prefix,
    read,
    readText: (path) => read(path).pipe(Effect.map((file) => file === undefined ? undefined : new TextDecoder().decode(file.body))),
    stat: (path) => key(path).pipe(Effect.flatMap((k) => Effect.tryPromise({
      try: async () => {
        const object = await bucket.head(k)
        return object === null ? undefined : entry(object)
      },
      catch: fail(`cannot stat ${path}`),
    }))),
    write: (path, body, contentType, by = writer) => key(path).pipe(Effect.flatMap((k) => Effect.tryPromise({
      try: async () => {
        await keepPrevious(path, k)
        const written = entry(await bucket.put(k, body, { httpMetadata: { contentType: contentType ?? guessType(path) }, customMetadata: authorMetadata(by, Date.now()) }))
        const text = typeof body === 'string' ? body : body instanceof ArrayBuffer || body instanceof Uint8Array ? new TextDecoder().decode(body) : undefined
        onChange?.(written.path, text, written.etag)
        return written
      },
      catch: fail(`cannot write ${path}`),
    }))),
    remove: (path) => key(path).pipe(Effect.flatMap((k) => Effect.tryPromise({
      try: async () => {
        await keepPrevious(path, k)
        await bucket.delete(k)
        onChange?.(k.slice(prefix.length), undefined, undefined)
      },
      catch: fail(`cannot delete ${path}`),
    }))),
    history,
    list: (directory = '') => Effect.tryPromise({
      try: async () => {
        const entries: WorkspaceEntry[] = []
        let cursor: string | undefined
        do {
          const page = await listed(directory, cursor)
          entries.push(...page.entries)
          cursor = page.cursor
        } while (cursor !== undefined)
        return entries
      },
      catch: fail(`cannot list ${directory || 'the Workspace'}`),
    }),
    page: (directory, cursor) => Effect.tryPromise({ try: () => listed(directory, cursor), catch: fail(`cannot list ${directory || 'the Workspace'}`) }),
    open: (path) => key(path).pipe(Effect.flatMap((k) => Effect.tryPromise({
      try: async () => {
        const object = await bucket.get(k)
        return object === null ? undefined : { ...entry(object), body: object.body }
      },
      catch: fail(`cannot read ${path}`),
    }))),
    removeUnder: (directory) => Effect.tryPromise({
      try: async () => {
        let cursor: string | undefined
        do {
          const page = await bucketPage(directory, cursor)
          if (page.objects.length > 0) await bucket.delete(page.objects.map((object) => object.key))
          cursor = page.truncated ? page.cursor : undefined
        } while (cursor !== undefined)
      },
      catch: fail(`cannot delete ${directory}`),
    }),
  }
}

function guessType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'md': return 'text/markdown; charset=utf-8'
    case 'txt': return 'text/plain; charset=utf-8'
    case 'json': return 'application/json'
    case 'csv': return 'text/csv; charset=utf-8'
    case 'html': return 'text/html; charset=utf-8'
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'pdf': return 'application/pdf'
    default: return 'application/octet-stream'
  }
}
