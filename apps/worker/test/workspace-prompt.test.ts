/**
 * The Workspace in the prompt and the panel (v1.21 ticket 08): the runtime section's Workspace line is static (cw-xbx3), so a cd changes
 * no prompt section; the owner's panel reads where the Robot is, the checkout's files and git through the Host (cw-1wrt).
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostDirectories, hostDisk } from './fake-host.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const REPO = '/home/anna/repo'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  hostDisk.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  hostDirectories.add(`${REPO}/.git`)
  hostDisk.set(`${REPO}/src/a.ts`, new TextEncoder().encode('export {}'))
})

afterEach(closeHosts)

async function coder(host: { hostId: string }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: { files: 'allow' }, hosts: { [`${host.hostId}:files`]: 'allow', [`${host.hostId}:shell`]: 'allow' } } } })
  await testRobot(body.id).activateForTest()
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { workspace: { host: host.hostId, root: REPO } } })
  requests.delete(body.id)
  return body.id
}

type Call = { name: string; args: Record<string, unknown> }
async function turn(id: string, calls: Call[] = []): Promise<void> {
  scripts.set(id, [...calls.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
}
const prompt = async (id: string) => (await api<{ sections: Array<{ name: string; text: string }> }>(ANNA, `/api/robots/${id}/prompt`)).body.sections

describe('the Workspace line (cw-xbx3)', () => {
  it('names the Host, the root, the repository and the shell, and a cd changes no prompt section', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk)
    await turn(id)
    const before = await prompt(id)
    const runtime = before.find((section) => section.name === 'Platform')!.text
    expect(runtime).toContain(`- Workspace: ${REPO} on Desk (repository ${REPO}, bash); use on "workspace", and working_directory for where you are in it.`)
    const system = JSON.stringify(requests.get(id)!.at(-1)!.system)
    await turn(id, [{ name: 'working_directory', args: { cd: 'src' } }])
    expect(await prompt(id)).toEqual(before)
    expect(JSON.stringify(requests.get(id)!.at(-1)!.system)).toBe(system)
    expect(JSON.stringify(before)).not.toContain(`${REPO}/src`)
  })
})

describe('the Workspace panel (cw-1wrt)', () => {
  it('tells the owner where the Robot is, lists the checkout and reads git; a Robot without a Workspace has none', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk)
    await turn(id, [{ name: 'working_directory', args: { cd: 'src' } }])
    expect((await api<{ cwd: string }>(ANNA, `/api/robots/${id}/workspace`)).body).toMatchObject({ cwd: `${REPO}/src`, setting: { root: REPO } })
    expect((await api(ANNA, `/api/robots/${id}/workspace/files?path=src`)).body).toEqual({ path: 'src', entries: [{ name: 'a.ts', kind: 'file', size: 9 }], truncated: false })
    expect((await api<{ branch: string }>(ANNA, `/api/robots/${id}/workspace/git`)).body.branch).toBe('main')
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    const none = await api<{ error: string }>(ANNA, `/api/robots/${body.id}/workspace/git`)
    expect(none.status).toBe(409)
    expect(none.body.error).toBe('This Robot has no Workspace.')
  })
})
