/**
 * Threads between the Mr. Robots of two Members of one Home (v1.9): invitations, talking, the pause at 20,
 * closing and the lists. Fake turns; no network.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminView, ChatItem, Conversation, ProposalView, RobotPanel, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
let anna = ''
let ben = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
  anna = await chief(ANNA)
  ben = await chief(BEN)
})

async function chief(as: string): Promise<string> {
  const id = (await api<RobotSummary[]>(as, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
  await settle(id)
  await api(as, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  return id
}

async function say(as: string, id: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(as, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
}

const chat = async (as: string, id: string) => (await api<Conversation>(as, `/api/robots/${id}/conversation`)).body.items
const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const openAsk = async (as: string, id: string): Promise<ProposalView> => {
  const ask = (await chat(as, id)).flatMap((item) => (item.kind === 'question' && item.proposal.status === 'open' && item.proposal.kind === 'thread' ? [item.proposal] : [])).at(-1)
  if (ask === undefined) throw new Error('no open Thread Ask')
  return ask
}
const answer = (as: string, id: string, ask: ProposalView, approve: boolean, scope?: string) =>
  api(as, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, approve, ...(scope === undefined ? {} : { scope }) } })

/** Anna's chief invites Ben's; returns the Thread id. */
async function invite(topic = 'Dinner on Friday', scope = 'my calendar for Friday'): Promise<string> {
  await say(ANNA, anna, [{ calls: [{ name: 'thread_open', args: { chief_id: ben, topic, scope } }] }, { text: 'Invited.' }])
  return (JSON.parse(toolResults(anna).at(-1)!) as { threadId: string }).threadId
}

async function openThread(annaScope = 'my calendar for Friday', benScope = 'my food preferences'): Promise<string> {
  const id = await invite('Dinner on Friday', annaScope)
  await settle(ben)
  scripts.set(anna, [{ text: 'ok' }])
  scripts.set(ben, [{ text: 'ok' }])
  await answer(ANNA, anna, await openAsk(ANNA, anna), true, annaScope)
  await answer(BEN, ben, await openAsk(BEN, ben), true, benScope)
  await settle(anna)
  await settle(ben)
  return id
}

