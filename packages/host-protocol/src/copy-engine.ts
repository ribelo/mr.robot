import * as Data from 'effect/Data'

/**
 * The Host app's copy engine (v1.16 ticket 06): a file goes to R2 in parts and comes back in ranges, each over a presigned URL, each retried.
 * It knows nothing of Node or of the Worker: the app hands it its files and its `fetch`, so that the same code runs under test with in-memory ones.
 */

/** One part of an upload (the shape of UploadPart in the protocol). */
export interface PartToUpload {
  readonly number: number
  readonly url: string
  readonly offset: number
  readonly length: number
}

/** A file to send. */
export interface SourceFile {
  size(): Promise<number>
  read(offset: number, length: number): Promise<Uint8Array>
}

/** A file to receive: bytes are written at their offsets, and the file appears only at `finish`. */
export interface TargetFile {
  write(offset: number, bytes: Uint8Array): Promise<void>
  /** The file is whole: it appears at its place. */
  finish(): Promise<void>
  /** This window is done and more follow: what arrived stays, out of sight, for the next window. */
  release(): Promise<void>
  /** The copy failed: nothing is left. */
  abandon(): Promise<void>
}

export interface CopyIo {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly sleep: (ms: number) => Promise<void>
}

/** A copy that failed for good: the message says why, in words the Robot can pass on. */
export class CopyFailed extends Data.TaggedError('CopyFailed')<{ readonly message: string }> {}

/** How long a copy of `bytes` by ws on the Box may take before its caller gives up: two minutes and a second for each megabyte, at most six hours. */
export const copyTimeoutMs = (bytes: number): number => Math.min(6 * 3600_000, 120_000 + Math.ceil(bytes / 1_000_000) * 1000)

/**
 * How long the Worker waits for a Host app to move one part of a copy (deep review P12): two minutes and a second for each 64 kB, so that a
 * line of half a megabit a second still moves a part of 64 MiB. The Worker hands a Host one part per call, so each part that arrives
 * starts a new deadline: a large file on a slow line finishes, and a Host that stopped moving bytes is given up on within one part's time.
 */
export const hostPartDeadlineMs = (bytes: number): number => 120_000 + Math.ceil(bytes / 64_000) * 1000

export const ATTEMPTS = 4
const BACKOFF_MS = 500

/** What one request came to: its value, a failure another attempt can cure, or a final refusal (an expired or wrong URL). */
type Outcome<A> = { readonly _tag: 'Done'; readonly value: A } | { readonly _tag: 'Retry'; readonly reason: string } | { readonly _tag: 'Refused'; readonly reason: string }

const answered = (response: Response): Outcome<Response> => {
  if (response.ok) return { _tag: 'Done', value: response }
  const said = `R2 answered ${response.status}`
  if (response.status === 408 || response.status === 429 || response.status >= 500) return { _tag: 'Retry', reason: said }
  return { _tag: 'Refused', reason: `${said}${response.status === 403 ? ' (the link expired or was refused)' : ''}` }
}

/** The copy was stopped (its caller gave up, or the connection to the Worker ended): nothing is tried again. */
const stopped = (what: string): CopyFailed => new CopyFailed({ message: `${what}: the copy was stopped` })

/**
 * One request, tried up to ATTEMPTS times with a growing pause; a refusal, or the last failure, is a CopyFailed. Once `signal` is aborted
 * the request in flight ends (`once` hands the signal to fetch) and no other attempt starts.
 */
async function attempt<A>(what: string, once: () => Promise<Outcome<A>>, io: CopyIo, signal: AbortSignal): Promise<A> {
  let last = ''
  for (let tried = 0; tried < ATTEMPTS; tried++) {
    if (tried > 0) await io.sleep(BACKOFF_MS * 2 ** (tried - 1))
    if (signal.aborted) throw stopped(what)
    const outcome = await once().catch((error: unknown): Outcome<A> => {
      if (signal.aborted) throw stopped(what)
      return { _tag: 'Retry', reason: error instanceof Error ? error.message : String(error) }
    })
    switch (outcome._tag) {
      case 'Done': return outcome.value
      case 'Refused': throw new CopyFailed({ message: `${what}: ${outcome.reason}` })
      case 'Retry': last = outcome.reason
    }
  }
  throw new CopyFailed({ message: `${what} failed after ${ATTEMPTS} attempts: ${last}` })
}

/** Send a file part by part; the ETag of each part, in order, for the Worker to complete the upload. Nothing more is sent once `signal` is aborted. */
export async function uploadFile(file: SourceFile, size: number, parts: readonly PartToUpload[], io: CopyIo, signal: AbortSignal): Promise<Array<{ number: number; etag: string }>> {
  if ((await file.size()) !== size) throw new CopyFailed({ message: 'the file changed while it was copied' })
  const etags: Array<{ number: number; etag: string }> = []
  for (const part of parts) {
    // fetch takes a body backed by an ArrayBuffer, which the file's own buffer type does not promise.
    const bytes = new Uint8Array(await file.read(part.offset, part.length))
    if (bytes.length !== part.length) throw new CopyFailed({ message: 'the file changed while it was copied' })
    const response = await attempt(`part ${part.number}`, async () => answered(await io.fetch(part.url, { method: 'PUT', body: bytes, signal })), io, signal)
    etags.push({ number: part.number, etag: response.headers.get('etag') ?? '' })
  }
  return etags
}

/** What to fetch: the object at `url` of `size` bytes, bytes `from` (0 when left out) to `until` (the size when left out) in ranges of `partBytes`. */
export interface DownloadWindow {
  readonly url: string
  readonly size: number
  readonly partBytes: number
  readonly from?: number
  readonly until?: number
}

/**
 * Fetch an object, or one window of it, in ranges of `partBytes` into a file; it appears only when the window reaches the end of the object
 * and every byte arrived. Returns the bytes written by this window. Once `signal` is aborted nothing more is fetched or written, and the
 * target is abandoned.
 */
export async function downloadFile(target: TargetFile, source: DownloadWindow, io: CopyIo, signal: AbortSignal): Promise<number> {
  const from = source.from ?? 0
  const until = Math.min(source.until ?? source.size, source.size)
  try {
    if (source.size === 0) await target.write(0, new Uint8Array())
    for (let offset = from; offset < until; offset += source.partBytes) {
      const length = Math.min(source.partBytes, until - offset)
      const bytes = await attempt(`bytes ${offset}-${offset + length - 1}`, async (): Promise<Outcome<Uint8Array>> => {
        const response = answered(await io.fetch(source.url, { method: 'GET', headers: { range: `bytes=${offset}-${offset + length - 1}` }, signal }))
        if (response._tag !== 'Done') return response
        const body = new Uint8Array(await response.value.arrayBuffer())
        // A short or long body is a broken transfer, not a result: ask again.
        return body.length === length ? { _tag: 'Done', value: body } : { _tag: 'Retry', reason: `got ${body.length} bytes of ${length}` }
      }, io, signal)
      if (signal.aborted) throw stopped(`bytes ${offset}-${offset + length - 1}`)
      await target.write(offset, bytes)
    }
    if (until >= source.size) await target.finish()
    else await target.release()
    return until - from
  } catch (error) {
    await target.abandon().catch(() => undefined)
    throw error
  }
}
