import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me, RobotPanel, RobotSummary } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  // The stub model costs $1 per million input tokens and $10 per million output tokens.
  await api(ANNA, '/api/admin/settings', {
    method: 'PATCH',
    body: { models: [{ provider: 'stub', model: 'stub', label: 'Stub', contextWindow: 128000, price: { input: 1, output: 10 } }] },
  })
})

async function activeRobot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(id: string, text: string) {
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
const summary = async (id: string) => (await robots(ANNA)).find((robot) => robot.id === id) as RobotSummary

describe('usage and spend limits', () => {
  it('sums every Turn into the Robot and Member counters, shown for the current month (robot-6jqh)', async () => {
    const id = await activeRobot()
    const before = (await panel(id)).usage
    scripts.set(id, [{ text: 'one' }, { text: 'two' }])
    await say(id, 'first')
    await say(id, 'second')
    const usage = (await panel(id)).usage
    expect(usage.month).toBe(new Date().toISOString().slice(0, 7))
    expect(usage.inputTokens - before.inputTokens).toBe(200)
    expect(usage.outputTokens - before.outputTokens).toBe(20)
    expect(usage.costUsd - before.costUsd).toBeCloseTo((200 * 1 + 20 * 10) / 1_000_000, 10)
    const me = (await api<Me>(ANNA, '/api/me')).body
    const member = await env.MEMBER.getByName(me.id).usage(usage.month)
    expect(member.byRobot.find((row) => row.robotId === id)).toMatchObject({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
  })

  it('finishes the Turn that crosses the limit, blocks the next Wake-up, and resumes when raised (robot-8gag, robot-40nw)', async () => {
    const id = await activeRobot()
    // A limit just above what setup already spent: the next Turn crosses it.
    const spent = (await panel(id)).usage.costUsd
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { spendLimitUsd: spent + 0.0001 } })
    scripts.set(id, [{ text: 'Expensive answer.' }, { text: 'After the raise.' }])
    await say(id, 'do the expensive thing')
    let conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.some((item) => item.kind === 'reply' && item.text === 'Expensive answer.')).toBe(true)
    expect(conversation.items.at(-1)).toMatchObject({ kind: 'notice' })
    expect((conversation.items.at(-1) as { text: string }).text).toContain('monthly spend limit')
    expect(await summary(id)).toMatchObject({ status: 'blocked', fleetState: 'blocked' })

    await say(id, 'and the next thing')
    conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.some((item) => item.kind === 'reply' && item.text === 'After the raise.')).toBe(false)

    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { spendLimitUsd: 100 } })
    await settle(id)
    conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.at(-1)).toMatchObject({ kind: 'reply', text: 'After the raise.' })
    expect(await summary(id)).toMatchObject({ status: 'active' })
  })

  it('applies the Home member limit to all of a Member\'s Robots and lifts it when the admin raises it', async () => {
    const id = await activeRobot()
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { memberSpendLimitUsd: 0.0001 } })
    scripts.set(id, [{ text: 'Costly.' }, { text: 'Resumed.' }])
    await say(id, 'go')
    expect(await summary(id)).toMatchObject({ status: 'blocked' })
    await say(id, 'more')
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { memberSpendLimitUsd: null } })
    await settle(id)
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.at(-1)).toMatchObject({ kind: 'reply', text: 'Resumed.' })
  })
})