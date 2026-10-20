/**
 * The Host app copies a file over presigned URLs (v1.16 ticket 06): the real handlers over real files, driven through the Host protocol the way
 * the Worker drives them, client and server joined in process. R2 is a map behind the `fetch` the handlers are given.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CopyIo } from '@mr-robot/host-protocol'
import { access, connected } from './connected.ts'

let dir = ''
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'host-copy-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

/**
 * R2 behind presigned URLs: PUT keeps the body under its URL, GET answers a range of it. A request whose URL is in `held` gets no answer
 * until its signal is aborted; `stopped` lists the URLs of the requests that ended that way.
 */
function r2() {
  const objects = new Map<string, Uint8Array>()
  const held = new Set<string>()
  const waiting: string[] = []
  const stopped: string[] = []
  const requests: string[] = []
  const io: CopyIo = {
    sleep: async () => undefined,
    fetch: async (url, init) => {
      requests.push(`${init.method} ${url}`)
      if (held.has(url)) {
        waiting.push(url)
        return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => { stopped.push(url); reject(init.signal?.reason) }))
      }
      if (init.method === 'PUT') {
        objects.set(url, new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()))
        return new Response(null, { status: 200, headers: { etag: `"e-${url.slice(-1)}"` } })
      }
      const object = objects.get(url)
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range') ?? '')
      return object === undefined || range === null ? new Response('no', { status: 404 }) : new Response(object.slice(Number(range[1]), Number(range[2]) + 1), { status: 206 })
    },
  }
  return { io, objects, held, waiting, stopped, requests }
}

