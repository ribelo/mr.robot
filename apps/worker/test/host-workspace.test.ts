/**
 * A Robot's Workspace on a Host (v1.21): the protocol version the app reports and the Workspace RPCs the Worker refuses to an older app
 * (cw-jn59), and the picker's listing (cw-gx04). Driven through the edge API with the fake Host app.
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, RobotSettings, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostDirectories, hostDisk, hostFileCalls, hostRuns, linkedRoots, workspaceCloses } from './fake-host.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  hostDisk.clear()
  hostFileCalls.length = 0
  hostRuns.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(closeHosts)

async function robotWith(host: { hostId: string }, files: 'allow' | 'none' = 'allow'): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: {}, hosts: files === 'none' ? {} : { [`${host.hostId}:files`]: files } } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const directories = (id: string, host: string, path: string) => api<{ path: string; directories: string[]; truncated: boolean; error?: string }>(ANNA, `/api/robots/${id}/hosts/${host}/directories?path=${encodeURIComponent(path)}`)

describe('the Host protocol version (cw-jn59)', () => {
  it('refuses a Workspace call to an app older than the Worker with one sentence naming the update, and sends it to a current one', async () => {
    const old = await fakeHost('Old desk', { protocolVersion: 1 })
    const legacy = await fakeHost('Attic', { legacy: true, sandbox: 'full' })
    const desk = await fakeHost('Desk')
    hostDirectories.add('/home/anna/projects/mr.robot/.git')
    hostDirectories.add('/home/anna/notes')
    for (const host of [old, legacy]) {
      const id = await robotWith(host)
      const refused = await directories(id, host.hostId, '~')
      expect(refused.status).toBe(409)
      const name = host === old ? 'Old desk' : 'Attic'
      expect(refused.body.error).toBe(`${name} runs an older Mr. Robot app than this server, so it cannot serve a Workspace: update the Mr. Robot app on ${name}.`)
    }
    const id = await robotWith(desk)
    const listed = await directories(id, desk.hostId, '~')
    expect(listed.status).toBe(200)
    expect(listed.body).toEqual({ path: '/home/anna', directories: ['notes', 'projects'], truncated: false })
    expect((await directories(id, desk.hostId, '~/projects/mr.robot')).body.directories).toEqual(['.git'])
  })

  it('lists only for a Robot that holds the files facet on the Host', async () => {
    const desk = await fakeHost('Desk')
    const id = await robotWith(desk, 'none')
    const refused = await directories(id, desk.hostId, '~')
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('has no files grant on the host "Desk"')
  })
})

// ---------------------------------------------------------------- ticket 02: the words and the Workspace setting

type Call = { name: string; args: Record<string, unknown> }
const toolTexts = (id: string, count: number) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-count).map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
async function calls(id: string, list: Call[]): Promise<string[]> {
  scripts.set(id, [...list.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return toolTexts(id, list.length)
}

/** A repository on the fake disk: /home/anna/repo with app/ and a file in each; a plain directory; a linked one. */
function disk(): void {
  hostDirectories.add('/home/anna/repo/.git')
  hostDirectories.add('/home/anna/repo/app')
  hostDirectories.add('/home/anna/plain')
  hostDirectories.add('/home/anna/linked')
  linkedRoots.add('/home/anna/linked')
  hostDisk.set('/home/anna/repo/README.md', new TextEncoder().encode('root readme'))
  hostDisk.set('/home/anna/repo/app/main.ts', new TextEncoder().encode('export {}'))
}

async function coder(host: { hostId: string }, extra: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: { files: 'allow' }, hosts: { [`${host.hostId}:files`]: 'allow', [`${host.hostId}:shell`]: 'allow' } }, ...extra } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

const setWorkspace = (id: string, workspace: { host: string; root: string } | null) => api<RobotSettings & { error?: string }>(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { workspace } })

