/**
 * ws (v1.16 ticket 06, ob-fgyk, ob-63nt): the Box's way to its Robot's Workspace. A script on the Box runs `ws get`, `ws put`, `ws ls` or
 * `ws rm`; ws asks the Worker for presigned R2 URLs with the token written into the container at boot, and moves the bytes between the
 * disk and R2 itself, in parts of 64 MB with retries. The token reaches one Robot's prefix only and dies with the Box.
 *
 * This file is the whole program and touches no operating system: files, the network and the clock come in through `WsIo` (ws.ts gives the
 * real ones), so that the Worker's tests can run this very code against the stub Box and the real presign endpoint.
 */

export interface WsFile {
  write(offset: number, bytes: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface WsIo {
  readonly fetch: typeof fetch
  readonly env: Readonly<Record<string, string | undefined>>
  /** The size of a file, or undefined when there is none. */
  size(path: string): Promise<number | undefined>
  read(path: string, offset: number, length: number): Promise<Uint8Array>
  /** A file's text, or undefined when there is none. */
  text(path: string): Promise<string | undefined>
  /** Create or truncate a file (and its directories) for writing at offsets. */
  create(path: string): Promise<WsFile>
  remove(path: string): Promise<void>
  sleep(ms: number): Promise<void>
  out(line: string): void
  err(line: string): void
}

/** Where the Box backend writes the token and the address of the Worker when the Box boots. */
export const TOKEN_PATH = '/run/mr-robot/token'
export const ORIGIN_PATH = '/run/mr-robot/origin'
const ATTEMPTS = 4
const BACKOFF_MS = 500

/** A failure with words for the person at the keyboard (or the Robot's script log). */
class WsError extends Error {}

const USAGE = `ws: the files of your Workspace, from the Box
  ws ls [path]            list the files under a folder (all of them when left out)
  ws get <path> [dest]    copy a Workspace file to the Box (dest defaults to its name in this folder)
  ws put <file> <path>    copy a Box file into the Workspace
  ws rm <path>            delete a Workspace file
Paths in the Workspace are relative to it (for example inbox/video.mp4). Any size: files go straight to R2 in parts of 64 MB.`

type Json = Record<string, unknown>

async function configuration(io: WsIo): Promise<{ origin: string; token: string }> {
  const token = (io.env['MR_ROBOT_TOKEN'] ?? (await io.text(TOKEN_PATH)) ?? '').trim()
  const origin = (io.env['MR_ROBOT_URL'] ?? (await io.text(ORIGIN_PATH)) ?? '').trim().replace(/\/+$/, '')
  if (token === '') throw new WsError(`no token at ${TOKEN_PATH}: this Box started before ws existed. Stop it and let it boot again.`)
  if (origin === '') throw new WsError(`no address of Mr. Robot at ${ORIGIN_PATH}. Your owner has to open the app once; then stop the Box and let it boot again.`)
  return { origin, token }
}

/** One try of an HTTP request: its response, a reason to try again, or a final refusal. */
type Outcome = { readonly response: Response } | { readonly retry: string } | { readonly refused: string }

async function attempts(what: string, once: () => Promise<Outcome>, io: WsIo): Promise<Response> {
  let last = ''
  for (let tried = 0; tried < ATTEMPTS; tried++) {
    if (tried > 0) await io.sleep(BACKOFF_MS * 2 ** (tried - 1))
    const outcome = await once().catch((error: unknown): Outcome => ({ retry: error instanceof Error ? error.message : String(error) }))
    if ('response' in outcome) return outcome.response
    if ('refused' in outcome) throw new WsError(`${what}: ${outcome.refused}`)
    last = outcome.retry
  }
  throw new WsError(`${what} failed after ${ATTEMPTS} attempts: ${last}`)
}

const classify = (response: Response, body: string): Outcome => {
  if (response.ok) return { response }
  if (response.status === 408 || response.status === 429 || response.status >= 500) return { retry: `answered ${response.status}` }
  return { refused: `answered ${response.status}${body === '' ? '' : `: ${body}`}` }
}

/** A call to the presign endpoint; its JSON answer. */
async function ask(io: WsIo, request: Json): Promise<Json> {
  const { origin, token } = await configuration(io)
  const response = await attempts('the Workspace', async () => {
    const reply = await io.fetch(`${origin}/api/files/presign`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(request) })
    const text = reply.ok ? '' : await reply.text()
    const message = (() => { try { return String((JSON.parse(text) as Json)['error'] ?? text) } catch { return text } })()
    return classify(reply, message)
  }, io)
  return (await response.json()) as Json
}

const text = (value: unknown, what: string): string => {
  if (typeof value !== 'string') throw new WsError(`the Workspace sent no ${what}`)
  return value
}
const number = (value: unknown, what: string): number => {
  if (typeof value !== 'number') throw new WsError(`the Workspace sent no ${what}`)
  return value
}

interface PlannedPart { readonly number: number; readonly url: string; readonly offset: number; readonly length: number }

async function put(io: WsIo, file: string, path: string): Promise<string> {
  const size = await io.size(file)
  if (size === undefined) throw new WsError(`no file ${file}`)
  const plan = await ask(io, { op: 'put', path, size })
  const uploadId = typeof plan['uploadId'] === 'string' ? plan['uploadId'] : undefined
  const parts = plan['parts'] as PlannedPart[] | undefined
  if (parts === undefined) throw new WsError('the Workspace sent no upload plan')
  try {
    const etags: Array<{ number: number; etag: string }> = []
    for (const part of parts) {
      const bytes = await io.read(file, part.offset, part.length)
      if (bytes.length !== part.length) throw new WsError(`${file} changed while it was sent`)
      const response = await attempts(`part ${part.number}`, async () => {
        const reply = await io.fetch(part.url, { method: 'PUT', body: bytes })
        return classify(reply, reply.ok ? '' : `R2 refused the part`)
      }, io)
      etags.push({ number: part.number, etag: response.headers.get('etag') ?? '' })
    }
    await ask(io, { op: 'complete', path, ...(uploadId === undefined ? {} : { uploadId }), parts: etags })
  } catch (error) {
    if (uploadId !== undefined) await ask(io, { op: 'abort', path, uploadId }).catch(() => undefined)
    throw error
  }
  return `put ${file} -> ${path} (${size} bytes)`
}

async function get(io: WsIo, path: string, dest: string): Promise<string> {
  const plan = await ask(io, { op: 'get', path })
  const url = text(plan['url'], 'link')
  const size = number(plan['size'], 'size')
  const partBytes = number(plan['partBytes'], 'part size')
  const target = await io.create(dest)
  try {
    if (size === 0) await target.write(0, new Uint8Array())
    for (let offset = 0; offset < size; offset += partBytes) {
      const length = Math.min(partBytes, size - offset)
      const body = await attempts(`bytes ${offset}-${offset + length - 1}`, async () => {
        const reply = await io.fetch(url, { method: 'GET', headers: { range: `bytes=${offset}-${offset + length - 1}` } })
        if (!reply.ok) return classify(reply, 'R2 refused the range')
        const bytes = new Uint8Array(await reply.arrayBuffer())
        return bytes.length === length ? { response: new Response(bytes) } : { retry: `got ${bytes.length} bytes of ${length}` }
      }, io)
      await target.write(offset, new Uint8Array(await body.arrayBuffer()))
    }
    await target.close()
  } catch (error) {
    await target.close().catch(() => undefined)
    await io.remove(dest).catch(() => undefined)
    throw error
  }
  return `got ${path} -> ${dest} (${size} bytes)`
}

async function list(io: WsIo, path: string): Promise<string[]> {
  const answer = await ask(io, { op: 'ls', path })
  const files = (answer['files'] as Array<{ path: string; size: number }> | undefined) ?? []
  return [...files.map((file) => `${file.size}\t${file.path}`), ...(answer['truncated'] === true ? ['(more files than are listed here; give a folder)'] : [])]
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Run ws with its arguments; the exit code. */
export async function main(argv: readonly string[], io: WsIo): Promise<number> {
  const [command, first, second] = argv
  try {
    if (command === 'ls') {
      for (const line of await list(io, first ?? '')) io.out(line)
    } else if (command === 'get' && first !== undefined) {
      io.out(await get(io, first, second ?? baseName(first)))
    } else if (command === 'put' && first !== undefined && second !== undefined) {
      io.out(await put(io, first, second))
    } else if (command === 'rm' && first !== undefined) {
      const answer = await ask(io, { op: 'rm', path: first })
      io.out(`removed ${text(answer['path'], 'path')}`)
    } else {
      io.err(USAGE)
      return command === undefined || command === 'help' || command === '--help' ? 0 : 2
    }
    return 0
  } catch (error) {
    io.err(`ws: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
