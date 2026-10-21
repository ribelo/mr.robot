/**
 * v1.20.1 ticket 03: shared Pages follow their owner (cross-review #3, #12); a duty that cannot run re-arms later, never in the past; the
 * dream-hour close follows the Space's default (cross-review #4); the dream is priced at the model that ran it (v1.20-review #4).
 */
import { env, reset, runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me, SharedPageView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

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
})

async function robot(as: string, settings: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow' } }, ...settings } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(as: string, id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(as, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const open = (url: string) => SELF.fetch(url, { headers: { 'x-dev-identity': 'stranger@example.org' } })

describe('shared Pages follow their owner (cross-review #3, #12)', () => {
  it("serves a paused Robot's Page without its PDF, and nothing of a removed Member", async () => {
    const id = await robot(BEN)
    await env.ROBOT.getByName(id).saveFile('pages/report.md', '# Flats\n\nA list.\n')
    const shared = (await api<SharedPageView>(BEN, `/api/robots/${id}/page/share`, { body: { path: 'pages/report.md' } })).body
    expect((await open(shared.url)).status).toBe(200)
    await api(BEN, `/api/robots/${id}/pause`, { body: {} })
    expect((await open(shared.url)).status).toBe(200)
    expect((await open(`${shared.url}/pdf`)).status).toBe(503)
    const ben = (await api<Me>(BEN, '/api/me')).body
    expect((await api(ANNA, `/api/admin/members/${ben.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await open(shared.url)).status).toBe(404)
    expect((await open(`${shared.url}/pdf`)).status).toBe(404)
  })
})

describe('duties and the dream hour (cross-review #4, #5; v1.20-review #4, #8)', () => {
  it('a duty due while the Robot is busy re-arms a retry later, never in the past', async () => {
    const id = await robot(ANNA)
    await turn(ANNA, id, 'note', [{ calls: [{ name: 'write', args: { on: 'files', file_path: 'memory/2026-10-21.md', content: '- a note\n' } }] }, { say: 'Noted.' }])
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    scripts.set(id, [{ gate, then: { say: 'Done.' } }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'work long' } })
    await testRobot(id).dreamNowForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    const next = await testRobot(id).alarmForTest()
    expect(next).toBeGreaterThan(Date.now() + 10_000)
    release()
    await settle(id)
  })

  it('the dream-hour close follows the Space default when the Robot has no setting', async () => {
    const id = await robot(ANNA)
    await turn(ANNA, id, 'hello', [{ say: 'Hi.' }])
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { defaultDreaming: false } })
    const before = requests.get(id)!.length
    await testRobot(id).dreamHourForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(requests.get(id)!.slice(before).some((request) => request.purpose === 'compaction')).toBe(false)
    expect((await testRobot(id).chaptersForTest()).length).toBe(1)
  })

  it("prices the dream at the dream model's price", async () => {
    const dreamer = { provider: 'stub', model: 'dreamer', label: 'Dreamer', contextWindow: 128_000, price: { input: 1_000, output: 1_000 } }
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { models: [dreamer], defaultDreamModel: { provider: 'stub', model: 'dreamer', effort: 'off' } } })
    const id = await robot(ANNA)
    await turn(ANNA, id, 'note', [{ calls: [{ name: 'write', args: { on: 'files', file_path: 'memory/2026-10-21.md', content: '- a note\n' } }] }, { say: 'Noted.' }])
    expect((await testRobot(id).costBySourceForTest())['robot'] ?? 0).toBe(0)
    scripts.set(id, [{ text: '' }])
    await testRobot(id).dreamNowForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(requests.get(id)!.at(-1)!.model).toBe('dreamer')
    expect((await testRobot(id).costBySourceForTest())['memory']).toBeGreaterThan(0)
  })
})
