import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { describe, expect, it } from 'vitest'
import type { HostAccess } from '../src/index.ts'
import { frame, HostError, HostRpcs, makeHostClient, parseFrame, serveHost } from '../src/index.ts'

const access: HostAccess = { robot: 'bot-1', mode: 'workspace-write', roots: [] }

describe('the host protocol over a socket', () => {
  it('carries a typed call and a typed error both ways', async () => {
    const handlers = HostRpcs.toLayer({
      Read: ({ path }) => path === '/nope' ? Effect.fail(new HostError({ message: 'no such file', code: 'ENOENT' })) : Effect.succeed({ path, size: 2, text: 'hi', base64: null }),
      Write: ({ path, text }) => Effect.succeed({ path, bytes: (text ?? '').length }),
      Run: ({ command, access }) => Effect.succeed({ kind: 'foreground' as const, cwd: `/home/u/mr-robot/${access.robot}`, exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 120_000, stdout: { text: command, truncated: false }, stderr: { text: '', truncated: false } }),
      JobOutput: () => Effect.succeed({ text: '', bytes: 0, size: 0 }),
      JobList: () => Effect.succeed({ jobs: [] }),
      JobKill: () => Effect.succeed({ outcome: 'requested' as const }),
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
      const read = yield* client.Read({ path: '/etc/hostname', access })
      const run = yield* client.Run({ command: 'echo ok', background: false, job: 'r:j-1', access })
      const missing = yield* Effect.exit(client.Read({ path: '/nope', access }))
      return { read, run, missing }
    })
    const { read, run, missing } = await Effect.runPromise(Effect.scoped(program))
    expect(read).toEqual({ path: '/etc/hostname', size: 2, text: 'hi', base64: null })
    expect(run).toMatchObject({ kind: 'foreground', cwd: '/home/u/mr-robot/bot-1', stdout: { text: 'echo ok' } })
    expect(Exit.isFailure(missing) && JSON.stringify(missing)).toContain('ENOENT')
  })

  it('carries the three shapes of a command\'s answer, and a job frame', async () => {
    const handlers = HostRpcs.toLayer({
      Run: ({ background, job }) => Effect.succeed(background
        ? { kind: 'background' as const, cwd: '/w', timeoutMs: 1000, jobId: job }
        : { kind: 'promoted' as const, cwd: '/w', timeoutMs: 1000, jobId: job, output: 'so far' }),
      JobList: () => Effect.succeed({ jobs: [{ job: 'r:j-1', command: 'make', state: 'running' as const, exitCode: null, signal: null, startedAt: 1, finishedAt: null }] }),
      JobOutput: ({ offset }) => Effect.succeed({ text: 'x', bytes: 1, size: offset + 1 }),
      JobKill: () => Effect.succeed({ outcome: 'already-finished' as const }),
    } as never)
    const program = Effect.gen(function* () {
      let toClient: (text: string) => void = () => undefined
      let toServer: (text: string) => void = () => undefined
      const host = serveHost(handlers, (text) => toClient(text))
      const side = makeHostClient((text) => toServer(text))
      toServer = (text) => { const f = parseFrame(text); if (f?.t === 'rpc') Effect.runFork(host.deliver(f.d)) }
      toClient = (text) => { const f = parseFrame(text); if (f?.t === 'rpc') Effect.runFork(side.deliver(f.d)) }
      yield* Effect.forkScoped(host.server)
      const client = yield* side.client
      return {
        background: yield* client.Run({ command: 'make', background: true, job: 'r:j-1', access }),
        promoted: yield* client.Run({ command: 'make', background: false, job: 'r:j-2', access }),
        list: yield* client.JobList({ robot: 'r' }),
        output: yield* client.JobOutput({ job: 'r:j-1', stream: 'out', offset: 4 }),
        kill: yield* client.JobKill({ job: 'r:j-1' }),
      }
    })
    const result = await Effect.runPromise(Effect.scoped(program))
    expect(result.background).toEqual({ kind: 'background', cwd: '/w', timeoutMs: 1000, jobId: 'r:j-1' })
    expect(result.promoted).toMatchObject({ kind: 'promoted', jobId: 'r:j-2', output: 'so far' })
    expect(result.list.jobs[0]).toMatchObject({ job: 'r:j-1', state: 'running' })
    expect(result.output).toEqual({ text: 'x', bytes: 1, size: 5 })
    expect(result.kill).toEqual({ outcome: 'already-finished' })
    const ended = frame({ t: 'job', d: { job: 'r:j-1', state: 'completed', exitCode: 0, signal: null } })
    expect(parseFrame(ended)).toEqual({ t: 'job', d: { job: 'r:j-1', state: 'completed', exitCode: 0, signal: null } })
  })
})
