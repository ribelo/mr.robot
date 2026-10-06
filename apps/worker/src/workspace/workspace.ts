/**
 * A Robot's Workspace: its files in R2 under one prefix (robot-scwl, robot-8pqy).
 * Paths are relative, normalized, and can never leave the prefix.
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'

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

export interface WorkspaceShape {
  readonly prefix: string
  read(path: string): Effect.Effect<WorkspaceFile | undefined, WorkspaceError>
  readText(path: string): Effect.Effect<string | undefined, WorkspaceError>
  stat(path: string): Effect.Effect<WorkspaceEntry | undefined, WorkspaceError>
  write(path: string, body: string | ArrayBuffer | ReadableStream, contentType?: string): Effect.Effect<WorkspaceEntry, WorkspaceError>
  remove(path: string): Effect.Effect<void, WorkspaceError>
  /** Every file under a relative directory ('' for all). */
  list(directory?: string): Effect.Effect<WorkspaceEntry[], WorkspaceError>
}

export class Workspace extends Context.Service<Workspace, WorkspaceShape>()('mr-robot/Workspace') {}

/** The R2 prefix of a Robot's Workspace. */
export function workspacePrefix(robotId: string): string {
  return `robots/${robotId}/`
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

export function makeWorkspace(bucket: R2Bucket, robotId: string): WorkspaceShape {
  const prefix = workspacePrefix(robotId)
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
    write: (path, body, contentType) => key(path).pipe(Effect.flatMap((k) => Effect.tryPromise({
      try: async () => entry(await bucket.put(k, body, { httpMetadata: { contentType: contentType ?? guessType(path) } })),
      catch: fail(`cannot write ${path}`),
    }))),
    remove: (path) => key(path).pipe(Effect.flatMap((k) => Effect.tryPromise({ try: () => bucket.delete(k), catch: fail(`cannot delete ${path}`) }))),
    list: (directory = '') => Effect.tryPromise({
      try: async () => {
        const normalized = directory === '' ? '' : normalizePath(directory)
        if (normalized === undefined) throw new Error(`"${directory}" is outside your Workspace`)
        const entries: WorkspaceEntry[] = []
        let cursor: string | undefined
        do {
          const page = await bucket.list({ prefix: prefix + (normalized === '' ? '' : `${normalized}/`), ...(cursor === undefined ? {} : { cursor }) })
          entries.push(...page.objects.map(entry))
          cursor = page.truncated ? page.cursor : undefined
        } while (cursor !== undefined)
        return entries
      },
      catch: fail(`cannot list ${directory || 'the Workspace'}`),
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
