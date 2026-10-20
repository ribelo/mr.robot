/**
 * The Host executes through DSH (v1.16 ticket 02): the mode and roots of each Host grant reach the app, the Robot's directory is its home
 * there, a denied write comes back naming the path, a retry with escalate puts a one-call Ask to the owner, and a confined call on a
 * computer without a sandbox fails closed. Driven through the edge API with the scripted model and the fake Host app, which stands for
 * the app (the sandbox itself is checked on the app's side, in apps/host).
 */
import { env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, HostView, ProposalView, RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostCommands, hostDisk, hostFileCalls, hostRuns, ran } from './fake-host.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  hostDisk.clear()
  hostCommands.length = 0
  hostRuns.length = 0
  hostFileCalls.length = 0
  ran.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(closeHosts)

async function robotWith(host: { hostId: string }, levels: { files?: string; shell?: string } = { files: 'allow', shell: 'allow' }, hostAccess?: Record<string, { mode: string; roots: string[] }>, tools: Record<string, string> = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  const hosts = { ...(levels.files === undefined ? {} : { [`${host.hostId}:files`]: levels.files }), ...(levels.shell === undefined ? {} : { [`${host.hostId}:shell`]: levels.shell }) }
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, contextBudget: 32_000, grants: { tools, hosts }, ...(hostAccess === undefined ? {} : { hostAccess }) } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

type Call = { name: string; args: Record<string, unknown> }
async function calls(id: string, list: Call[]): Promise<string[]> {
  scripts.set(id, [...list.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join('')).slice(-list.length)
}
const json = (text: string | undefined) => JSON.parse(text!) as Record<string, unknown>

async function asks(id: string): Promise<ProposalView[]> {
  const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
  return conversation.items.flatMap((item) => (item.kind === 'proposal' && item.proposal.kind === 'tool-call' ? [item.proposal] : []))
}

describe('the mode and roots of a Host grant (ob-wh59, ob-397e)', () => {
  it('reach the app with every command and file call, per facet, with the Robot\'s own directory name', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk, { files: 'allow', shell: 'allow' }, {
      [`${desk.hostId}:shell`]: { mode: 'workspace-write', roots: ['~/projects', ' /srv/data ', '~/projects'] },
      [`${desk.hostId}:files`]: { mode: 'read-only', roots: [] },
    })
    await calls(id, [
      { name: 'run', args: { on: 'Desk', command: 'make' } },
      { name: 'read', args: { on: 'Desk', file_path: 'notes.md' } },
      { name: 'write', args: { on: 'Desk', file_path: 'notes.md', content: 'x' } },
    ])
    const robot = hostRuns[0]!.access.robot
    expect(robot).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}$/)
    expect(hostRuns[0]).toMatchObject({ command: 'make', access: { mode: 'workspace-write', roots: ['~/projects', '/srv/data'] } })
    expect(hostRuns[0]!.cwd).toBeUndefined()
    expect(hostFileCalls.map((call) => [call.rpc, call.access])).toEqual([['Read', { robot, mode: 'read-only', roots: [] }], ['Write', { robot, mode: 'read-only', roots: [] }]])
  })

  it('default to workspace-write with no extra root, and the Robot\'s directory is where a command runs when no cwd is given', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk)
    const [result] = await calls(id, [{ name: 'run', args: { on: 'Desk', command: 'pwd' } }])
    expect(hostRuns[0]!.access).toMatchObject({ mode: 'workspace-write', roots: [] })
    expect(hostRuns[0]!.cwd).toBeUndefined()
    expect(json(result)).toMatchObject({ kind: 'foreground', exitCode: 0, cwd: `/home/anna/mr-robot/${hostRuns[0]!.access.robot}`, sandbox: { mode: 'workspace-write', denied: false, enforcement: 'full' } })
  })

  it('are kept in the settings, with a bad root refused and the default left out', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk)
    const facet = `${desk.hostId}:shell`
    const refused = await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { hostAccess: { [facet]: { mode: 'workspace-write', roots: ['relative/dir'] } } } })
    expect(refused.status).toBe(400)
    const saved = await api<RobotPanel['settings']>(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { hostAccess: { [facet]: { mode: 'full', roots: [] }, [`${desk.hostId}:files`]: { mode: 'workspace-write', roots: [] } } } })
    expect(saved.body.hostAccess).toEqual({ [facet]: { mode: 'full', roots: [] } })
  })
})