describe('invitations (ch-c2xa, ch-l4jg, ch-vrl7, ch-hikl, ch-fri7, ch-0cn1)', () => {
  it('lists the other chiefs of the Home, not the asker (ch-c2xa)', async () => {
    await say(ANNA, anna, [{ calls: [{ name: 'thread_chiefs', args: {} }] }, { text: 'ok' }])
    const { chiefs } = JSON.parse(toolResults(anna).at(-1)!) as { chiefs: Array<{ id: string; ownerName: string }> }
    expect(chiefs).toEqual([expect.objectContaining({ id: ben, ownerName: 'Ben' })])
  })

  it('asks both owners with the topic and an editable scope, stores the scope exactly and opens only after both approve (ch-l4jg, ch-vrl7, ch-hikl, ch-fri7)', async () => {
    const id = await invite('Dinner on Friday', 'my calendar for Friday')
    const out = await openAsk(ANNA, anna)
    expect(out.thread).toMatchObject({ id, phase: 'invitation-out', topic: 'Dinner on Friday', scope: 'my calendar for Friday', other: "Ben's Mr. Robot" })
    const incoming = await openAsk(BEN, ben)
    expect(incoming.thread).toMatchObject({ id, phase: 'invitation-in', topic: 'Dinner on Friday', scope: '' })
    expect(incoming.purpose).toBe('Anna\'s Mr. Robot wants to talk about "Dinner on Friday"')

    scripts.set(anna, [{ text: 'ok' }])
    await answer(ANNA, anna, out, true, '  my calendar,\nbut not the doctor  ')
    expect((await testRobot(anna).panel(true, (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((r) => r.id === anna)!)).threads![0]).toMatchObject({ state: 'invited', scope: 'my calendar for Friday' })
    expect((await env.HOME.getByName('home').adminView((await api<{ id: string }>(ANNA, '/api/me')).body.id)).threads![0]).toMatchObject({ state: 'invited' })

    scripts.set(anna, [{ text: 'opened' }])
    scripts.set(ben, [{ text: 'opened' }])
    await answer(BEN, ben, incoming, true, 'only that I like fish')
    await settle(anna)
    await settle(ben)
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${anna}/panel`)).body
    expect(panel.threads![0]).toMatchObject({ id, state: 'open', scope: '  my calendar,\nbut not the doctor  ' })
    expect((await api<RobotPanel>(BEN, `/api/robots/${ben}/panel`)).body.threads![0]).toMatchObject({ state: 'open', scope: 'only that I like fish' })
    // Both owners are told, in their chief's Conversation.
    for (const [as, robot] of [[ANNA, anna], [BEN, ben]] as const) {
      expect((await chat(as, robot)).some((item) => item.kind === 'thread' && item.event === 'opened' && item.thread.topic === 'Dinner on Friday')).toBe(true)
    }
    expect(JSON.stringify(requests.get(ben)!.at(-1)!.messages)).toContain('Thread opened')
  })

  it('a decline ends the Thread and the other chief learns only that (ch-0cn1)', async () => {
    const id = await invite()
    scripts.set(anna, [{ text: 'ok' }])
    await answer(ANNA, anna, await openAsk(ANNA, anna), true)
    scripts.set(ben, [{ text: 'ok' }])
    scripts.set(anna, [{ text: 'ok' }])
    await answer(BEN, ben, await openAsk(BEN, ben), false)
    await settle(anna)
    await settle(ben)
    const told = JSON.stringify(requests.get(anna)!.at(-1)!.messages)
    expect(told).toContain('declined the Thread about')
    expect(told).not.toContain('because')
    expect((await api<RobotPanel>(ANNA, `/api/robots/${anna}/panel`)).body.threads![0]).toMatchObject({ id, state: 'declined' })
    // The Ask on the other side is gone.
    expect((await chat(ANNA, anna)).some((item) => item.kind === 'question' && item.proposal.status === 'open')).toBe(false)
    await say(ANNA, anna, [{ calls: [{ name: 'thread_send', args: { thread_id: id, text: 'hello?', idempotency_key: 'k' } }] }, { text: 'ok' }])
    expect(toolResults(anna).at(-1)).toContain('declined')
  })

  it('only Mr. Robot has the thread tools (ch-rqnf)', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const created = (await api<{ id: string }>(ANNA, '/api/robots', { body: {} })).body.id
    await settle(created)
    await api(ANNA, `/api/robots/${created}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['messaging', 'robots', 'files'], skills: [], recipients: [], secrets: [] } } })
    await testRobot(created).activateForTest()
    await say(ANNA, created, [{ text: 'ok' }])
    const offered = requests.get(created)!.at(-1)!.tools!.map((tool) => tool.name)
    expect(offered.filter((name) => name.startsWith('thread_'))).toEqual([])
    await say(ANNA, anna, [{ text: 'ok' }])
    const chiefTools = requests.get(anna)!.at(-1)!.tools!
    expect(chiefTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['thread_chiefs', 'thread_open', 'thread_send', 'thread_close', 'thread_list']))
  })
})

