/**
 * Cost by source (v1.14 ticket 05): model, browser and services land in their own lines; the Robot panel,
 * the Member's own view and the Admin view show the same breakdown; the spend limit counts every source.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminView, CostBreakdown, Me, MemberCosts, RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
/** One scripted Turn (110 tokens) costs $0.60. */
const PRICED_STUB = { provider: 'stub', model: 'stub', label: 'Stub', contextWindow: 128000, price: { input: 0.6 / 110 * 1_000_000, output: 0.6 / 110 * 1_000_000 } }

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { models: [PRICED_STUB] } })
})

async function robotWith(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const breakdownOf = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.usage.breakdown
const sum = (breakdown: CostBreakdown) => breakdown.model.robot + breakdown.model.review + breakdown.model.subagent + breakdown.browser + breakdown.box + breakdown.services

/** A gate the scripted model waits at: the Turn is working until the test opens it. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

describe('cost by source (ao-zbld, ao-ef5t, ao-ypas)', () => {
  it('model, browser and service costs land in their sources; the Robot, Member and Admin views agree on the total', async () => {
    const id = await robotWith(['browser'])
    const before = await breakdownOf(id)
    const wait = gate()
    scripts.set(id, [
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/' } }] },
      { gate: wait.promise, then: { text: 'Looked.' } },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'look at the shop' } })
    // The browser has been open an hour when the Turn ends (Browser Run: $0.09 an hour).
    await vi.waitFor(async () => expect(await testRobot(id).browserOpenForTest()).toBe(true), { timeout: 10_000 })
    await testRobot(id).backdateBrowserForTest(3_600_000)
    wait.open()
    await settle(id)
    await env.ROBOT.getByName(id).recordExa(0.25)

    const robot = await breakdownOf(id)
    // Three requests at $0.60: the browser call, the reply, and the platform step that follows a Turn that said nothing.
    expect(robot.model.robot - before.model.robot).toBeCloseTo(1.8, 5)
    expect(robot.browser).toBeCloseTo(0.09, 3)
    expect(robot.services).toBeCloseTo(0.25, 5)
    expect([robot.model.review, robot.model.subagent, robot.box]).toEqual([0, 0, 0])
    expect(robot.total).toBeCloseTo(sum(robot), 9)
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.usage.costUsd).toBeCloseTo(robot.total, 9)

    // The Member's own view sums their Robots by source, with this Robot's line.
    const mine = (await api<MemberCosts>(ANNA, '/api/me/costs')).body
    expect(mine.byRobot.find((row) => row.robotId === id)?.breakdown).toEqual(robot)
    expect(mine.breakdown.browser).toBeCloseTo(0.09, 3)
    expect(mine.breakdown.total).toBeCloseTo(sum(mine.breakdown), 9)
    expect(mine.limit).toEqual({ kind: 'none' })

    // Admin: the same breakdown for the Robot and for the Member.
    const admin = (await api<AdminView>(ANNA, '/api/admin')).body
    expect(admin.fleet.find((row) => row.id === id)!.usage.breakdown).toEqual(robot)
    const me = (await api<Me>(ANNA, '/api/me')).body
    expect(admin.members.find((row) => row.id === me.id)!.usage.breakdown).toEqual(mine.breakdown)
  })
})

describe('the spend limit counts every source (ao-nkkb)', () => {
  it('model cost under the limit and a service cost under the limit together block the Robot', async () => {
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { robotSpendLimit: { kind: 'usd', amount: 4 } } })
    const id = await robotWith([])
    const status = async () => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.summary.status
    await env.ROBOT.getByName(id).recordExa(2)
    expect(await status()).toBe('active')
    scripts.set(id, [{ text: 'Done.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    const after = await breakdownOf(id)
    // Neither the model nor the service line alone reaches the limit; their sum does.
    expect(after.model.robot).toBeLessThan(4)
    expect(after.services).toBeLessThan(4)
    expect(after.total).toBeGreaterThan(4)
    expect(await status()).toBe('blocked')
  })
})