describe('a denied write (ob-vnld)', () => {
  it('comes back naming the path, with the way to ask for the wider reach', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk)
    hostCommands.push((command, access) => (command.startsWith('cp ') ? {
      stdout: '', stderr: "cp: cannot create regular file '/etc/hosts': Read-only file system", exitCode: 1,
      sandbox: { mode: access.mode, denied: true, deniedPath: '/etc/hosts', enforcement: 'full' },
    } : undefined))
    const [result] = await calls(id, [{ name: 'run', args: { on: 'Desk', command: 'cp hosts /etc/hosts' } }])
    expect(json(result)).toMatchObject({ kind: 'foreground', exitCode: 1, sandbox: { mode: 'workspace-write', denied: true, deniedPath: '/etc/hosts' } })
    expect(json(result).note).toContain('the write to /etc/hosts was denied under workspace-write mode')
    expect(json(result).note).toContain('escalate: true')
  })
})

describe('escalate (ob-ifak)', () => {
  it('puts a one-call Ask to the owner; its approval runs the command once without the sandbox and the grant stays', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk)
    const [asked] = await calls(id, [{ name: 'run', args: { on: 'Desk', command: 'cp hosts /etc/hosts', escalate: true, reason: 'Install the hosts file' } }])
    expect(asked).toContain('waiting for your owner')
    expect(hostRuns).toEqual([])
    const [ask] = await asks(id)
    // The owner reads first that the command runs without the sandbox (S8).
    expect(ask).toMatchObject({ kind: 'tool-call', status: 'open', purpose: 'run without the sandbox: Install the hosts file', toolCall: { tool: 'run', reason: 'This runs without the sandbox, once. Install the hosts file' } })
    expect(ask!.toolCall!.arguments).toContainEqual({ name: 'escalate', value: 'true' })
    scripts.set(id, [{ text: 'It ran.' }])
    expect((await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${ask!.id}`, { body: { revision: ask!.revision, approve: true } })).status).toBe(200)
    await settle(id)
    expect(hostRuns).toHaveLength(1)
    expect(hostRuns[0]).toMatchObject({ command: 'cp hosts /etc/hosts', access: { mode: 'full' } })
    const woken = requests.get(id)!.map((request) => JSON.stringify(request.messages)).find((text) => text.includes(`[Your owner approved run (${ask!.id})]`))
    expect(woken !== undefined && woken.includes('\\"mode\\": \\"full\\"')).toBe(true)
    // The grant is unchanged: the next plain run is confined again, and the same Ask cannot run twice.
    await calls(id, [{ name: 'run', args: { on: 'Desk', command: 'ls' } }])
    expect(hostRuns.at(-1)!.access.mode).toBe('workspace-write')
    expect(hostRuns).toHaveLength(2)
  })

  it('needs a reason, and has nothing to lift on the Box', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk, { files: 'allow', shell: 'allow' }, undefined, { box: 'allow' })
    const [noReason, box] = await calls(id, [
      { name: 'run', args: { on: 'Desk', command: 'ls', escalate: true } },
      { name: 'run', args: { on: 'box', command: 'ls', escalate: true, reason: 'Need it' } },
    ])
    expect(noReason).toContain('escalate needs a reason')
    expect(box).toContain('Your Box has none to lift')
    expect(hostRuns).toEqual([])
  })

  it('asks once when the shell grant is at ask: the approved call runs in full', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk, { files: 'allow', shell: 'ask' })
    await calls(id, [{ name: 'run', args: { on: 'Desk', command: 'rm /etc/x', escalate: true, reason: 'Clean up' } }])
    const open = (await asks(id)).filter((ask) => ask.status === 'open')
    expect(open).toHaveLength(1)
    // The Ask the gate stores says it too, whichever path made it (S8).
    expect(open[0]!.purpose).toBe('run without the sandbox: Clean up')
    scripts.set(id, [{ text: 'Done.' }])
    await api(ANNA, `/api/robots/${id}/proposals/${open[0]!.id}`, { body: { revision: open[0]!.revision, approve: true } })
    await settle(id)
    expect(hostRuns.map((run) => run.access.mode)).toEqual(['full'])
  })
})

describe('a computer without a sandbox (ob-n72n, ob-he20)', () => {
  it('shows its sandbox state, fails a confined command closed without sending it, and runs full', async () => {
    const bare = await fakeHost('Nas', { sandbox: 'none' })
    expect((await api<HostView[]>(ANNA, '/api/hosts')).body.find((host) => host.id === bare.hostId)?.capabilities).toMatchObject({ sandbox: 'none' })
    const id = await robotWith(bare, { files: 'allow', shell: 'allow' }, { [`${bare.hostId}:shell`]: { mode: 'workspace-write', roots: [] } })
    const [refused] = await calls(id, [{ name: 'run', args: { on: 'Nas', command: 'ls' } }])
    expect(refused).toContain('Nas has no usable sandbox')
    expect(refused).toContain('fails closed')
    expect(ran).toEqual([])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { hostAccess: { [`${bare.hostId}:shell`]: { mode: 'full', roots: [] } } } })
    const [full] = await calls(id, [{ name: 'run', args: { on: 'Nas', command: 'ls' } }])
    expect(json(full)).toMatchObject({ kind: 'foreground', exitCode: 0, sandbox: { mode: 'full', denied: false } })
    expect(ran).toEqual(['ls'])
  })

  it('reads and writes files on it as before: file RPCs need no sandbox', async () => {
    const bare = await fakeHost('Nas', { sandbox: 'none' })
    const id = await robotWith(bare)
    const [written] = await calls(id, [{ name: 'write', args: { on: 'Nas', file_path: 'a.txt', content: 'x' } }])
    expect(written).toContain('"written"')
  })
})

/** The open tool-call Ask of a Robot is approved and the Robot wakes with the result. */
async function approveOpen(id: string): Promise<ProposalView> {
  const open = (await asks(id)).filter((ask) => ask.status === 'open')
  expect(open).toHaveLength(1)
  scripts.set(id, [{ text: 'Done.' }])
  expect((await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${open[0]!.id}`, { body: { revision: open[0]!.revision, approve: true } })).status).toBe(200)
  await settle(id)
  return open[0]!
}

