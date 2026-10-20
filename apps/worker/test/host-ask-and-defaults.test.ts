/**
 * Native Ask on a Host and Mr. Robot's defaults (v1.16 ticket 09): a tool-call Ask for a facet of a Host is sent to that Host as a notify
 * frame (ob-6jr5); Mr. Robot's files and shell on a new Host start at ask, its browser at allow (ob-2k5x); the runtime section names each
 * Host's state, shell, platform and sandbox (ob-gjp9, ob-vyyg). Driven through the edge API with the scripted model and the fake Host app,
 * which records the notifications it is sent.
 */
import { env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostNotification } from '@mr-robot/host-protocol'
import type { Conversation, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, ran } from './fake-host.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(closeHosts)

/** An ordinary Robot with the given Host grants (by facet item name), active and ready for a message. */
async function robotWith(hosts: Record<string, string>): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: {}, hosts } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

/** One message that makes the Robot call the given tools in order, then end its Turn. */
async function say(id: string, calls: Array<{ name: string; args: Record<string, unknown> }>): Promise<void> {
  scripts.set(id, [...calls.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
}

const mrRobotOf = async (): Promise<string> => (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id

describe('a tool-call Ask for a facet of a Host (ob-6jr5)', () => {
  it('is sent as a notification to that Host, and to no other computer of the owner', async () => {
    const desk = await fakeHost('Desk')
    const laptop = await fakeHost('Laptop')
    const id = await robotWith({ [`${desk.hostId}:shell`]: 'ask' })
    await say(id, [{ name: 'run', args: { on: 'Desk', command: 'make', reason: 'Build the site' } }])
    await new Promise((resolve) => setTimeout(resolve, 100))
    // The Turn's own "finished" notice reaches every computer, as before; only the Ask is named here.
    const asked = (notices: HostNotification[]) => notices.filter((notice) => notice.body.startsWith('wants to use'))
    expect(asked(desk.notices)).toEqual([expect.objectContaining({ body: 'wants to use run: Build the site', url: `/#/r/${encodeURIComponent(id)}` })])
    expect(asked(laptop.notices)).toEqual([])
    const asks = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.filter((item) => item.kind === 'proposal' && item.proposal.kind === 'tool-call')
    expect(asks).toHaveLength(1)
  })
})

describe("Mr. Robot's defaults on a new Host (ob-2k5x)", () => {
  it("starts Mr. Robot's files and shell at ask and leaves its browser at allow; an ordinary Robot holds nothing on the Host", async () => {
    const desk = await fakeHost('Desk')
    const mr = await mrRobotOf()
    const mrSettings = await env.ROBOT.getByName(mr).settings()
    expect(mrSettings.grants.hosts).toEqual({ [`${desk.hostId}:files`]: 'ask', [`${desk.hostId}:shell`]: 'ask', [`${desk.hostId}:browser`]: 'allow' })
    const robot = await robotWith({})
    expect((await env.ROBOT.getByName(robot).settings()).grants.hosts).toEqual({})
  })
})

describe('the Hosts line of the runtime section (ob-gjp9, ob-vyyg)', () => {
  it("names each Host's state, shell, platform and sandbox state", async () => {
    await fakeHost('Desk')
    await fakeHost('Laptop', { platform: 'win32', shell: 'pwsh', sandbox: 'partial' })
    const id = await robotWith({})
    const platform = (await api<{ sections: Array<{ name: string; text: string }> }>(ANNA, `/api/robots/${id}/prompt`)).body.sections.find((section) => section.name === 'Platform')!.text
    expect(platform).toContain('\n- Hosts: Desk · online · bash on linux · sandbox full; Laptop · online · pwsh on Windows · sandbox partial.\n')
  })
})

describe('a shared Host (S3)', () => {
  it("starts every Member's Mr. Robot at ask for files and shell, and at allow for the browser, and asks before it runs", async () => {
    const BEN = 'ben@example.com'
    const desk = await fakeHost('Desk')
    await api(ANNA, `/api/hosts/${desk.hostId}`, { method: 'PATCH', body: { sharing: 'home' } })
    await api(ANNA, '/api/admin/members', { body: { email: BEN } })
    await api(BEN, '/api/me')
    const bensMr = (await api<RobotSummary[]>(BEN, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    expect((await env.ROBOT.getByName(bensMr).settings()).grants.hosts).toEqual({ [`${desk.hostId}:files`]: 'ask', [`${desk.hostId}:shell`]: 'ask', [`${desk.hostId}:browser`]: 'allow' })
    await api(BEN, `/api/robots/${bensMr}/settings`, { method: 'PATCH', body: { codeMode: false } })
    scripts.set(bensMr, [{ calls: [{ name: 'run', args: { on: 'Desk', command: 'uptime', reason: 'Check the load' } }] }, { calls: [{ name: 'write', args: { on: 'Desk', file_path: 'a.txt', content: 'x', reason: 'Note it' } }] }, { text: 'Waiting.' }])
    await api(BEN, `/api/robots/${bensMr}/messages`, { body: { text: 'go' } })
    await settle(bensMr)
    const results = requests.get(bensMr)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
    expect(results.filter((text) => text.includes('waiting for your owner'))).toHaveLength(2)
    expect(ran).not.toContain('uptime')
  })
})
