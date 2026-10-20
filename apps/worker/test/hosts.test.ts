import { env, reset, SELF } from 'cloudflare:test'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostView, Me, RobotSummary } from '@mr-robot/protocol'
import { frame, HostError, HostRpcs, parseFrame, serveHost } from '@mr-robot/host-protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import { boxDisks, boxLog } from './stub-box.ts'

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
/** The fake host's disk (v1.15, host_copy): path → bytes; a path in `declaredSize` reports that size and holds nothing. */
const hostDisk = new Map<string, Uint8Array>()
const declaredSize = new Map<string, number>()

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
    ReadChunk: ({ path, offset, length }) => {
      const size = declaredSize.get(path) ?? hostDisk.get(path)?.length
      if (size === undefined) return Effect.fail(new HostError({ message: `no such file: ${path}`, code: 'ENOENT' }))
      const bytes = (hostDisk.get(path) ?? new Uint8Array()).subarray(offset, offset + length)
      let binary = ''
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
      return Effect.succeed({ path, size, base64: btoa(binary) })
    },
    WriteChunk: ({ path, offset, base64 }) => Effect.sync(() => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const before = offset === 0 ? new Uint8Array() : (hostDisk.get(path) ?? new Uint8Array())
      const next = new Uint8Array(Math.max(before.length, offset + bytes.length))
      next.set(before)
      next.set(bytes, offset)
      hostDisk.set(path, next)
      return { path, bytes: bytes.length }
    }),
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

  it('tells the owner when the Turn of a Task meets an offline host (hs-nwcl)', async () => {
    const host = await fakeHost()
    const robot = await robotWith(ANNA, [`${host.hostId}:shell`])
    host.socket.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const member = env.MEMBER.getByName(annaId) as unknown as { deliveredForTest(): Promise<Array<{ body: string }>> }
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    await api(ANNA, '/api/push/subscriptions', { body: { endpoint: 'https://push.example/phone', keys: { p256dh: b64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)), auth: b64(crypto.getRandomValues(new Uint8Array(16))) }, device: 'phone' } })
    scripts.set(robot, [{ calls: [{ name: 'host_run', args: { host: 'Desk', command: 'backup' } }] }, { text: 'The host is offline.' }])
    await testRobot(robot).wake({ kind: 'task', sender: { kind: 'task', taskId: 'rt-1', name: 'Backup' }, text: 'Run the backup.' })
    await settle(robot)
    expect((await member.deliveredForTest()).map((sent) => sent.body).join(' | ')).toContain('could not finish a task: the host "Desk" is offline')
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

  it('logs each host action with the robot, the command and its exit status (pl-vcy7)', async () => {
    const desk = await fakeHost()
    const id = await robotWith(ANNA, [`${desk.hostId}:shell`])
    await say(ANNA, id, [{ calls: [{ name: 'host_run', args: { host: 'Desk', command: 'uname -a' } }] }, { text: 'Ran it.' }])
    const actions = (await api<Array<{ robotName: string; action: string; detail: string; outcome: string; exitCode: number | null }>>(ANNA, `/api/hosts/${desk.hostId}/actions`)).body
    expect(actions[0]).toMatchObject({ robotName: 'New robot', action: 'run', detail: 'uname -a', outcome: 'done', exitCode: 0 })
    expect((await api(BEN, `/api/hosts/${desk.hostId}/actions`)).status).toBe(404)
  })
})