describe('escalate on the tools that change a computer (Sa1)', () => {
  it('names the path of a denied write and says escalate is possible; a one-call Ask runs it once in full mode, and the next write is denied again', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk, { files: 'allow', shell: 'allow' }, { [`${desk.hostId}:files`]: { mode: 'read-only', roots: [] } })
    const [denied] = await calls(id, [{ name: 'write', args: { on: 'Desk', file_path: '/etc/motd', content: 'hello' } }])
    expect(denied).toContain('/etc/motd was not written')
    expect(denied).toContain('call write again with escalate: true and a reason')
    expect(hostDisk.has('/etc/motd')).toBe(false)

    const [waiting] = await calls(id, [{ name: 'write', args: { on: 'Desk', file_path: '/etc/motd', content: 'hello', escalate: true, reason: 'Set the message of the day' } }])
    expect(waiting).toContain('waiting for your owner')
    expect(hostDisk.has('/etc/motd')).toBe(false)
    const ask = await approveOpen(id)
    expect(ask.purpose).toBe('write without the sandbox: Set the message of the day')
    expect(new TextDecoder().decode(hostDisk.get('/etc/motd'))).toBe('hello')
    expect(hostFileCalls.filter((call) => call.rpc === 'Write').map((call) => call.access.mode)).toEqual(['read-only', 'full'])
    const [again] = await calls(id, [{ name: 'write', args: { on: 'Desk', file_path: '/etc/motd', content: 'again' } }])
    expect(again).toContain('was not written')
  })

  it('takes escalate on edit, delete_file and copy to a Host, each needing a reason and the owner\'s answer', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk, { files: 'allow', shell: 'allow' }, { [`${desk.hostId}:files`]: { mode: 'read-only', roots: [] } }, { files: 'allow', box: 'allow' })
    hostDisk.set('/etc/motd', new TextEncoder().encode('old text'))
    hostDisk.set('/etc/gone', new TextEncoder().encode('bye'))
    const [noReason, onBox] = await calls(id, [
      { name: 'delete_file', args: { on: 'Desk', path: '/etc/gone', escalate: true } },
      { name: 'write', args: { on: 'box', file_path: 'a.txt', content: 'x', escalate: true, reason: 'Need it' } },
    ])
    expect(noReason).toContain('escalate needs a reason')
    expect(onBox).toContain('Your Box has none to lift')

    await calls(id, [{ name: 'edit', args: { on: 'Desk', file_path: '/etc/motd', old_string: 'old', new_string: 'new', escalate: true, reason: 'Fix the text' } }])
    await approveOpen(id)
    expect(new TextDecoder().decode(hostDisk.get('/etc/motd'))).toBe('new text')

    await calls(id, [{ name: 'delete_file', args: { on: 'Desk', path: '/etc/gone', escalate: true, reason: 'Remove it' } }])
    await approveOpen(id)
    expect(hostDisk.has('/etc/gone')).toBe(false)

    await env.FILES.put(`robots/${id}/out/report.txt`, 'the report')
    await calls(id, [{ name: 'copy', args: { from: { on: 'workspace', path: 'out/report.txt' }, to: { on: 'Desk', path: '/etc/report.txt' }, escalate: true, reason: 'Publish the report' } }])
    const ask = await approveOpen(id)
    expect(ask.purpose).toBe('copy without the sandbox: Publish the report')
    expect(new TextDecoder().decode(hostDisk.get('/etc/report.txt'))).toBe('the report')
    expect(hostFileCalls.filter((call) => call.rpc === 'Download').map((call) => call.access.mode)).toEqual(['full'])
    // A copy to the Workspace has no computer to write on.
    const [toWorkspace] = await calls(id, [{ name: 'copy', args: { from: { on: 'Desk', path: '/etc/motd' }, to: { on: 'workspace', path: 'x.txt' }, escalate: true, reason: 'No' } }])
    expect(toWorkspace).toContain('the destination is not a computer')
  })

  it('says in the description of run which shell a computer runs (Sa2)', async () => {
    const desk = await fakeHost()
    const id = await robotWith(desk)
    await calls(id, [{ name: 'run', args: { on: 'Desk', command: 'ls' } }])
    const run = requests.get(id)!.at(-1)!.tools!.find((definition) => definition.name === 'run')!
    expect(run.description).toContain('bash on the Box')
    expect(run.description).toContain('Hosts line of your runtime section')
    expect(run.description).toContain('pwsh on Windows')
    expect(run.description).not.toContain('in bash as your owner')
  })
})