describe('Files and the old place name (cw-shlm)', () => {
  it('takes on "files" for the R2 files, and maps "workspace" there with a notice for a Robot without a Workspace', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk)
    const [plain, aliased] = await calls(id, [
      { name: 'write', args: { on: 'files', file_path: 'notes/a.md', content: 'one' } },
      { name: 'read', args: { on: 'workspace', file_path: 'notes/a.md' } },
    ])
    expect(JSON.parse(plain!)).toEqual({ on: 'files', written: '/workspace/notes/a.md', bytes: 3 })
    expect(aliased).toContain('one')
    expect(aliased).toContain('on "workspace" now names a Workspace on a computer, and you have none: this call went to your Files. Use on "files" for your files in R2.')
    expect(hostFileCalls).toEqual([])
    const [run] = await calls(id, [{ name: 'run', args: { on: 'files', command: 'ls' } }])
    expect(run).toContain('your Files hold files, they run no commands')
  })
})

describe('the Workspace setting (cw-gx04)', () => {
  it('is checked on the Host: the files facet, a directory, no link, inside a repository; the repository root is kept', async () => {
    const desk = await fakeHost('Desk')
    disk()
    const bare = await coder(desk, { grants: { tools: { files: 'allow' }, hosts: {} } })
    expect((await setWorkspace(bare, { host: desk.hostId, root: '~/repo' })).body.error).toContain('holds no files grant on Desk')
    const id = await coder(desk)
    expect((await setWorkspace(id, { host: desk.hostId, root: '~/nowhere' })).body.error).toBe('/home/anna/nowhere on Desk does not exist.')
    expect((await setWorkspace(id, { host: desk.hostId, root: '~/repo/README.md' })).body.error).toBe('/home/anna/repo/README.md on Desk is not a directory.')
    expect((await setWorkspace(id, { host: desk.hostId, root: '~/plain' })).body.error).toContain('is not inside a git repository')
    expect((await setWorkspace(id, { host: desk.hostId, root: '~/linked' })).body.error).toContain('is reached through the link /home/anna/linked')
    const saved = await setWorkspace(id, { host: desk.hostId, root: '~/repo/app' })
    expect(saved.status).toBe(200)
    expect(saved.body.workspace).toEqual({ hostId: desk.hostId, host: 'Desk', root: '/home/anna/repo/app', repository: '/home/anna/repo' })
  })

  it('makes on "workspace" the Host from the current directory; the Host by name keeps the Robot\'s own directory; the Fleet shows it', async () => {
    const desk = await fakeHost('Desk')
    disk()
    const id = await coder(desk)
    await setWorkspace(id, { host: desk.hostId, root: '~/repo' })
    const [read, run, byName] = await calls(id, [
      { name: 'read', args: { on: 'workspace', file_path: 'app/main.ts' } },
      { name: 'run', args: { on: 'workspace', command: 'pwd' } },
      { name: 'run', args: { on: 'Desk', command: 'pwd' } },
    ])
    expect(read).toContain('export {}')
    expect(hostFileCalls[0]).toMatchObject({ rpc: 'Read', path: '/home/anna/repo/app/main.ts', access: { cwd: '/home/anna/repo', workspace: { root: '/home/anna/repo', repository: '/home/anna/repo' } } })
    expect(JSON.parse(run!)).toMatchObject({ cwd: '/home/anna/repo' })
    expect(hostRuns[0]!.access.cwd).toBe('/home/anna/repo')
    // By name: the v1.16 default directory, and the Workspace's roots still reach the app for its policy.
    expect(JSON.parse(byName!)).toMatchObject({ cwd: `/home/anna/mr-robot/${hostRuns[1]!.access.robot}` })
    expect(hostRuns[1]!.access.cwd).toBeUndefined()
    expect(hostRuns[1]!.access.workspace).toEqual({ root: '/home/anna/repo', repository: '/home/anna/repo' })
    const row = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.id === id)!
    expect(row.workspace).toEqual({ hostId: desk.hostId, host: 'Desk', root: '/home/anna/repo' })
  })

  it('keeps the current directory across Turns (working_directory), within the repository, and starts at the root again on a new Workspace', async () => {
    const desk = await fakeHost('Desk')
    disk()
    const id = await coder(desk)
    await setWorkspace(id, { host: desk.hostId, root: '~/repo' })
    const [where, moved, outside] = await calls(id, [
      { name: 'working_directory', args: {} },
      { name: 'working_directory', args: { cd: 'app' } },
      { name: 'working_directory', args: { cd: '/home/anna/plain' } },
    ])
    expect(JSON.parse(where!)).toEqual({ cwd: '/home/anna/repo', root: '/home/anna/repo', repository: '/home/anna/repo', host: 'Desk' })
    expect(JSON.parse(moved!)).toMatchObject({ cwd: '/home/anna/repo/app' })
    expect(outside).toContain('outside the repository /home/anna/repo')
    // The next Turn starts where the last one left.
    const [read] = await calls(id, [{ name: 'read', args: { on: 'workspace', file_path: 'main.ts' } }])
    expect(read).toContain('export {}')
    expect(hostFileCalls.at(-1)!.access.cwd).toBe('/home/anna/repo/app')
    // A changed Workspace starts at its root, and the app is told to close the old session.
    hostDirectories.add('/home/anna/other/.git')
    await setWorkspace(id, { host: desk.hostId, root: '~/other' })
    const [again] = await calls(id, [{ name: 'working_directory', args: {} }])
    expect(JSON.parse(again!)).toMatchObject({ cwd: '/home/anna/other' })
    await vi.waitFor(() => expect(workspaceCloses).toHaveLength(1))
    // Deleting the Robot closes the session of the Workspace it had.
    expect((await api(ANNA, `/api/robots/${id}`, { method: 'DELETE', body: { confirm: 'New robot' } })).status).toBe(200)
    await vi.waitFor(() => expect(workspaceCloses).toHaveLength(2))
  })

  it('is set by Mr. Robot as his owner\'s deputy (cw-g89b)', async () => {
    const desk = await fakeHost('Desk')
    disk()
    const id = await coder(desk)
    const chief = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.kind === 'mr-robot')!.id
    await settle(chief)
    const [answer] = await calls(chief, [{ name: 'robot_settings_set', args: { robot_id: id, workspace: { host: desk.hostId, root: '~/repo' } } }])
    expect(answer).not.toContain('Error')
    expect((await api<{ settings: RobotSettings }>(ANNA, `/api/robots/${id}/panel`)).body.settings.workspace).toMatchObject({ root: '/home/anna/repo', repository: '/home/anna/repo' })
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(JSON.stringify(items)).toContain('set the Workspace to /home/anna/repo on Desk.')
  })

  it('gives a Subagent its own current directory, first the Robot\'s (cw-4nkx)', async () => {
    const desk = await fakeHost('Desk')
    disk()
    const id = await coder(desk, { grants: { tools: { files: 'allow', subagents: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } }, subagentModels: [{ provider: 'stub', model: 'stub' }] })
    await setWorkspace(id, { host: desk.hostId, root: '~/repo' })
    scripts.set(`${id}:sub`, [{ calls: [{ name: 'working_directory', args: { cd: 'app' } }] }, { calls: [{ name: 'read', args: { on: 'workspace', file_path: 'main.ts' } }] }, { text: 'REPORT: read it.' }])
    scripts.set(id, [{ calls: [{ name: 'subagent', args: { description: 'Read main', prompt: 'Read main.ts in app' } }] }, { text: 'Started.' }, { calls: [{ name: 'working_directory', args: {} }] }, { text: 'Done.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await vi.waitFor(async () => {
      await settle(id)
      expect(toolTexts(id, 1)[0]).toContain('"cwd"')
    }, { timeout: 15_000 })
    expect(hostFileCalls.find((call) => call.rpc === 'Read')).toMatchObject({ path: '/home/anna/repo/app/main.ts', access: { cwd: '/home/anna/repo/app' } })
    expect(JSON.parse(toolTexts(id, 1)[0]!)).toMatchObject({ cwd: '/home/anna/repo' })
  })

  it('fails a Workspace call when its Host is offline, naming it; the owner\'s message still wakes the Robot (cw-ffs7)', async () => {
    const desk = await fakeHost('Desk')
    disk()
    const id = await coder(desk, { requiresHosts: true })
    await setWorkspace(id, { host: desk.hostId, root: '~/repo' })
    await desk.drop()
    const [read] = await calls(id, [{ name: 'read', args: { on: 'workspace', file_path: 'README.md' } }])
    expect(read).toContain('the host "Desk"')
  })
})
