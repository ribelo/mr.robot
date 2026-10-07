import { env, reset, SELF } from 'cloudflare:test'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostView, Me, RobotSummary } from '@mr-robot/protocol'
import { frame, HostError, HostRpcs, parseFrame, serveHost } from '@mr-robot/host-protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

const ran: string[] = []
const open: WebSocket[] = []

afterEach(async () => {
  for (const socket of open.splice(0)) {
    try { socket.close(1000) } catch { /* closed */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 50))
})

/** A fake Mr. Robot app: pairs, connects, heartbeats and answers host calls (hs-xax9). */
async function fakeHost(name = 'Desk') {
  const start = await SELF.fetch('https://mr-robot.test/api/host/pair/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, platform: 'linux' }) })
  const { code, approveUrl } = (await start.json()) as { code: string; approveUrl: string }
  expect(approveUrl).toBe(`https://mr-robot.test/#/pair/${code}`)
  expect((await api<{ name: string }>(ANNA, `/api/hosts/pair/${code}`)).body.name).toBe(name)
  await api(ANNA, `/api/hosts/pair/${code}`, { body: {} })
  const paired = (await (await SELF.fetch(`https://mr-robot.test/api/host/pair/poll?code=${code}`)).json()) as { status: string; hostId: string; token: string }
  expect(paired.status).toBe('paired')
  // The token is handed over once.
  expect(((await (await SELF.fetch(`https://mr-robot.test/api/host/pair/poll?code=${code}`)).json()) as { status: string }).status).toBe('expired')
  const connect = (token = paired.token) => SELF.fetch('https://mr-robot.test/api/host/connect', { headers: { upgrade: 'websocket', 'x-host-id': paired.hostId, authorization: `Bearer ${token}` } })
  const response = await connect()
  const socket = response.webSocket!
  socket.accept()
  open.push(socket)
  const closes: number[] = []
  socket.addEventListener('close', (event) => closes.push(event.code))
  const handlers = HostRpcs.toLayer({
    Read: ({ path }) => path === '/root/secret' ? Effect.fail(new HostError({ message: 'permission denied', code: 'EACCES' })) : Effect.succeed({ path, size: 5, text: 'hello', base64: null }),
    Write: ({ path, text }) => Effect.succeed({ path, bytes: (text ?? '').length }),
    Run: ({ command }) => Effect.sync(() => { ran.push(command); return { stdout: `ran: ${command}`, stderr: '', exitCode: 0, timedOut: false } }),
    BrowserOpen: () => Effect.fail(new HostError({ message: 'no Chrome in the fake host' })),
    BrowserClose: () => Effect.void,
  })
  const host = serveHost(handlers, (text) => socket.send(text))
  socket.addEventListener('message', (event) => {
    const parsed = parseFrame(String(event.data))
    if (parsed?.t === 'rpc') Effect.runFork(host.deliver(parsed.d))
  })
  Effect.runFork(host.server)
  socket.send(frame({ t: 'hb', d: { version: '0.1.0', platform: 'linux', hostname: 'desk', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome' } } }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { hostId: paired.hostId, token: paired.token, socket, closes, connect }
}

async function robotWith(as: string, hosts: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: [], skills: [], recipients: [], secrets: [], hosts } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(as: string, id: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(as, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
}

/** The message of a refused RPC call. */
async function refusal(call: () => Promise<unknown>): Promise<string> {
  try {
    await call()
    return 'not refused'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

let annaId = ''

const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe('Hosts (v1.2 tickets 01 and 02)', () => {
  it('pairs, shows online with its heartbeat, shares with the Home, and unpairs (hs-hend, hs-ro43, hs-0eka, hs-rwxw, hs-7dlt)', async () => {
    const host = await fakeHost()
    const mine = (await api<HostView[]>(ANNA, '/api/hosts')).body
    expect(mine).toEqual([expect.objectContaining({ id: host.hostId, name: 'Desk', online: true, version: '0.1.0', mine: true, sharing: 'private', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome' } })])
    expect((await api<HostView[]>(BEN, '/api/hosts')).body).toEqual([])
    await api(ANNA, `/api/hosts/${host.hostId}`, { method: 'PATCH', body: { sharing: 'home' } })
    expect((await api<HostView[]>(BEN, '/api/hosts')).body).toEqual([expect.objectContaining({ id: host.hostId, mine: false, ownerName: expect.any(String) })])
    const admin = (await api<{ hosts: HostView[] }>(ANNA, '/api/admin')).body.hosts
    expect(admin).toEqual([expect.objectContaining({ name: 'Desk', online: true, version: '0.1.0' })])
    await api(ANNA, `/api/hosts/${host.hostId}`, { method: 'DELETE' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(host.closes).toContain(4001)
    expect((await host.connect()).status).toBe(401)
    expect((await api<HostView[]>(ANNA, '/api/hosts')).body).toEqual([])
  })

  it('refuses a call without the grant at the Member DO; with it the shell and files work (hs-5ktw, hs-n34u, hs-869j)', async () => {
    const host = await fakeHost()
    const without = await robotWith(ANNA, [`${host.hostId}:files`])
    await say(ANNA, without, [{ calls: [{ name: 'host_read', args: { host: 'Desk', path: '/etc/hostname' } }] }, { calls: [{ name: 'host_write', args: { host: 'Desk', path: '/tmp/x', content: 'abc' } }] }, { calls: [{ name: 'host_read', args: { host: 'Desk', path: '/root/secret' } }] }, { text: 'ok' }])
    const [read, written, denied] = toolResults(without)
    expect(read).toContain('"text": "hello"')
    expect(read).toContain('"host": "Desk"')
    expect(written).toContain('"bytes": 3')
    expect(denied).toContain('permission denied (EACCES)')
    // host_run is not offered without the shell grant; the Member DO refuses it too.
    expect(JSON.stringify(requests.get(without)!.at(-1)!.tools)).not.toContain('host_run')
    expect(await refusal(() => env.MEMBER.getByName(annaId).hostRun(host.hostId, without, { command: 'id' }))).toMatch(/no shell grant/)
    expect(ran).not.toContain('id')
    const shell = await robotWith(ANNA, [`${host.hostId}:shell`])
    await say(ANNA, shell, [{ calls: [{ name: 'host_run', args: { host: 'Desk', command: 'leash --help' } }] }, { text: 'ok' }])
    expect(toolResults(shell)[0]).toContain('ran: leash --help')
    expect(JSON.stringify((await api(ANNA, `/api/robots/${shell}/trajectory`)).body)).toContain('leash --help')
  })

  it("lets Mr. Robot use the host without a grant (hs-44cm); a private host refuses another Member's robot", async () => {
    const host = await fakeHost()
    const mr = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await api(ANNA, `/api/robots/${mr}/settings`, { method: 'PATCH', body: { codeMode: false } })
    await say(ANNA, mr, [{ calls: [{ name: 'host_run', args: { host: 'Desk', command: 'uptime' } }] }, { text: 'ok' }])
    expect(toolResults(mr)[0]).toContain('ran: uptime')
    const bens = await robotWith(BEN, [`${host.hostId}:shell`])
    expect(await refusal(() => env.MEMBER.getByName(annaId).hostRun(host.hostId, bens, { command: 'whoami' }))).toMatch(/no shell grant/)
  })

  it('fails clearly when the host is offline, and marks it offline when heartbeats stop (hs-bfr8, hs-7dlt)', async () => {
    const host = await fakeHost()
    const robot = await robotWith(ANNA, [`${host.hostId}:shell`])
    host.socket.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await api<HostView[]>(ANNA, '/api/hosts')).body[0]?.online).toBe(false)
    await say(ANNA, robot, [{ calls: [{ name: 'host_run', args: { host: 'Desk', command: 'ls' } }] }, { text: 'offline' }])
    expect(toolResults(robot)[0]).toContain('is offline')
    expect(toolResults(robot)[0]).toContain('do not switch to a cloud browser')
    const again = await fakeHost('Box')
    const member = env.MEMBER.getByName((await api<Me>(ANNA, '/api/me')).body.id)
    await member.sweepHosts(Date.now() + 60_000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await api<HostView[]>(ANNA, '/api/hosts')).body.find((entry) => entry.id === again.hostId)?.online).toBe(false)
    expect(again.closes).toContain(4002)
  })

  it('tells the owner when a Routine meets an offline host (hs-nwcl)', async () => {
    const host = await fakeHost()
    const robot = await robotWith(ANNA, [`${host.hostId}:shell`])
    host.socket.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const member = env.MEMBER.getByName(annaId) as unknown as { deliveredForTest(): Promise<Array<{ body: string }>> }
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    await api(ANNA, '/api/push/subscriptions', { body: { endpoint: 'https://push.example/phone', keys: { p256dh: b64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)), auth: b64(crypto.getRandomValues(new Uint8Array(16))) }, device: 'phone' } })
    scripts.set(robot, [{ calls: [{ name: 'host_run', args: { host: 'Desk', command: 'backup' } }] }, { text: 'The host is offline.' }])
    await testRobot(robot).wake({ kind: 'routine', sender: { kind: 'routine', routineId: 'rt-1', name: 'Backup' }, text: 'Run the backup.' })
    await settle(robot)
    expect((await member.deliveredForTest()).map((sent) => sent.body).join(' | ')).toContain('could not finish a routine: the host "Desk" is offline')
  })

  it("shows a Robot's notification on the owner's paired computer (pl-b5vp)", async () => {
    const desk = await fakeHost()
    const frames: Array<{ t: string; d: { title?: string; body?: string; url?: string } }> = []
    desk.socket.addEventListener('message', (event) => { const parsed = parseFrame(String(event.data)); if (parsed?.t === 'notify') frames.push(parsed as never) })
    const id = await robotWith(ANNA, [])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: ['notify'], skills: [], recipients: [], secrets: [], hosts: [] } } })
    await say(ANNA, id, [{ calls: [{ name: 'notify_owner', args: { message: 'Done.' } }] }, { text: 'Told you.' }])
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(frames.some((entry) => entry.d.body === 'Done.' && entry.d.url === `/#/r/${encodeURIComponent(id)}`)).toBe(true)
  })
})
