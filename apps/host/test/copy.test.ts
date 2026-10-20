/**
 * The Host app copies a file over presigned URLs (v1.16 ticket 06): the real handlers over real files, driven through the Host protocol the way
 * the Worker drives them, client and server joined in process. R2 is a map behind the `fetch` the handlers are given.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CopyIo } from '@mr-robot/host-protocol'
import { access, connected } from './connected.ts'

let dir = ''
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'host-copy-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

/** R2 behind presigned URLs: PUT keeps the body under its URL, GET answers a range of it. */
function r2() {
  const objects = new Map<string, Uint8Array>()
  const io: CopyIo = {
    sleep: async () => undefined,
    fetch: async (url, init) => {
      if (init.method === 'PUT') {
        objects.set(url, new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()))
        return new Response(null, { status: 200, headers: { etag: `"e-${url.slice(-1)}"` } })
      }
      const held = objects.get(url)
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range') ?? '')
      return held === undefined || range === null ? new Response('no', { status: 404 }) : new Response(held.slice(Number(range[1]), Number(range[2]) + 1), { status: 206 })
    },
  }
  return { io, objects }
}

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
    expect(await Effect.runPromise(rpc['Download']!({ path: target, url: 'https://r2.test/obj', size: bytes.length, partBytes, from: 0, until: bytes.length, access: full }))).toEqual({ path: target, bytes: bytes.length })
    expect(new Uint8Array(await readFile(target))).toEqual(bytes)
    // Nothing but the file itself is left beside it.
    expect(await readdir(join(dir, 'deep', 'er'))).toEqual(['copy.bin'])
    await close()
  })

  it('downloads in windows with a fresh link each, and the file appears only when the last window arrived', async () => {
    const bytes = Uint8Array.from({ length: 300_000 }, (_, index) => (index * 13 + (index >> 9)) & 255)
    const { io, objects } = r2()
    objects.set('https://r2.test/first', bytes)
    objects.set('https://r2.test/second', bytes)
    const { rpc, close } = await connected(dir, io)
    const full = access({ mode: 'full' })
    const target = join(dir, 'windowed', 'copy.bin')
    const partBytes = 100_000
    await Effect.runPromise(rpc['Download']!({ path: target, url: 'https://r2.test/first', size: bytes.length, partBytes, from: 0, until: 200_000, access: full }))
    // Half-way, nothing is at the path yet.
    expect(await readdir(join(dir, 'windowed'))).toEqual(['copy.bin.mr-robot-part'])
    await Effect.runPromise(rpc['Download']!({ path: target, url: 'https://r2.test/second', size: bytes.length, partBytes, from: 200_000, until: bytes.length, access: full }))
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
    const failed = await Effect.runPromise(Effect.flip(rpc['Download']!({ path: target, url: 'https://r2.test/none', size: 10, partBytes: 10, from: 0, until: 10, access: full }))) as { message: string }
    expect(failed.message).toContain('R2 answered 404')
    expect(await readdir(dir)).not.toContain('failed.bin')
    expect(await readdir(dir)).not.toContain('failed.bin.mr-robot-part')
    await close()
  })
})
