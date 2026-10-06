import { abortAllDurableObjects, env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotSummary } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function robot(name: string, tools: string[] = [], recipients: string[] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, {
    method: 'PATCH',
    body: { codeMode: false, identity: { name, title: '', description: `${name} does things`, avatarColor: '#8b5cf6' }, grants: { tools, skills: [], recipients, secrets: [] } },
  })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const lastToolResult = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').at(-1)!.content.map((block) => ('text' in block ? block.text : '')).join('')
const chat = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items

describe('Robot-to-Robot messaging', () => {
  it('lists only granted, reachable, active Robots (robot-bsvs)', async () => {
    const active = await robot('Accountant')
    const paused = await robot('Sleeper')
    await robot('Stranger')
    await api(ANNA, `/api/robots/${paused}/pause`, { body: {} })
    const sender = await robot('Sales', ['messaging'], [active, paused, 'r-not-reachable'])
    await say(sender, 'who can help?', [{ calls: [{ name: 'robot_directory', args: {} }] }, { text: 'ok' }])
    const directory = JSON.parse(lastToolResult(sender)) as Array<{ id: string; name: string }>
    expect(directory).toEqual([expect.objectContaining({ id: active, name: 'Accountant', description: 'Accountant does things' })])
  })

  it('refuses a request without a recipient Grant; the reply needs no reverse Grant (robot-bjq5, robot-mv15, robot-ppzu)', async () => {
    const accountant = await robot('Accountant')
    const stranger = await robot('Stranger')
    const sales = await robot('Sales', ['messaging'], [accountant])
    await say(sales, 'ask', [{ calls: [{ name: 'robot_send', args: { to: stranger, request: 'hi', idempotency_key: 'k0' } }] }, { text: 'refused' }])
    expect(lastToolResult(sales)).toContain('no Grant')

    scripts.set(accountant, [
      (request) => {
        const text = JSON.stringify(request.messages.at(-1))
        const handle = /handle (rh-[0-9a-f-]+)/.exec(text)![1]!
        return { calls: [{ name: 'robot_reply', args: { handle, reply: 'Revenue is 42k.' } }] }
      },
      { text: 'Answered Sales.' },
    ])
    scripts.set(sales, [
      { calls: [{ name: 'robot_send', args: { to: accountant, request: 'What is revenue?', idempotency_key: 'k1' } }] },
      { text: 'Asked the Accountant.' },
      { text: 'Revenue noted.' },
    ])
    await api(ANNA, `/api/robots/${sales}/messages`, { body: { text: 'find revenue' } })
    await settle(sales)
    await settle(accountant)
    await settle(sales)

    const atAccountant = (await chat(accountant)).find((item) => item.kind === 'message' && item.sender.kind === 'robot')
    expect(atAccountant).toMatchObject({ kind: 'message', text: 'What is revenue?', sender: { kind: 'robot', robotId: sales, name: 'Sales', avatarColor: '#8b5cf6' } })
    const atSales = (await chat(sales)).find((item) => item.kind === 'message' && item.sender.kind === 'robot')
    expect(atSales).toMatchObject({ kind: 'message', text: 'Revenue is 42k.', sender: { kind: 'robot', robotId: accountant, name: 'Accountant' } })
    expect((await chat(sales)).at(-1)).toMatchObject({ kind: 'reply', text: 'Revenue noted.' })
  })

  it('delivers exactly once: an exact retry is not a second message and the outbox survives a crash', async () => {
    const accountant = await robot('Accountant')
    await api(ANNA, `/api/robots/${accountant}/pause`, { body: {} })
    await api(ANNA, `/api/robots/${accountant}/resume`, { body: {} })
    const sales = await robot('Sales', ['messaging'], [accountant])
    scripts.set(accountant, [{ text: 'got it' }, { text: 'got it again' }, { text: 'third' }])
    await say(sales, 'ask twice', [
      { calls: [{ name: 'robot_send', args: { to: accountant, request: 'once please', idempotency_key: 'same' } }] },
      { calls: [{ name: 'robot_send', args: { to: accountant, request: 'once please', idempotency_key: 'same' } }] },
      { text: 'done' },
    ])
    expect(lastToolResult(sales)).toContain('already sent')
    await settle(accountant)
    const received = async () => (await chat(accountant)).filter((item) => item.kind === 'message' && item.sender.kind === 'robot')
    expect(await received()).toHaveLength(1)

    await testRobot(sales).outboxOnlyForTest(accountant, 'after the crash', 'crash')
    await abortAllDurableObjects()
    await runDurableObjectAlarm(env.ROBOT.getByName(sales))
    await runDurableObjectAlarm(env.ROBOT.getByName(sales))
    await settle(accountant)
    expect((await received()).map((item) => (item as { text: string }).text)).toEqual(['once please', 'after the crash'])
    expect((await testRobot(sales).outboxForTest()).every((row) => row.status === 'delivered')).toBe(true)
  })

  it('enforces the chain cap and the queue cap', async () => {
    const accountant = await robot('Accountant')
    const from = { robotId: 'r-x', ownerId: 'm', name: 'X', avatarColor: '#000' }
    const target = env.ROBOT.getByName(accountant)
    expect(await target.receive({ id: 'deep', kind: 'request', from, text: 'deep', requestId: 'deep', chain: { id: 'c', hops: 9 } })).toEqual({ accepted: false, reason: 'chain-limit' })
    await api(ANNA, `/api/robots/${accountant}/pause`, { body: {} })
    for (let index = 0; index < 32; index += 1) {
      await target.receive({ id: `m${index}`, kind: 'request', from, text: 'work', requestId: `m${index}`, chain: { id: 'c', hops: 1 } })
    }
    expect(await target.receive({ id: 'one-too-many', kind: 'request', from, text: 'work', requestId: 'x', chain: { id: 'c', hops: 1 } })).toEqual({ accepted: false, reason: 'queue-full' })
  })

  it('lets Mr. Robot create a Robot that he can then message (robot-hk2s, robot-70kf)', async () => {
    const mrRobot = (await robots(ANNA)).find((entry) => entry.kind === 'mr-robot') as RobotSummary
    await api(ANNA, `/api/robots/${mrRobot.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
    scripts.set('*', [{ text: 'Hi, I am new. What should I watch?' }])
    await say(mrRobot.id, 'I need someone to watch flat prices', [
      { calls: [{ name: 'robot_create', args: { brief: 'Watch flat prices in Warsaw' } }] },
      { text: 'Created it; it will ask you a few questions.' },
    ])
    const created = (await robots(ANNA)).find((entry) => entry.kind === 'robot')!
    expect(created.status).toBe('setup')
    expect((await env.ROBOT.getByName(mrRobot.id).settings()).grants.recipients).toEqual([created.id])
    await settle(created.id)
    expect((await chat(created.id)).at(-1)).toMatchObject({ kind: 'reply', text: 'Hi, I am new. What should I watch?' })
  })
})
