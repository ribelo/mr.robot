/**
 * Warming, then closing (v1.20 ticket 02, dm-2ilu, dm-76yv, dm-zyxz): a warming Robot warms at 54, 108 and 162 minutes and closes the
 * chapter at 216; a Wake-up cancels the plan; at the dream hour an open chapter is closed first. Mr. Robot follows the rule.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { programmed, requests, scriptedProviders, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const MINUTE = 60_000

/** Every v1.20 test runs in code mode first, then with direct tool calls (v1.20.1). */
const MODES = [['code mode', true], ['direct calls', false]] as const
let codeMode = true

afterEach(() => {
  programmed.on = false
})

beforeEach(async () => {
  programmed.on = true
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function mrRobot(): Promise<string> {
  const id = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
  await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { idleCompactionFloorTokens: 0, codeMode } })
  return id
}

async function say(id: string, text: string, ...script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

async function alarm(id: string): Promise<void> {
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  await settle(id)
}

const compactions = (id: string) => (requests.get(id) ?? []).filter((request) => request.purpose === 'compaction').length
const chapters = async (id: string) => (await testRobot(id).chaptersForTest()).length

describe.each(MODES)('warming, then closing (dm-2ilu, dm-zyxz), %s', (_mode, code) => {
  beforeEach(() => {
    codeMode = code
  })

  it('Mr. Robot warms three times, then closes the chapter at 216 minutes; a Wake-up before cancels the plan', async () => {
    scriptedProviders.add('anthropic')
    const id = await mrRobot()
    await env.ROBOT.getByName(id).updateSettings({ model: { provider: 'anthropic', model: 'claude-sonnet-4-5', effort: 'off' }, codeMode })
    const start = Date.now()
    await say(id, 'what is on today?', { say: 'Your dentist at 3.' })
    const plan = await testRobot(id).idlePlanForTest()
    expect(plan.map((step) => [step.action, Math.round((step.at - start) / MINUTE)])).toEqual([['warm', 54], ['warm', 108], ['warm', 162], ['compact', 216]])

    // A message before the close: the plan starts again from its Turn.
    await testRobot(id).idleDueForTest()
    await say(id, 'and tomorrow?', { say: 'Nothing.' })
    expect(compactions(id)).toBe(0)
    expect((await testRobot(id).idlePlanForTest()).map((step) => step.action)).toEqual(['warm', 'warm', 'warm', 'compact'])

    for (let index = 0; index < 3; index += 1) {
      scripts.set(id, [{ text: '.' }])
      await testRobot(id).idleDueForTest()
      await alarm(id)
    }
    expect(compactions(id)).toBe(0)
    // The fourth moment: snapshot and compaction (no daily note changed, so no sweep), and the chapter closes.
    scripts.set(id, [{ text: '' }, { text: 'SUMMARY: the dentist at 3.' }])
    await testRobot(id).idleDueForTest()
    await alarm(id)
    expect(compactions(id)).toBe(1)
    expect(await chapters(id)).toBe(2)
    expect(await testRobot(id).idlePlanForTest()).toEqual([])
  }, 60_000)
})

describe.each(MODES)('the dream-hour close (dm-76yv), %s', (_mode, code) => {
  beforeEach(() => {
    codeMode = code
  })

  it('plans the next 03:00 in the Robot\'s zone, closes an open chapter then, and leaves a closed one alone', async () => {
    const id = await mrRobot()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { cacheWarming: false, idleCompaction: false } })
    await say(id, 'remember the dentist', { say: 'Noted.' })
    // The first alarm plans the hour.
    await alarm(id)
    const planned = await testRobot(id).dreamHourForTest()
    expect(planned).toBeGreaterThan(Date.now())
    expect(planned! - Date.now()).toBeLessThanOrEqual(24 * 60 * MINUTE)
    expect(new Date(planned!).getUTCMinutes()).toBe(0)

    scripts.set(id, [{ text: '' }, { text: 'SUMMARY: the dentist.' }])
    await alarm(id)
    expect(compactions(id)).toBe(1)
    expect(await chapters(id)).toBe(2)
    // The next hour is the next 03:00 again; a chapter with nothing in it since is not compacted then.
    expect(await testRobot(id).dreamHourForTest()).toBe(planned)
    await alarm(id)
    expect(compactions(id)).toBe(1)
  }, 60_000)
})