describe('host_copy (v1.15 ticket 09, gb-iw01, gb-rvj5, gb-mcnc)', () => {
  /** A pattern that shows a wrong byte, wrong order or a lost piece: 2.5 MiB, so three pieces. */
  const binary = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 31 + (index >> 8)) & 255)
  const workspaceBytes = async (id: string, path: string) => {
    const object = await env.FILES.get(`robots/${id}/${path}`)
    return object === null ? null : new Uint8Array(await object.arrayBuffer())
  }

  beforeEach(() => {
    hostDisk.clear()
    declaredSize.clear()
  })

  it('copies a binary file each way, byte for byte, in pieces; the result names both paths and the size; the log has one line', async () => {
    const desk = await fakeHost()
    const id = await robotWith(ANNA, [`${desk.hostId}:files`])
    const bytes = binary(2_500_000)
    hostDisk.set('/home/anna/report.bin', bytes)
    await say(ANNA, id, [{ calls: [{ name: 'host_copy', args: { host: 'Desk', direction: 'to_workspace', host_path: '/home/anna/report.bin', workspace_path: 'inbox/report.bin' } }] }, { text: 'Copied.' }])
    expect(toolResults(id).at(-1)).toBeDefined()
    expect(JSON.parse(toolResults(id).at(-1)!)).toEqual({ host: 'Desk', direction: 'to_workspace', hostPath: '/home/anna/report.bin', workspacePath: 'inbox/report.bin', bytes: 2_500_000 })
    expect(await workspaceBytes(id, 'inbox/report.bin')).toEqual(bytes)

    const back = binary(1_048_576)
    await env.FILES.put(`robots/${id}/out/data.bin`, back)
    await say(ANNA, id, [{ calls: [{ name: 'host_copy', args: { host: 'Desk', direction: 'to_host', host_path: '/home/anna/copy/data.bin', workspace_path: 'out/data.bin' } }] }, { text: 'Copied.' }])
    expect(JSON.parse(toolResults(id).at(-1)!)).toMatchObject({ direction: 'to_host', hostPath: '/home/anna/copy/data.bin', workspacePath: 'out/data.bin', bytes: 1_048_576 })
    expect(hostDisk.get('/home/anna/copy/data.bin')).toEqual(back)

    // An empty file copies too.
    await env.FILES.put(`robots/${id}/out/empty.txt`, new Uint8Array())
    await say(ANNA, id, [{ calls: [{ name: 'host_copy', args: { host: 'Desk', direction: 'to_host', host_path: '/home/anna/empty.txt', workspace_path: 'out/empty.txt' } }] }, { text: 'Copied.' }])
    expect(hostDisk.get('/home/anna/empty.txt')).toEqual(new Uint8Array())

    const actions = (await api<Array<{ action: string; detail: string; outcome: string }>>(ANNA, `/api/hosts/${desk.hostId}/actions`)).body
    expect(actions.filter((action) => action.action === 'copy').map((action) => [action.detail, action.outcome])).toEqual([
      ['out/empty.txt → /home/anna/empty.txt', 'done'],
      ['out/data.bin → /home/anna/copy/data.bin', 'done'],
      ['/home/anna/report.bin → inbox/report.bin', 'done'],
    ])
  })

  it('refuses a file over 100 MB with the reason, a missing file, a path outside the Workspace and the platform docs', async () => {
    const desk = await fakeHost()
    const id = await robotWith(ANNA, [`${desk.hostId}:files`])
    declaredSize.set('/home/anna/huge.iso', 100 * 1024 * 1024 + 1)
    await say(ANNA, id, [{ calls: [
      { name: 'host_copy', args: { host: 'Desk', direction: 'to_workspace', host_path: '/home/anna/huge.iso', workspace_path: 'huge.iso' } },
      { name: 'host_copy', args: { host: 'Desk', direction: 'to_workspace', host_path: '/home/anna/nope', workspace_path: 'nope' } },
      { name: 'host_copy', args: { host: 'Desk', direction: 'to_host', host_path: '/home/anna/x', workspace_path: 'out/missing.bin' } },
      { name: 'host_copy', args: { host: 'Desk', direction: 'to_workspace', host_path: '/home/anna/x', workspace_path: '../escape' } },
      { name: 'host_copy', args: { host: 'Desk', direction: 'to_workspace', host_path: '/home/anna/x', workspace_path: 'docs/robots.md' } },
      { name: 'host_copy', args: { host: 'Desk', direction: 'sideways', host_path: '/home/anna/x', workspace_path: 'x' } },
    ] }, { text: 'Refused.' }])
    const results = toolResults(id).slice(-6)
    expect(results[0]).toContain('files over 100 MB are not copied')
    expect(results[1]).toContain('no such file')
    expect(results[2]).toContain('no file "out/missing.bin" in your Workspace')
    expect(results[3]).toContain('is not a path in your Workspace')
    expect(results[4]).toContain('is not a path in your Workspace')
    expect(results[5]).toContain('direction is to_workspace or to_host')
    expect(await workspaceBytes(id, 'huge.iso')).toBeNull()
  })

  it('needs the Host\'s file Grant: without it the tool is absent and the Host refuses a piece', async () => {
    const desk = await fakeHost()
    const shellOnly = await robotWith(ANNA, [`${desk.hostId}:shell`])
    await say(ANNA, shellOnly, [{ text: 'hi' }])
    expect(requests.get(shellOnly)!.at(-1)!.tools!.map((definition) => definition.name)).not.toContain('host_copy')
    const member = env.MEMBER.getByName(annaId)
    expect(await refusal(() => member.hostReadChunk(desk.hostId, shellOnly, { path: '/home/anna/report.bin', offset: 0, length: 10 }))).toContain('has no files grant on the host "Desk"')
    expect(await refusal(() => member.hostWriteChunk(desk.hostId, shellOnly, { path: '/tmp/x', offset: 0, base64: 'AA==' }))).toContain('has no files grant on the host "Desk"')
    const granted = await robotWith(ANNA, [`${desk.hostId}:files`])
    await say(ANNA, granted, [{ text: 'hi' }])
    expect(requests.get(granted)!.at(-1)!.tools!.map((definition) => definition.name)).toContain('host_copy')
  })

  it('a file copied into the Workspace under box/ is in the Box at its next boot (gb-mcnc)', async () => {
    const desk = await fakeHost()
    const id = await robotWith(ANNA, [`${desk.hostId}:files`])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: { box: 'allow' }, skills: [], recipients: [], secrets: [], hosts: { [`${desk.hostId}:files`]: 'allow' } } } })
    const bytes = binary(70_000)
    hostDisk.set('/home/anna/model.bin', bytes)
    await say(ANNA, id, [{ calls: [{ name: 'host_copy', args: { host: 'Desk', direction: 'to_workspace', host_path: '/home/anna/model.bin', workspace_path: 'box/model.bin' } }, { name: 'box_run', args: { command: 'ls' } }] }, { text: 'Ready.' }])
    expect(boxLog.get(id)![0]).toBe('boot')
    expect(boxDisks.get(id)!.get('/workspace/box/model.bin')?.bytes).toEqual(bytes)
  })
})