/** Wait until `check` holds; the sandboxed changes are processes of their own and end a moment later. */
async function eventually(check: () => Promise<boolean> | boolean, ms = 10_000): Promise<void> {
  for (const started = Date.now(); !(await check()); ) {
    if (Date.now() - started > ms) throw new Error('it did not happen in time')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const bytesOf = (length: number, seed: number) => Uint8Array.from({ length }, (_, index) => (index * seed + (index >> 9)) & 255)
const partFiles = async (directory: string) => (await readdir(directory)).filter((name) => name.endsWith('.mr-robot-part'))

describe('the Host app copies a file over presigned URLs', () => {
  it('reports the size, uploads a file in parts and downloads it in ranges, byte for byte, creating its folders', async () => {
    const bytes = Uint8Array.from({ length: 2_500_007 }, (_, index) => (index * 7 + (index >> 10)) & 255)
    const source = join(dir, 'source.bin')
    await writeFile(source, bytes)
    const { io, objects } = r2()
    const { rpc, close } = await connected(dir, io)
    // The files live outside the Robot's directory, so the grant is full.
    const full = access({ mode: 'full' })
    expect(await Effect.runPromise(rpc['CopyStat']!({ path: source, access: full }))).toEqual({ path: source, size: bytes.length })

    const partBytes = 1_000_000
    const parts = [0, 1, 2].map((index) => ({ number: index + 1, url: `https://r2.test/up?part=${index + 1}`, offset: index * partBytes, length: Math.min(partBytes, bytes.length - index * partBytes) }))
    const sent = await Effect.runPromise(rpc['Upload']!({ path: source, size: bytes.length, parts, access: full }))
    expect(sent.etags).toEqual([{ number: 1, etag: '"e-1"' }, { number: 2, etag: '"e-2"' }, { number: 3, etag: '"e-3"' }])
    expect([...objects.values()].reduce((total, part) => total + part.length, 0)).toBe(bytes.length)

    objects.clear()
    objects.set('https://r2.test/obj', bytes)
    const target = join(dir, 'deep', 'er', 'copy.bin')
    expect(await Effect.runPromise(rpc['Download']!({ copy: 'c-1', path: target, url: 'https://r2.test/obj', size: bytes.length, partBytes, from: 0, until: bytes.length, access: full }))).toEqual({ path: target, bytes: bytes.length })
    expect(new Uint8Array(await readFile(target))).toEqual(bytes)
    // Nothing but the file itself is left beside it.
    expect(await readdir(join(dir, 'deep', 'er'))).toEqual(['copy.bin'])
    await close()
  })

  it('downloads in windows with a fresh link each, and the file appears only when the last window arrived', async () => {
    const bytes = bytesOf(300_000, 13)
    const { io, objects } = r2()
    objects.set('https://r2.test/first', bytes)
    objects.set('https://r2.test/second', bytes)
    const { rpc, close } = await connected(dir, io)
    const full = access({ mode: 'full' })
    const target = join(dir, 'windowed', 'copy.bin')
    const partBytes = 100_000
    await Effect.runPromise(rpc['Download']!({ copy: 'c-2', path: target, url: 'https://r2.test/first', size: bytes.length, partBytes, from: 0, until: 200_000, access: full }))
    // Half-way, nothing is at the path yet: only the copy's own part file.
    expect(await readdir(join(dir, 'windowed'))).toEqual([expect.stringMatching(/^copy\.bin\.[0-9a-f]{8}\.mr-robot-part$/)])
    await Effect.runPromise(rpc['Download']!({ copy: 'c-2', path: target, url: 'https://r2.test/second', size: bytes.length, partBytes, from: 200_000, until: bytes.length, access: full }))
    expect(new Uint8Array(await readFile(target))).toEqual(bytes)
    expect(await readdir(join(dir, 'windowed'))).toEqual(['copy.bin'])
    await close()
  })

  it('names a missing file with its code, refuses a changed size, and leaves no half-written file when a download fails', async () => {
    const { io } = r2()
    const { rpc, close } = await connected(dir, io)
    const full = access({ mode: 'full' })
    const missing = await Effect.runPromise(Effect.flip(rpc['CopyStat']!({ path: join(dir, 'nope'), access: full }))) as { code?: string }
    expect(missing.code).toBe('ENOENT')
    const small = join(dir, 'small.bin')
    await writeFile(small, 'abc')
    const changed = await Effect.runPromise(Effect.flip(rpc['Upload']!({ path: small, size: 99, parts: [], access: full }))) as { message: string }
    expect(changed.message).toBe('the file changed while it was copied')
    const target = join(dir, 'failed.bin')
    const failed = await Effect.runPromise(Effect.flip(rpc['Download']!({ copy: 'c-3', path: target, url: 'https://r2.test/none', size: 10, partBytes: 10, from: 0, until: 10, access: full }))) as { message: string }
    expect(failed.message).toContain('R2 answered 404')
    expect(await readdir(dir)).not.toContain('failed.bin')
    expect(await partFiles(dir)).toEqual([])
    await close()
  })
})

// Deep review P12: the Worker gives up on a call when its deadline passes (Effect's timeout interrupts it, and the client tells the app);
// a copy it gave up on may be tried again at once.
describe('a copy the Worker gave up on', () => {
  it('stops a download: the request in flight ends, and its part file goes', async () => {
    const { io, objects, held, waiting, stopped } = r2()
    const bytes = bytesOf(200_000, 7)
    objects.set('https://r2.test/obj', bytes)
    // The first range arrives; the second hangs, as on a line that stalled.
    let ranges = 0
    const fetch = io.fetch
    const stalling: CopyIo = { ...io, fetch: (url, init) => fetch(++ranges === 2 ? 'https://r2.test/stall' : url, init) }
    held.add('https://r2.test/stall')
    const { rpc, close } = await connected(dir, stalling)
    const target = join(dir, 'stopped', 'copy.bin')
    const fiber = Effect.runFork(rpc['Download']!({ copy: 'c-4', path: target, url: 'https://r2.test/obj', size: bytes.length, partBytes: 100_000, from: 0, until: bytes.length, access: access({ mode: 'full' }) }))
    await eventually(() => waiting.length === 1)
    expect(await partFiles(join(dir, 'stopped'))).toHaveLength(1)
    await Effect.runPromise(Fiber.interrupt(fiber))
    await eventually(async () => stopped.length === 1 && (await partFiles(join(dir, 'stopped'))).length === 0)
    expect(await readdir(join(dir, 'stopped'))).toEqual([])
    await close()
  })

  it('keeps a second copy of the same file apart from the first one, which still runs: the file is the second copy, whole', async () => {
    const { io, objects, held, waiting } = r2()
    const first = bytesOf(200_000, 3)
    const second = bytesOf(200_000, 11)
    objects.set('https://r2.test/first', first)
    objects.set('https://r2.test/second', second)
    let firstRanges = 0
    const fetch = io.fetch
    // The first copy's second range hangs: that copy is still running when the second one starts.
    const stalling: CopyIo = { ...io, fetch: (url, init) => fetch(url === 'https://r2.test/first' && ++firstRanges === 2 ? 'https://r2.test/stall' : url, init) }
    held.add('https://r2.test/stall')
    const { rpc, close } = await connected(dir, stalling)
    const full = access({ mode: 'full' })
    const target = join(dir, 'twice', 'copy.bin')
    const old = Effect.runFork(rpc['Download']!({ copy: 'c-5', path: target, url: 'https://r2.test/first', size: first.length, partBytes: 100_000, from: 0, until: first.length, access: full }))
    await eventually(() => waiting.length === 1)
    await Effect.runPromise(rpc['Download']!({ copy: 'c-6', path: target, url: 'https://r2.test/second', size: second.length, partBytes: 100_000, from: 0, until: second.length, access: full }))
    expect(new Uint8Array(await readFile(target))).toEqual(second)
    // The first copy's part file is its own, beside the file.
    expect(await partFiles(join(dir, 'twice'))).toHaveLength(1)
    await Effect.runPromise(Fiber.interrupt(old))
    await eventually(async () => (await partFiles(join(dir, 'twice'))).length === 0)
    expect(await readdir(join(dir, 'twice'))).toEqual(['copy.bin'])
    expect(new Uint8Array(await readFile(target))).toEqual(second)
    await close()
  })

  it('stops an upload: the part in flight ends and no other part is sent', async () => {
    const { io, held, waiting, stopped, requests } = r2()
    const source = join(dir, 'upload-stopped.bin')
    await writeFile(source, bytesOf(30, 5))
    held.add('https://r2.test/up?part=1')
    const { rpc, close } = await connected(dir, io)
    const parts = [0, 1, 2].map((index) => ({ number: index + 1, url: `https://r2.test/up?part=${index + 1}`, offset: index * 10, length: 10 }))
    const fiber = Effect.runFork(rpc['Upload']!({ path: source, size: 30, parts, access: access({ mode: 'full' }) }))
    await eventually(() => waiting.length === 1)
    await Effect.runPromise(Fiber.interrupt(fiber))
    await eventually(() => stopped.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(requests).toEqual(['PUT https://r2.test/up?part=1'])
    await close()
  })

  it('removes a part file whose copy stopped coming, and refuses a later window of that copy', async () => {
    const { io, objects } = r2()
    const bytes = bytesOf(200_000, 17)
    objects.set('https://r2.test/obj', bytes)
    const { rpc, close } = await connected(dir, io, { downloadIdleMs: 50 })
    const full = access({ mode: 'full' })
    const target = join(dir, 'idle', 'copy.bin')
    const window = (from: number, until: number) => ({ copy: 'c-7', path: target, url: 'https://r2.test/obj', size: bytes.length, partBytes: 100_000, from, until, access: full })
    await Effect.runPromise(rpc['Download']!(window(0, 100_000)))
    await eventually(async () => (await readdir(join(dir, 'idle'))).length === 0)
    const refused = await Effect.runPromise(Effect.flip(rpc['Download']!(window(100_000, 200_000)))) as { message: string; code?: string }
    expect(refused.code).toBe('ECANCELED')
    expect(refused.message).toContain('Copy the file again')
    expect(await readdir(join(dir, 'idle'))).toEqual([])
    await close()
  })
})
