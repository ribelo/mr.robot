/**
 * The chief, the Coding Robot definition, the Add form, the coding skill (v1.21 ticket 10): Mr. Robot has no Workspace and sets his staff's
 * (cw-evn7); the platform definition ships with the Worker, read-only, first in the Marketplace (cw-wio5); the Add form's Workspace reaches
 * the Robot in setup without a Host call and is set when setup is approved (cw-nm6y); the coding skill shows with a Workspace (cw-etsj).
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DefinitionView, RobotSettings, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, boundTools } from './api.ts'
import { closeHosts, fakeHost, hostDirectories, hostFileCalls } from './fake-host.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  hostFileCalls.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(closeHosts)

const settingsOf = async (id: string) => (await api<{ settings: RobotSettings }>(ANNA, `/api/robots/${id}/panel`)).body.settings
const promptOf = async (id: string) => (await api<{ sections: Array<{ name: string; text: string }>; skills: string[] }>(ANNA, `/api/robots/${id}/prompt`)).body

describe('Mr. Robot as the chief of coding Robots (cw-evn7)', () => {
  it('has no Workspace, keeps his Host grants, and can set a Robot\'s Workspace as deputy', async () => {
    const chief = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.kind === 'mr-robot')!.id
    await settle(chief)
    const settings = await settingsOf(chief)
    expect(settings.workspace).toBeNull()
    expect(settings.workDetails).toBeNull()
    scripts.set(chief, [{ text: 'Hello.' }])
    await api(ANNA, `/api/robots/${chief}/messages`, { body: { text: 'hi' } })
    await settle(chief)
    const deputy = (await boundTools(chief)).find((tool) => tool.name === 'robot_settings_set')!
    expect(JSON.stringify(deputy)).toContain('workspace {host, root}')
  })
})

describe('the Coding Robot definition (cw-wio5)', () => {
  it('ships with the platform: first in the Marketplace, read-only, needing a computer\'s files and shell and no Box or browser', async () => {
    const market = (await api<Array<{ definition: DefinitionView; tools: string[]; needs: Array<{ kind: string; label: string; met: boolean }> }>>(ANNA, '/api/marketplace')).body
    expect(market[0]!.definition).toMatchObject({ slug: 'coding-robot', title: 'Coding Robot', source: 'platform', published: true })
    expect(market[0]!.tools.sort()).toEqual(['files', 'tasks', 'web'])
    expect(market[0]!.needs.map((need) => need.label)).toEqual(['a computer (files)', 'a computer (shell)'])
    expect((await api(ANNA, '/api/admin/definitions/coding-robot', { method: 'DELETE' })).status).toBe(400)
  })
})

describe('the Add form\'s Workspace (cw-nm6y) and the coding skill (cw-etsj)', () => {
  it('reaches the Robot in setup without a Host call and is set, checked on the Host, when setup is approved', async () => {
    const desk = await fakeHost('Desk')
    hostDirectories.add('/home/anna/repo/.git')
    scripts.set('*', [{ text: 'Hello, I will work in your repository.' }])
    const added = await api<RobotSummary>(ANNA, '/api/definitions/coding-robot/add', { body: { workspace: { host: desk.hostId, root: '~/repo' } } })
    expect(added.status).toBe(200)
    const id = added.body.id
    await settle(id)
    const setup = await promptOf(id)
    expect(setup.sections.find((section) => section.name === 'Platform')!.text).toContain('- Workspace: ~/repo on Desk (bash), chosen by your owner; it is set when your setup is approved.')
    expect(hostFileCalls).toEqual([])
    expect((await settingsOf(id)).workspace).toBeNull()

    scripts.set(id, [{ calls: [{ name: 'setup_complete', args: { purpose: 'Work on the repository.', tools: { files: 'allow' } } }] }, { say: 'Proposed.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Go ahead.' } })
    await settle(id)
    const proposal = (await api<{ asks: Array<{ id: string; revision: number; kind: string }> }>(ANNA, `/api/robots/${id}/conversation`)).body.asks.find((entry) => entry.kind === 'setup')!
    scripts.set(id, [{ say: 'Ready.' }])
    expect((await api(ANNA, `/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision, approve: true } })).status).toBe(200)
    await settle(id)
    expect((await settingsOf(id)).workspace).toEqual({ hostId: desk.hostId, host: 'Desk', root: '/home/anna/repo', repository: '/home/anna/repo' })
    const active = await promptOf(id)
    expect(active.sections.find((section) => section.name === 'Platform')!.text).toContain('- Workspace: /home/anna/repo on Desk (repository /home/anna/repo, bash)')
    expect(active.skills).toContain('coding (platform): Working in a Workspace: instructions first, tests and commits the repository\'s way, secrets, worktrees, reporting.')
    // The source ladder names the Workspace.
    expect(active.sections.find((section) => section.name === 'Platform')!.text).toContain('your Workspace, when you have one, is where your work on its repository happens')
    // Code is its Work details by default (cw-1h3q).
    expect((await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.id === id)!.workDetails).toBe('code')
  }, 60_000)
})