describe('talking (ch-jnet, ch-6ymu, ch-iy16, ch-408z, ch-k2tp, ch-v1p8)', () => {
  it('delivers messages both ways with the topic and the receiver\'s own scope, labelled in both Conversations, and counts usage (ch-jnet, ch-6ymu, ch-iy16, ch-k2tp)', async () => {
    const id = await openThread()
    scripts.set(ben, [{ calls: [{ name: 'thread_send', args: { thread_id: id, text: 'Friday works. Fish?', idempotency_key: 'b1' } }] }, { text: 'Replied.' }])
    scripts.set(anna, [{ text: 'Got it.' }])
    await say(ANNA, anna, [{ calls: [{ name: 'thread_send', args: { thread_id: id, text: 'Are you free on Friday?', idempotency_key: 'a1' } }] }, { text: 'Asked Ben.' }])
    await settle(ben)
    await settle(anna)
    const wake = JSON.stringify(requests.get(ben)!.find((request) => JSON.stringify(request.messages).includes('Are you free on Friday?'))!.messages)
    expect(wake).toContain('Dinner on Friday')
    expect(wake).toContain('my food preferences')
    expect(wake).not.toContain('my calendar for Friday')
    expect(wake).toContain("Anna's Mr. Robot")

    const labelled = (items: readonly ChatItem[]) => items.flatMap((item) => (item.kind === 'message' && item.thread !== undefined ? [{ from: (item.sender as { name: string }).name, text: item.text }] : []))
    expect(labelled(await chat(ANNA, anna))).toEqual([{ from: "Anna's Mr. Robot", text: 'Are you free on Friday?' }, { from: "Ben's Mr. Robot", text: 'Friday works. Fish?' }])
    expect(labelled(await chat(BEN, ben))).toEqual([{ from: "Anna's Mr. Robot", text: 'Are you free on Friday?' }, { from: "Ben's Mr. Robot", text: 'Friday works. Fish?' }])
    const card = (await chat(BEN, ben)).find((item) => item.kind === 'thread')
    expect(card).toMatchObject({ kind: 'thread', thread: { topic: 'Dinner on Friday', state: 'open', other: { label: "Anna's Mr. Robot" } } })
    expect((await api<RobotPanel>(BEN, `/api/robots/${ben}/panel`)).body.threads![0]!.messageCount).toBe(2)
    // The wake-up was a Turn like any other: it is in the usage.
    expect((await api<RobotPanel>(BEN, `/api/robots/${ben}/panel`)).body.usage.inputTokens).toBeGreaterThan(0)
  })

  it('a chief over its spend limit does not run the Thread message as a Turn (ch-k2tp)', async () => {
    const id = await openThread()
    await api(BEN, `/api/robots/${ben}/settings`, { method: 'PATCH', body: { spendLimitUsd: 0 } })
    const before = requests.get(ben)?.length ?? 0
    await say(ANNA, anna, [{ calls: [{ name: 'thread_send', args: { thread_id: id, text: 'Still there?', idempotency_key: 'a1' } }] }, { text: 'Asked.' }])
    await settle(ben)
    expect(requests.get(ben)?.length ?? 0).toBe(before)
    expect((await api<RobotSummary[]>(BEN, '/api/robots')).body.find((robot) => robot.id === ben)!.status).toBe('blocked')
  })

  it('refuses the 21st message until the owner approves going on; the chain limit does not apply (ch-408z)', async () => {
    const id = await openThread()
    scripts.set(ben, [{ text: 'noted' }])
    const sends = Array.from({ length: 20 }, (_, index) => ({ calls: [{ name: 'thread_send', args: { thread_id: id, text: `message ${index + 1}`, idempotency_key: `k${index}` } }] }))
    await say(ANNA, anna, [...sends, { calls: [{ name: 'thread_send', args: { thread_id: id, text: 'message 21', idempotency_key: 'k20' } }] }, { text: 'Paused.' }])
    const results = toolResults(anna).slice(-21)
    expect(results.slice(0, 20).every((text) => text.includes('"sent": true'))).toBe(true)
    expect(results[20]).toContain('Report to your owner first')
    await settle(ben)
    const ask = await openAsk(ANNA, anna)
    expect(ask.thread).toMatchObject({ phase: 'continue', topic: 'Dinner on Friday' })

    scripts.set(anna, [{ text: 'Back at it.' }])
    await answer(ANNA, anna, ask, true)
    await settle(anna)
    await say(ANNA, anna, [{ calls: [{ name: 'thread_send', args: { thread_id: id, text: 'message 21', idempotency_key: 'k21' } }] }, { text: 'Sent.' }])
    expect(toolResults(anna).at(-1)).toContain('"sent": true')
    // The same key sent again is not a second message.
    await say(ANNA, anna, [{ calls: [{ name: 'thread_send', args: { thread_id: id, text: 'message 21', idempotency_key: 'k21' } }] }, { text: 'ok' }])
    expect(toolResults(anna).at(-1)).toContain('already sent')
  })

  it('says the Thread rule in Mr. Robot\'s platform prompt only (ch-v1p8)', async () => {
    const platform = async (as: string, id: string) => (await api<{ sections: Array<{ name: string; text: string }> }>(as, `/api/robots/${id}/prompt`)).body.sections.find((section) => section.name === 'Platform')!.text
    const text = await platform(ANNA, anna)
    expect(text).toContain('use and disclose only the scope your owner gave you')
    expect(text).toContain('USER.md')
    scripts.set('*', [{ text: 'Hello.' }])
    const plain = (await api<{ id: string }>(ANNA, '/api/robots', { body: {} })).body.id
    await settle(plain)
    expect(await platform(ANNA, plain)).not.toContain('Thread')
  })
})

