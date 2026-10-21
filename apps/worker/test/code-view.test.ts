/**
 * The Code view's server side (v1.21 ticket 07): Work details as a Robot setting with the person's default, Code for a Robot with a
 * Workspace (cw-jy38, cw-1h3q), and the page's calls read in full from the chapter log, masked and bounded (cw-sc3z).
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem, Conversation, RobotSettings, RobotSummary, ToolCallDetails } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostDirectories } from './fake-host.ts'
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

async function robot(extra: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow' }, hosts: {} }, ...extra } })
  await testRobot(body.id).activateForTest()
  return body.id
}
const row = async (id: string) => (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.id === id)!
const settings = async (id: string) => (await api<{ settings: RobotSettings }>(ANNA, `/api/robots/${id}/panel`)).body.settings

describe('Work details per Robot (cw-jy38, cw-1h3q)', () => {
  it('follows the person by default, takes the Robot\'s own choice, and is Code for a Robot with a Workspace', async () => {
    const id = await robot()
    expect((await row(id)).workDetails).toBeUndefined()
    expect((await settings(id)).workDetails).toBeNull()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { workDetails: 'verbose' } })
    expect((await row(id)).workDetails).toBe('verbose')
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { workDetails: null } })
    expect((await row(id)).workDetails).toBeUndefined()
    // A Workspace makes Code the Robot's default; its own choice still wins.
    const desk = await fakeHost('Desk')
    hostDirectories.add('/home/anna/repo/.git')
    const coder = await robot({ grants: { tools: { files: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } } })
    await api(ANNA, `/api/robots/${coder}/settings`, { method: 'PATCH', body: { workspace: { host: desk.hostId, root: '/home/anna/repo' } } })
    expect((await row(coder)).workDetails).toBe('code')
    await api(ANNA, `/api/robots/${coder}/settings`, { method: 'PATCH', body: { workDetails: 'standard' } })
    expect((await row(coder)).workDetails).toBe('standard')
  })
})

describe('the page\'s calls from the log (cw-sc3z)', () => {
  it('gives each call of an activity item in full, past the chat row\'s clip, and refuses nothing it was not asked', async () => {
    const id = await robot()
    const long = Array.from({ length: 900 }, (_, line) => `line ${line + 1} of a long file`).join('\n')
    scripts.set(id, [
      { calls: [{ name: 'write', args: { on: 'files', file_path: 'long.txt', content: long } }] },
      { calls: [{ name: 'read', args: { on: 'files', file_path: 'long.txt' } }] },
      { text: 'Done.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation?details=1`)).body.items
    const activities = items.filter((item): item is Extract<ChatItem, { kind: 'activity' }> => item.kind === 'activity' && (item.calls ?? []).length > 0)
    const clipped = activities.flatMap((item) => item.calls ?? [])
    expect(clipped.find((call) => call.name === 'read')!.result.length).toBeLessThan(7_000)
    const { body } = await api<ToolCallDetails>(ANNA, `/api/robots/${id}/conversation/calls`, { body: { items: activities.map((item) => ({ id: item.id, calls: (item.calls ?? []).map((call) => call.id) })) } })
    expect(body.truncated).toBe(false)
    expect(body.calls.map((call) => call.name).sort()).toEqual(['read', 'write'])
    expect(JSON.parse(body.calls.find((call) => call.name === 'write')!.args)).toMatchObject({ content: long })
    expect(body.calls.find((call) => call.name === 'read')!.result).toContain('900: line 900 of a long file')
    // Only the calls asked for.
    const one = await api<ToolCallDetails>(ANNA, `/api/robots/${id}/conversation/calls`, { body: { items: [{ id: activities[0]!.id, calls: [] }] } })
    expect(one.body.calls).toEqual([])
  })

  it('bounds a request to forty items', async () => {
    const id = await robot()
    const many = Array.from({ length: 45 }, (_, index) => ({ id: `missing-${index}`, calls: ['c'] }))
    const { body } = await api<ToolCallDetails>(ANNA, `/api/robots/${id}/conversation/calls`, { body: { items: many } })
    expect(body).toEqual({ calls: [], truncated: true })
  })
})
