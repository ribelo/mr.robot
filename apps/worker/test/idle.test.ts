/**
 * Cache warming and idle compaction (v1.14 ticket 09): nothing inside a Turn or while anything is queued;
 * the moments come from the end of the last Turn and the Provider's cache window.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RobotSettings, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scriptedProviders, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const MINUTE = 60_000


beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})
afterEach(() => {
  scriptedProviders.delete('anthropic')
})

async function staff(settings: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: ['files'], skills: [], recipients: [], secrets: [] }, ...settings } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function mrRobot(): Promise<string> {
  const id = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
  await settle(id)
  return id
}

async function say(id: string, text: string, ...script: Parameters<typeof scripts.set>[1]): Promise<void> {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

async function idleMoment(id: string): Promise<void> {
  await testRobot(id).idleDueForTest()
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  await settle(id)
}

const settings = async (id: string) => (await api<{ settings: RobotSettings }>(ANNA, `/api/robots/${id}/panel`)).body.settings
const events = (id: string) => env.ROBOT.getByName(id).trajectory()
const compacted = async (id: string) => (await events(id)).some((event) => event.type === 'user/message' && JSON.stringify(event.data).includes('compact-checkpoint'))

describe('idle plugins (ao-jlr0, ao-f4sp, ao-8hi8, ao-7bq9, ao-z22f, ao-c3er)', () => {
  beforeEach(() => {
  })

  it('defaults: Mr. Robot warms and compacts after the warmings (v1.20); another Robot compacts and does not warm; the floor is 20 000', async () => {
    expect(await settings(await mrRobot())).toMatchObject({ cacheWarming: true, idleCompaction: true, idleCompactionFloorTokens: 20_000 })
    expect(await settings(await staff())).toMatchObject({ cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20_000 })
  })

  it('a Turn ending with an empty queue plans the moment; a Wake-up before it drops the plan and nothing idle happens', async () => {
    const id = await staff({ idleCompactionFloorTokens: 0 })
    const before = Date.now()
    await say(id, 'hello', { text: 'Hi.' })
    const [moment] = await testRobot(id).idlePlanForTest()
    expect(moment!.action).toBe('compact')
    expect(moment!.at).toBeGreaterThanOrEqual(before + 54 * MINUTE)
    expect(moment!.at).toBeLessThan(Date.now() + 54 * MINUTE + 1000)
    expect(await testRobot(id).alarmForTest()).toBeLessThanOrEqual(moment!.at)

    // The moment is due, but a message comes first: its Wake-up drops the plan; the next one is 54 minutes after its Turn.
    await testRobot(id).idleDueForTest()
    await say(id, 'one more thing', { text: 'Sure.' })
    const calls = requests.get(id)!.length
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(requests.get(id)!.length).toBe(calls)
    expect(await compacted(id)).toBe(false)
    expect((await testRobot(id).idlePlanForTest())[0]!.at).toBeGreaterThan(Date.now() + 50 * MINUTE)
  })

  it('warming replays the last request for one token at 54, 108 and 162 minutes on a one-hour cache', async () => {
    scriptedProviders.add('anthropic')
    const id = await mrRobot()
    await env.ROBOT.getByName(id).updateSettings({ model: { provider: 'anthropic', model: 'claude-sonnet-4-5', effort: 'off' } })
    const start = Date.now()
    await say(id, 'what is on today?', { say: 'Your dentist at 3.' })
    const plan = await testRobot(id).idlePlanForTest()
    // Then closing (v1.20, dm-2ilu): the fourth moment is the idle compaction.
    expect(plan.map((step) => step.action)).toEqual(['warm', 'warm', 'warm', 'compact'])
    expect(plan.map((step) => Math.round((step.at - start) / MINUTE))).toEqual([54, 108, 162, 216])
    const last = requests.get(id)!.at(-1)!
    const turnsBefore = (await events(id)).filter((event) => event.type === 'turn/start').length
    for (let index = 0; index < 3; index += 1) {
      scripts.set(id, [{ text: '.' }])
      await idleMoment(id)
      const warm = requests.get(id)!.at(-1)!
      expect(warm.maxTokens).toBe(1)
      expect(warm.purpose as string).toBe('cache-warm')
      expect(JSON.stringify(warm.messages)).toBe(JSON.stringify(last.messages))
      expect(JSON.stringify(warm.tools)).toBe(JSON.stringify(last.tools))
    }
    expect((await testRobot(id).idlePlanForTest()).map((step) => step.action)).toEqual(['compact'])
    // Warming is not a Turn: nothing is added to the log.
    expect((await events(id)).filter((event) => event.type === 'turn/start')).toHaveLength(turnsBefore)
  })

  it('a Provider without a known cache window gets no warming request (ao-c3er); the compaction comes at 54', async () => {
    const id = await mrRobot()
    await say(id, 'hi', { text: 'Hello.' })
    expect((await testRobot(id).idlePlanForTest()).map((step) => step.action)).toEqual(['compact'])
  })

  it('idle compaction runs one memory step, then compacts; the next Turn starts from the summary with a fresh memory baseline', async () => {
    const id = await staff({ idleCompactionFloorTokens: 0 })
    await say(id, 'I like green tea.', { calls: [{ name: 'write', args: { on: 'files', file_path: 'memory/2026-10-21.md', content: '- Anna said she likes green tea.\n' } }] }, { text: 'Noted.' })
    scripts.set(id, [
      // The snapshot (v1.20) comes first: nothing to add.
      { text: '' },
      { calls: [{ name: 'write', args: { on: 'files', file_path: 'MEMORY.md', content: '# MEMORY.md\n- Anna likes green tea.\n' } }] },
      { text: '' },
      { text: 'SUMMARY: Anna said she likes green tea; it is in MEMORY.md.' },
    ])
    await idleMoment(id)
    const seen = requests.get(id)!
    expect(JSON.stringify(seen.at(-3)!.messages.at(-1))).toContain('Memory sweep: compaction is coming')
    expect(await compacted(id)).toBe(true)
    expect(await testRobot(id).idlePlanForTest()).toEqual([])

    await say(id, 'what tea do I like?', { text: 'Green tea.' })
    const next = JSON.stringify(requests.get(id)!.at(-1)!.messages)
    expect(next).toContain('SUMMARY: Anna said she likes green tea')
    expect(next).toContain('Anna likes green tea.')
    expect(next).not.toContain('Memory sweep: compaction is coming')
  })

  it('a context below the floor is left alone (ao-z22f)', async () => {
    const id = await staff({ idleCompactionFloorTokens: 1_000_000 })
    await say(id, 'hello', { text: 'Hi.' })
    const calls = requests.get(id)!.length
    await idleMoment(id)
    expect(requests.get(id)!.length).toBe(calls)
    expect(await compacted(id)).toBe(false)
  })

  it('the owner and Mr. Robot as deputy change the switches and the floor (ao-5zin)', async () => {
    const id = await staff()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { cacheWarming: true, idleCompaction: false, idleCompactionFloorTokens: 5000 } })
    expect(await settings(id)).toMatchObject({ cacheWarming: true, idleCompaction: false, idleCompactionFloorTokens: 5000 })

    const chief = await mrRobot()
    await say(chief, 'let it compact again', { calls: [{ name: 'robot_settings_set', args: { robot_id: id, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 30000 } }] }, { text: 'Done.' })
    expect(await settings(id)).toMatchObject({ cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 30000 })
  })
})