describe('an app from before v1.16 (S2)', () => {
  it('is sent no confined call: the Robot is told to update the app; full access still runs', async () => {
    const old = await fakeHost('Old', { legacy: true })
    expect((await api<HostView[]>(ANNA, '/api/hosts')).body.find((host) => host.id === old.hostId)).toMatchObject({ online: true, version: '0.1.0' })
    const id = await robotWith(old, { files: 'allow', shell: 'allow' })
    const [run, write, read] = await calls(id, [
      { name: 'run', args: { on: 'Old', command: 'ls' } },
      { name: 'write', args: { on: 'Old', file_path: 'a.txt', content: 'x' } },
      { name: 'read', args: { on: 'Old', file_path: 'a.txt' } },
    ])
    expect(run).toContain('update the Mr. Robot app on Old')
    expect(write).toContain('update the Mr. Robot app on Old')
    expect(read).toContain('update the Mr. Robot app on Old')
    expect(ran).toEqual([])
    expect(hostFileCalls).toEqual([])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { hostAccess: { [`${old.hostId}:shell`]: { mode: 'full', roots: [] } } } })
    const [full] = await calls(id, [{ name: 'run', args: { on: 'Old', command: 'ls' } }])
    expect(json(full)).toMatchObject({ kind: 'foreground', exitCode: 0 })
  })
})

describe('the mode and roots of a facet are forgotten with the facet', () => {
  it('when the facet goes to deny, and when the Host is unpaired', async () => {
    const desk = await fakeHost('Desk')
    const laptop = await fakeHost('Laptop')
    const id = await robotWith(desk)
    const stored = async () => Object.keys((await env.ROBOT.getByName(id).settings()).hostAccess ?? {}).sort()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: {
      grants: { tools: {}, hosts: { [`${desk.hostId}:files`]: 'allow', [`${desk.hostId}:shell`]: 'allow', [`${laptop.hostId}:files`]: 'allow' } },
      hostAccess: {
        [`${desk.hostId}:shell`]: { mode: 'read-only', roots: [] },
        [`${desk.hostId}:files`]: { mode: 'full', roots: [] },
        [`${laptop.hostId}:files`]: { mode: 'full', roots: [] },
      },
    } })
    expect(await stored()).toEqual([`${desk.hostId}:files`, `${desk.hostId}:shell`, `${laptop.hostId}:files`].sort())
    // The shell of Desk goes to deny: its mode goes with it.
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: {}, hosts: { [`${desk.hostId}:files`]: 'allow', [`${laptop.hostId}:files`]: 'allow' } } } })
    expect(await stored()).toEqual([`${desk.hostId}:files`, `${laptop.hostId}:files`].sort())
    // Laptop is unpaired: at the Robot's next look at its Hosts its mode is gone.
    await api(ANNA, `/api/hosts/${laptop.hostId}`, { method: 'DELETE' })
    await calls(id, [{ name: 'read', args: { on: 'Desk', file_path: 'a.txt' } }])
    expect(await stored()).toEqual([`${desk.hostId}:files`])
  })
})
