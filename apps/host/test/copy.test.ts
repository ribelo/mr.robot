/**
 * The Host app's pieces of a file (v1.15 ticket 09): the real handlers over real files, driven through the Host protocol the way the Worker
 * drives them, client and server joined in process.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COPY_CHUNK_BYTES, makeHostClient, parseFrame, serveHost, type HostRpcs } from '@mr-robot/host-protocol'
import { hostHandlers } from '../src/handlers.ts'

let dir = ''
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'host-copy-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

/** Client and server of the Host protocol joined in this process. */
async function connected() {
  const chrome = { devtools: async () => { throw new Error('no Chrome here') } } as never
  let toClient: (text: string) => void = () => undefined
  const server = serveHost(hostHandlers(chrome, () => ({ hostId: 'h', token: 't' }), () => undefined), (text) => toClient(text))
  const client = makeHostClient((text) => {
    const parsed = parseFrame(text)
    if (parsed?.t === 'rpc') Effect.runFork(server.deliver(parsed.d))
  })
  toClient = (text) => {
    const parsed = parseFrame(text)
    if (parsed?.t === 'rpc') Effect.runFork(client.deliver(parsed.d))
  }
  const scope = Effect.runSync(Scope.make())
  Effect.runFork(Scope.provide(server.server, scope))
  const rpc = await Effect.runPromise(Scope.provide(client.client, scope)) as unknown as { [K in keyof typeof HostRpcs.requests as string]: never } & Record<string, (payload: unknown) => Effect.Effect<any, any>>
  return { rpc, close: () => Effect.runPromise(Scope.close(scope, { _tag: 'Success', value: undefined } as never)) }
}

describe('the Host app copies a file in pieces', () => {
  it('reads a file piece by piece and writes it back in pieces, byte for byte, creating its folders', async () => {
    const bytes = Uint8Array.from({ length: COPY_CHUNK_BYTES * 2 + 12_345 }, (_, index) => (index * 7 + (index >> 10)) & 255)
    const source = join(dir, 'source.bin')
    await writeFile(source, bytes)
    const { rpc, close } = await connected()
    const target = join(dir, 'deep', 'er', 'copy.bin')
    let offset = 0
    let size = Infinity
    while (offset < size) {
      const piece = await Effect.runPromise(rpc['ReadChunk']!({ path: source, offset, length: COPY_CHUNK_BYTES }))
      size = piece.size
      expect(size).toBe(bytes.length)
      const body = Buffer.from(piece.base64, 'base64')
      expect(body.length).toBe(Math.min(COPY_CHUNK_BYTES, bytes.length - offset))
      await Effect.runPromise(rpc['WriteChunk']!({ path: target, offset, base64: piece.base64 }))
      offset += body.length
    }
    expect((await stat(target)).size).toBe(bytes.length)
    expect(new Uint8Array(await readFile(target))).toEqual(bytes)
    // The piece at offset 0 starts the file afresh.
    await Effect.runPromise(rpc['WriteChunk']!({ path: target, offset: 0, base64: Buffer.from('short').toString('base64') }))
    expect(await readFile(target, 'utf8')).toBe('short')
    // A read past the end is empty; a missing file is a HostError with its code.
    expect((await Effect.runPromise(rpc['ReadChunk']!({ path: source, offset: bytes.length + 5, length: 10 }))).base64).toBe('')
    const missing = await Effect.runPromise(Effect.flip(rpc['ReadChunk']!({ path: join(dir, 'nope'), offset: 0, length: 10 }))) as { code?: string }
    expect(missing.code).toBe('ENOENT')
    await close()
  })
})
