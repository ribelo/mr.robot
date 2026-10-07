import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { describe, expect, it } from 'vitest'
import { HostError, HostRpcs, makeHostClient, parseFrame, serveHost } from '../src/index.ts'

describe('the host protocol over a socket', () => {
  it('carries a typed call and a typed error both ways', async () => {
    const handlers = HostRpcs.toLayer({
      Read: ({ path }) => path === '/nope' ? Effect.fail(new HostError({ message: 'no such file', code: 'ENOENT' })) : Effect.succeed({ path, size: 2, text: 'hi', base64: null }),
      Write: ({ path, text }) => Effect.succeed({ path, bytes: (text ?? '').length }),
      Run: ({ command }) => Effect.succeed({ stdout: command, stderr: '', exitCode: 0, timedOut: false }),
      BrowserOpen: () => Effect.succeed({ browser: 'chrome' }),
      BrowserClose: () => Effect.void,
    })
    const program = Effect.gen(function* () {
      let toClient: (text: string) => void = () => undefined
      let toServer: (text: string) => void = () => undefined
      const host = serveHost(handlers, (text) => toClient(text))
      const side = makeHostClient((text) => toServer(text))
      toServer = (text) => { const f = parseFrame(text); if (f?.t === 'rpc') Effect.runFork(host.deliver(f.d)) }
      toClient = (text) => { const f = parseFrame(text); if (f?.t === 'rpc') Effect.runFork(side.deliver(f.d)) }
      yield* Effect.forkScoped(host.server)
      const client = yield* side.client
      const read = yield* client.Read({ path: '/etc/hostname' })
      const run = yield* client.Run({ command: 'echo ok' })
      const missing = yield* Effect.exit(client.Read({ path: '/nope' }))
      return { read, run, missing }
    })
    const { read, run, missing } = await Effect.runPromise(Effect.scoped(program))
    expect(read).toEqual({ path: '/etc/hostname', size: 2, text: 'hi', base64: null })
    expect(run.stdout).toBe('echo ok')
    expect(Exit.isFailure(missing) && JSON.stringify(missing)).toContain('ENOENT')
  })
})
