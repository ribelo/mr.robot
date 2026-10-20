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
  finish(): Promise<void>
  abandon(): Promise<void>
}

export interface CopyIo {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly sleep: (ms: number) => Promise<void>
}

/** A copy that failed for good: the message says why, in words the Robot can pass on. */
export class CopyFailed extends Error {
  override readonly name = 'CopyFailed'
}

/** How long a copy of `bytes` may take before its caller gives up: two minutes and a second for each megabyte (a slow line still finishes), at most six hours. */
export const copyTimeoutMs = (bytes: number): number => Math.min(6 * 3600_000, 120_000 + Math.ceil(bytes / 1_000_000) * 1000)

export const ATTEMPTS = 4
const BACKOFF_MS = 500

/** What one request came to: its value, a failure another attempt can cure, or a final refusal (an expired or wrong URL). */
type Outcome<A> = { readonly done: A } | { readonly retry: string } | { readonly refused: string }

const answered = (response: Response): Outcome<Response> => {
  if (response.ok) return { done: response }
  const said = `R2 answered ${response.status}`
  if (response.status === 408 || response.status === 429 || response.status >= 500) return { retry: said }
  return { refused: `${said}${response.status === 403 ? ' (the link expired or was refused)' : ''}` }
}

/** One request, tried up to ATTEMPTS times with a growing pause; a refusal, or the last failure, is a CopyFailed. */
async function attempt<A>(what: string, once: () => Promise<Outcome<A>>, io: CopyIo): Promise<A> {
  let last = ''
  for (let tried = 0; tried < ATTEMPTS; tried++) {
    if (tried > 0) await io.sleep(BACKOFF_MS * 2 ** (tried - 1))
    const outcome = await once().catch((error: unknown): Outcome<A> => ({ retry: error instanceof Error ? error.message : String(error) }))
    if ('done' in outcome) return outcome.done
    if ('refused' in outcome) throw new CopyFailed(`${what}: ${outcome.refused}`)
    last = outcome.retry
  }
  throw new CopyFailed(`${what} failed after ${ATTEMPTS} attempts: ${last}`)
}

/** Send a file part by part; the ETag of each part, in order, for the Worker to complete the upload. */
export async function uploadFile(file: SourceFile, size: number, parts: readonly PartToUpload[], io: CopyIo): Promise<Array<{ number: number; etag: string }>> {
  if ((await file.size()) !== size) throw new CopyFailed('the file changed while it was copied')
  const etags: Array<{ number: number; etag: string }> = []
  for (const part of parts) {
    const bytes = await file.read(part.offset, part.length)
    if (bytes.length !== part.length) throw new CopyFailed('the file changed while it was copied')
    const response = await attempt(`part ${part.number}`, async () => answered(await io.fetch(part.url, { method: 'PUT', body: bytes })), io)
    etags.push({ number: part.number, etag: response.headers.get('etag') ?? '' })
  }
  return etags
}

/** Fetch an object in ranges of `partBytes` into a file; it appears only when every byte arrived. Returns the bytes written. */
export async function downloadFile(target: TargetFile, source: { readonly url: string; readonly size: number; readonly partBytes: number }, io: CopyIo): Promise<number> {
  try {
    if (source.size === 0) await target.write(0, new Uint8Array())
    for (let offset = 0; offset < source.size; offset += source.partBytes) {
      const length = Math.min(source.partBytes, source.size - offset)
      const bytes = await attempt(`bytes ${offset}-${offset + length - 1}`, async (): Promise<Outcome<Uint8Array>> => {
        const response = answered(await io.fetch(source.url, { method: 'GET', headers: { range: `bytes=${offset}-${offset + length - 1}` } }))
        if (!('done' in response)) return response
        const body = new Uint8Array(await response.done.arrayBuffer())
        // A short or long body is a broken transfer, not a result: ask again.
        return body.length === length ? { done: body } : { retry: `got ${body.length} bytes of ${length}` }
      }, io)
      await target.write(offset, bytes)
    }
    await target.finish()
    return source.size
  } catch (error) {
    await target.abandon().catch(() => undefined)
    throw error
  }
}
