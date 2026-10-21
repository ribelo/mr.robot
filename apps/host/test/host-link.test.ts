/**
 * The app's link to the Worker (connection.ts) over a real WebSocket, with a Worker of the test's own that calls the Host protocol as the
 * real one does. Deep review P17: when this computer is unpaired (close code 4001) or its token is refused (401, the Member signed it out),
 * the jobs it runs for Robots stop, since none of them can report anywhere; a connection that only drops leaves them running (P11).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { HOST_PROTOCOL_VERSION, makeHostClient, parseFrame } from '@mr-robot/host-protocol'
import { HostLink } from '../src/connection.ts'
import { HostShell } from '../src/shell.ts'
import { access, jobName } from './connected.ts'

let home = ''
let shell: HostShell
let worker: WebSocketServer
/** The Worker's side of each connection the app made, newest last. */
const sockets: WebSocket[] = []
/** Every frame the Worker heard from the app. */
const heard: string[] = []
/** Whether the Worker takes the app's token. */
let tokenValid = true

beforeAll(async () => {
  home = await mkdtemp(join(homedir(), '.mr-robot-host-link-'))
  shell = await HostShell.start({ home })
  worker = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: (_info, done) => done(tokenValid, 401) })
  worker.on('connection', (socket) => {
    sockets.push(socket)
    socket.on('message', (data) => heard.push(data.toString()))
  })
  await new Promise((resolve) => worker.once('listening', resolve))
})
afterAll(async () => {
  await new Promise((resolve) => worker.close(resolve))
  await shell.dispose()
  await rm(home, { recursive: true, force: true })
})

/** The app's link, started against the test's Worker; `unpaired` counts what it told the app. */
function link() {
  const events = { unpaired: 0 }
  const host = new HostLink({ server: `http://127.0.0.1:${(worker.address() as AddressInfo).port}`, hostId: 'h', token: 't', version: 'test' }, shell, {} as never, {
    state: () => undefined,
    paired: () => undefined,
    unpaired: () => { events.unpaired += 1 },
    sessions: () => undefined,
    notify: () => undefined,
  })
  host.start()
  return { host, events }
}

/** The Worker starts a command as a job over the newest connection. */
async function startJob(): Promise<string> {
  const socket = sockets.at(-1)!
  const client = makeHostClient((text) => socket.send(text))
  socket.on('message', (data) => {
    const parsed = parseFrame(data.toString())
    if (parsed?.t === 'rpc') Effect.runFork(client.deliver(parsed.d))
  })
  const scope = Effect.runSync(Scope.make())
  const rpc = (await Effect.runPromise(Scope.provide(client.client, scope))) as unknown as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>
  const job = jobName()
  await Effect.runPromise(rpc['Run']!({ command: 'sleep 60', background: true, job, access: access({ mode: 'full' }) }))
  return job
}

const state = (job: string) => shell.jobs.list('bot').find((entry) => entry.job === job)?.state

describe('the heartbeat (v1.21, cw-jn59)', () => {
  it('carries the version of the protocol the app speaks', async () => {
    const { host } = link()
    await vi.waitFor(() => expect(heard.map(parseFrame).some((parsed) => parsed?.t === 'hb')).toBe(true))
    const beat = heard.map(parseFrame).find((parsed) => parsed?.t === 'hb')
    expect(beat?.t === 'hb' && beat.d.protocolVersion).toBe(HOST_PROTOCOL_VERSION)
    host.stop()
    // The tests below count the connections from here.
    sockets.length = 0
  })
})

describe('a computer unpaired while its jobs run', () => {
  it('keeps them running over a dropped connection and stops them all when the Worker says it is unpaired', async () => {
    const { host, events } = link()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const first = await startJob()
    const second = await startJob()
    // The Worker stops hearing heartbeats: the app connects again, and the jobs go on.
    sockets.at(-1)!.close(4002, 'no heartbeat')
    await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 5000 })
    expect([state(first), state(second)]).toEqual(['running', 'running'])
    // A Workspace session is open too (v1.21, cw-p4bm): unpairing closes it.
    const session = await shell.sessions.touch('bot', { root: home, repository: home })
    sockets.at(-1)!.close(4001, 'unpaired')
    await vi.waitFor(() => expect(session!.isOpen).toBe(false), { timeout: 5000 })
    await vi.waitFor(() => expect([state(first), state(second)]).toEqual(['killed', 'killed']), { timeout: 5000 })
    expect(events.unpaired).toBe(1)
    host.stop()
  })

  it('stops them when the Worker refuses its token (signed out while the connection was down)', async () => {
    const { host } = link()
    await vi.waitFor(() => expect(sockets).toHaveLength(3))
    const job = await startJob()
    tokenValid = false
    sockets.at(-1)!.close(4002, 'no heartbeat')
    await vi.waitFor(() => expect(state(job)).toBe('killed'), { timeout: 5000 })
    host.stop()
  })
})
