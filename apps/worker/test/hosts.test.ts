import { env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, HostView, Me, RobotSummary } from '@mr-robot/protocol'
import { parseFrame } from '@mr-robot/host-protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostDisk, ran } from './fake-host.ts'
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

afterEach(closeHosts)

async function robotWith(as: string, hosts: string[], tools: string[] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [], hosts } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(as: string, id: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(as, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
}

/** The tag and message of a refused Host call: the Member answers it with a failed reply, the failure a tagged value (deep review P16). */
async function refusal(call: () => Promise<{ _tag: string; error?: { _tag: string; message: string } }>): Promise<string> {
  const reply = await call()
  return reply._tag === 'Failed' && reply.error !== undefined ? `${reply.error._tag}: ${reply.error.message}` : 'not refused'
}

let annaId = ''

const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe('Hosts (v1.2 tickets 01 and 02)', () => {
  it('pairs, shows online with its heartbeat, shares with the Space, and unpairs (hs-hend, hs-ro43, hs-0eka, hs-rwxw, hs-7dlt)', async () => {
    const host = await fakeHost()
    const mine = (await api<HostView[]>(ANNA, '/api/hosts')).body
    expect(mine).toEqual([expect.objectContaining({ id: host.hostId, name: 'Desk', online: true, version: '0.1.0', mine: true, sharing: 'private', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome', sandbox: 'full', shell: 'bash' } })])
    expect((await api<HostView[]>(BEN, '/api/hosts')).body).toEqual([])
    await api(ANNA, `/api/hosts/${host.hostId}`, { method: 'PATCH', body: { sharing: 'space' } })
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
    await say(ANNA, without, [{ calls: [{ name: 'read', args: { on: 'Desk', file_path: '/etc/hostname' } }] }, { calls: [{ name: 'write', args: { on: 'Desk', file_path: '/tmp/x', content: 'abc' } }] }, { calls: [{ name: 'read', args: { on: 'Desk', file_path: '/root/secret' } }] }, { text: 'ok' }])
    const [read, written, denied] = toolResults(without)
    expect(read).toContain('1: hello')
    expect(written).toContain('"bytes": 3')
    expect(denied).toContain('permission denied (EACCES)')
    // run is not offered without a shell grant; the Member DO refuses it too.
    expect(requests.get(without)!.at(-1)!.tools!.map((definition) => definition.name)).not.toContain('run')
    expect(await refusal(() => env.MEMBER.getByName(annaId).hostRun(host.hostId, without, { command: 'id', background: false, job: 'j-direct' }))).toMatch(/^HostAccessLost: .*no shell grant/)
    expect(ran).not.toContain('id')
    const shell = await robotWith(ANNA, [`${host.hostId}:shell`])
    await say(ANNA, shell, [{ calls: [{ name: 'run', args: { on: 'Desk', command: 'leash --help' } }] }, { text: 'ok' }])
    expect(toolResults(shell)[0]).toContain('ran: leash --help')
    expect(JSON.stringify((await api(ANNA, `/api/robots/${shell}/trajectory`)).body)).toContain('leash --help')
  })

  it("asks the owner before Mr. Robot runs on a new host (hs-44cm, ob-2k5x); a private host refuses another Member's robot", async () => {
    const host = await fakeHost()
    const mr = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await api(ANNA, `/api/robots/${mr}/settings`, { method: 'PATCH', body: { codeMode: false } })
    await say(ANNA, mr, [{ calls: [{ name: 'run', args: { on: 'Desk', command: 'uptime', reason: 'Check the load' } }] }, { text: 'ok' }])
    expect(toolResults(mr)[0]).toContain('waiting for your owner')
    expect(ran).not.toContain('uptime')
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${mr}/conversation`)).body
    const ask = conversation.items.flatMap((item) => (item.kind === 'proposal' && item.proposal.kind === 'tool-call' && item.proposal.status === 'open' ? [item.proposal] : []))[0]!
    scripts.set(mr, [{ text: 'It ran.' }])
    expect((await api(ANNA, `/api/robots/${mr}/proposals/${ask.id}`, { body: { revision: ask.revision, approve: true } })).status).toBe(200)
    await settle(mr)
    expect(ran).toContain('uptime')
    const bens = await robotWith(BEN, [`${host.hostId}:shell`])
    expect(await refusal(() => env.MEMBER.getByName(annaId).hostRun(host.hostId, bens, { command: 'whoami', background: false, job: 'j-direct' }))).toMatch(/no shell grant/)
  })

  it('fails clearly when the host is offline, and marks it offline when heartbeats stop (hs-bfr8, hs-7dlt)', async () => {
    const host = await fakeHost()
    const robot = await robotWith(ANNA, [`${host.hostId}:shell`])
    host.socket.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await api<HostView[]>(ANNA, '/api/hosts')).body[0]?.online).toBe(false)
    await say(ANNA, robot, [{ calls: [{ name: 'run', args: { on: 'Desk', command: 'ls' } }] }, { text: 'offline' }])
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
    scripts.set(robot, [{ calls: [{ name: 'run', args: { on: 'Desk', command: 'backup' } }] }, { text: 'The host is offline.' }])
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
    await say(ANNA, id, [{ calls: [{ name: 'run', args: { on: 'Desk', command: 'uname -a' } }] }, { text: 'Ran it.' }])
    const actions = (await api<Array<{ robotName: string; action: string; detail: string; outcome: string; exitCode: number | null }>>(ANNA, `/api/hosts/${desk.hostId}/actions`)).body
    expect(actions[0]).toMatchObject({ robotName: 'New robot', action: 'run', detail: 'uname -a', outcome: 'done', exitCode: 0 })
    expect((await api(BEN, `/api/hosts/${desk.hostId}/actions`)).status).toBe(404)
  })
})

describe('copy between a Host and the Workspace (v1.15 ticket 09, gb-iw01, gb-mcnc; v1.16 ticket 06, ob-d3rt, ob-qshq)', () => {
  /** A pattern that shows a wrong byte, wrong order or a lost part. */
  const binary = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 31 + (index >> 8)) & 255)
  const workspaceBytes = async (id: string, path: string) => {
    const object = await env.FILES.get(`robots/${id}/${path}`)
    return object === null ? null : new Uint8Array(await object.arrayBuffer())
  }

  beforeEach(() => {
    hostDisk.clear()
  })

  it('copies a binary file each way, byte for byte; the result names both paths, the size and the time; the log has one line', async () => {
    const desk = await fakeHost()
    const id = await robotWith(ANNA, [`${desk.hostId}:files`], ['files'])
    const bytes = binary(2_500_000)
    hostDisk.set('/home/anna/report.bin', bytes)
    await say(ANNA, id, [{ calls: [{ name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/report.bin' }, to: { on: 'workspace', path: 'inbox/report.bin' } } }] }, { text: 'Copied.' }])
    expect(toolResults(id).at(-1)).toBeDefined()
    expect(JSON.parse(toolResults(id).at(-1)!)).toEqual({ from: { on: 'Desk', path: '/home/anna/report.bin' }, to: { on: 'workspace', path: '/workspace/inbox/report.bin' }, bytes: 2_500_000, ms: expect.any(Number), took: expect.stringMatching(/^2\.4 MB in /) })
    expect(await workspaceBytes(id, 'inbox/report.bin')).toEqual(bytes)

    const back = binary(1_048_576)
    await env.FILES.put(`robots/${id}/out/data.bin`, back)
    await say(ANNA, id, [{ calls: [{ name: 'copy', args: { from: { on: 'workspace', path: 'out/data.bin' }, to: { on: 'Desk', path: '/home/anna/copy/data.bin' } } }] }, { text: 'Copied.' }])
    expect(JSON.parse(toolResults(id).at(-1)!)).toMatchObject({ from: { on: 'workspace', path: '/workspace/out/data.bin' }, to: { on: 'Desk', path: '/home/anna/copy/data.bin' }, bytes: 1_048_576 })
    expect(hostDisk.get('/home/anna/copy/data.bin')).toEqual(back)

    // An empty file copies too.
    await env.FILES.put(`robots/${id}/out/empty.txt`, new Uint8Array())
    await say(ANNA, id, [{ calls: [{ name: 'copy', args: { from: { on: 'workspace', path: 'out/empty.txt' }, to: { on: 'Desk', path: '/home/anna/empty.txt' } } }] }, { text: 'Copied.' }])
    expect(hostDisk.get('/home/anna/empty.txt')).toEqual(new Uint8Array())

    const actions = (await api<Array<{ action: string; detail: string; outcome: string }>>(ANNA, `/api/hosts/${desk.hostId}/actions`)).body
    expect(actions.filter((action) => action.action === 'copy').map((action) => [action.detail, action.outcome])).toEqual([
      ['out/empty.txt → /home/anna/empty.txt', 'done'],
      ['out/data.bin → /home/anna/copy/data.bin', 'done'],
      ['/home/anna/report.bin → inbox/report.bin', 'done'],
    ])
  })

  it('refuses a missing file, a path outside the Workspace and the platform docs', async () => {
    const desk = await fakeHost()
    const id = await robotWith(ANNA, [`${desk.hostId}:files`], ['files'])
    await say(ANNA, id, [{ calls: [
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/nope' }, to: { on: 'workspace', path: 'nope' } } },
      { name: 'copy', args: { from: { on: 'workspace', path: 'out/missing.bin' }, to: { on: 'Desk', path: '/home/anna/x' } } },
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/x' }, to: { on: 'workspace', path: '../escape' } } },
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/x' }, to: { on: 'workspace', path: 'docs/robots.md' } } },
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/x' }, to: { on: 'Laptop', path: '/tmp/x' } } },
    ] }, { text: 'Refused.' }])
    const results = toolResults(id).slice(-5)
    expect(results[0]).toContain('no such file')
    expect(results[1]).toContain('no file "out/missing.bin" in your Workspace')
    expect(results[2]).toContain('outside your Workspace')
    expect(results[3]).toContain('docs/')
    expect(results[4]).toContain('there is no such place')
  })

  it('needs the Host\'s file Grant: without it the tool is absent and the Host refuses a copy', async () => {
    const desk = await fakeHost()
    const shellOnly = await robotWith(ANNA, [`${desk.hostId}:shell`])
    await say(ANNA, shellOnly, [{ text: 'hi' }])
    expect(requests.get(shellOnly)!.at(-1)!.tools!.map((definition) => definition.name)).not.toContain('copy')
    const member = env.MEMBER.getByName(annaId)
    expect(await refusal(() => member.hostCopySize(desk.hostId, shellOnly, '/home/anna/report.bin'))).toContain('has no files grant on the host "Desk"')
    expect(await refusal(() => member.hostUpload(desk.hostId, shellOnly, { path: '/home/anna/report.bin', size: 0, parts: [] }))).toContain('has no files grant on the host "Desk"')
    expect(await refusal(() => member.hostDownload(desk.hostId, shellOnly, { copy: 'c-1', path: '/tmp/x', url: 'https://r2.example/x', size: 0, partBytes: 1, from: 0, until: 0 }))).toContain('has no files grant on the host "Desk"')
    const granted = await robotWith(ANNA, [`${desk.hostId}:files`], ['files'])
    await say(ANNA, granted, [{ text: 'hi' }])
    expect(requests.get(granted)!.at(-1)!.tools!.map((definition) => definition.name)).toContain('copy')
  })

  it('a file copied into the Workspace under box/ is in the Box at its next boot (gb-mcnc)', async () => {
    const desk = await fakeHost()
    const id = await robotWith(ANNA, [`${desk.hostId}:files`], ['files'])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: { box: 'allow', files: 'allow' }, skills: [], recipients: [], secrets: [], hosts: { [`${desk.hostId}:files`]: 'allow' } } } })
    const bytes = binary(70_000)
    hostDisk.set('/home/anna/model.bin', bytes)
    await say(ANNA, id, [{ calls: [{ name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/model.bin' }, to: { on: 'workspace', path: 'box/model.bin' } } }, { name: 'run', args: { on: 'box', command: 'ls' } }] }, { text: 'Ready.' }])
    expect(boxLog.get(id)![0]).toBe('boot')
    expect(boxDisks.get(id)!.get('/workspace/box/model.bin')?.bytes).toEqual(bytes)
  })
})
