/**
 * The Host app's pieces of a file (v1.15 ticket 09): the real handlers over real files, driven through the Host protocol the way the Worker
 * drives them, client and server joined in process.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COPY_CHUNK_BYTES } from '@mr-robot/host-protocol'
import { access, connected } from './connected.ts'

let dir = ''
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'host-copy-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('the Host app copies a file in pieces', () => {
  it('reads a file piece by piece and writes it back in pieces, byte for byte, creating its folders', async () => {
    const bytes = Uint8Array.from({ length: COPY_CHUNK_BYTES * 2 + 12_345 }, (_, index) => (index * 7 + (index >> 10)) & 255)
    const source = join(dir, 'source.bin')
    await writeFile(source, bytes)
    const { rpc, close } = await connected(dir)
    // The files live outside the Robot's directory, so the grant is full.
    const full = access({ mode: 'full' })
    const target = join(dir, 'deep', 'er', 'copy.bin')
    let offset = 0
    let size = Infinity
    while (offset < size) {
      const piece = await Effect.runPromise(rpc['ReadChunk']!({ path: source, offset, length: COPY_CHUNK_BYTES, access: full }))
      size = piece.size
      expect(size).toBe(bytes.length)
      const body = Buffer.from(piece.base64, 'base64')
      expect(body.length).toBe(Math.min(COPY_CHUNK_BYTES, bytes.length - offset))
      await Effect.runPromise(rpc['WriteChunk']!({ path: target, offset, base64: piece.base64, access: full }))
      offset += body.length
    }
    expect((await stat(target)).size).toBe(bytes.length)
    expect(new Uint8Array(await readFile(target))).toEqual(bytes)
    // The piece at offset 0 starts the file afresh.
    await Effect.runPromise(rpc['WriteChunk']!({ path: target, offset: 0, base64: Buffer.from('short').toString('base64'), access: full }))
    expect(await readFile(target, 'utf8')).toBe('short')
    // A read past the end is empty; a missing file is a HostError with its code.
    expect((await Effect.runPromise(rpc['ReadChunk']!({ path: source, offset: bytes.length + 5, length: 10, access: full }))).base64).toBe('')
    const missing = await Effect.runPromise(Effect.flip(rpc['ReadChunk']!({ path: join(dir, 'nope'), offset: 0, length: 10, access: full }))) as { code?: string }
    expect(missing.code).toBe('ENOENT')
    await close()
  })
})