describe('closing and the lists (ch-6g7j, ch-rlnd, ch-gckb, ch-6fcp, ch-5ngu)', () => {
  it('closes with a summary both chiefs receive, and refuses messages after (ch-rlnd)', async () => {
    const id = await openThread()
    scripts.set(ben, [{ text: 'Thanks.' }])
    await say(ANNA, anna, [{ calls: [{ name: 'thread_close', args: { thread_id: id, summary: 'Dinner at 19:00 on Friday.' } }] }, { text: 'Closed.' }])
    await settle(ben)
    expect(JSON.stringify(requests.get(ben)!.at(-1)!.messages)).toContain('Dinner at 19:00 on Friday.')
    for (const [as, robot] of [[ANNA, anna], [BEN, ben]] as const) {
      expect((await api<RobotPanel>(as, `/api/robots/${robot}/panel`)).body.threads![0]).toMatchObject({ state: 'closed', summary: 'Dinner at 19:00 on Friday.' })
    }
    await say(BEN, ben, [{ calls: [{ name: 'thread_send', args: { thread_id: id, text: 'one more', idempotency_key: 'x' } }] }, { text: 'ok' }])
    expect(toolResults(ben).at(-1)).toContain('closed')
  })

  it('puts an outcome to the owner as a review Ask (ch-6g7j)', async () => {
    const id = await openThread()
    await say(ANNA, anna, [{ calls: [{ name: 'propose_review', args: { title: `Outcome of "Dinner on Friday"`, items: [{ id: 'dinner', title: 'Dinner Friday 19:00', body: 'Agreed with Ben\'s Mr. Robot in Thread ' + id }] } }] }, { text: 'Asked you.' }])
    const review = (await chat(ANNA, anna)).find((item) => item.kind === 'question' && item.proposal.kind === 'review')
    expect(review).toMatchObject({ proposal: { status: 'open', review: { title: 'Outcome of "Dinner on Friday"' } } })
  })

  it('closes an open Thread after 7 days without a message, by the Home alarm, with a note in both Conversations (ch-gckb)', async () => {
    const id = await openThread()
    const home = env.HOME.getByName('home') as unknown as DurableObjectStub<import('./worker.ts').Home>
    expect(await home.alarmForTest()).toBeGreaterThan(Date.now() + 6.9 * 24 * 3600 * 1000)
    await home.backdateThreadsForTest(8 * 24 * 3600 * 1000)
    await runDurableObjectAlarm(home)
    for (const [as, robot] of [[ANNA, anna], [BEN, ben]] as const) {
      expect((await api<RobotPanel>(as, `/api/robots/${robot}/panel`)).body.threads![0]).toMatchObject({ id, state: 'closed', closedBy: 'idle' })
      expect((await chat(as, robot)).some((item) => item.kind === 'thread' && item.event === 'idle')).toBe(true)
    }
  })

  it('lists the Threads in the admin view and in the panel (ch-5ngu, ch-6fcp)', async () => {
    const id = await openThread()
    const view = (await api<AdminView>(ANNA, '/api/admin')).body
    expect(view.threads).toEqual([expect.objectContaining({ id, topic: 'Dinner on Friday', state: 'open', participants: [expect.objectContaining({ ownerName: 'Anna' }), expect.objectContaining({ ownerName: 'Ben' })] })])
    await say(ANNA, anna, [{ calls: [{ name: 'thread_list', args: {} }] }, { text: 'ok' }])
    expect(JSON.parse(toolResults(anna).at(-1)!)).toEqual({ threads: [expect.objectContaining({ threadId: id, state: 'open', yourScope: 'my calendar for Friday', messagesBeforePause: 20 })] })
  })
})
