/**
 * ask (v1.15 ticket 03, gb-b4wz...): one question to the owner with real options. It stores an Ask and returns at once; the owner's answer
 * wakes the Robot as a steer with the Ask id and the value; a dismissal wakes it with that fact; moving on dismisses what asked to go.
 */
import { env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, ConnectionView, Me, ProposalView, RobotSummary } from '@mr-robot/protocol'
import { questionText } from '../src/agent/tools/ask.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { connectorFixtures } from './connector-fixtures.ts'
import { requests, scripts } from './stub-llm.ts'
import { delivered, type Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const API = 'https://discord.com/api/v10'
const realFetch = globalThis.fetch
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  delivered.clear()
  connectorFixtures.reset()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    return url.startsWith('https://push.example/') ? new Response(null, { status: 201 }) : realFetch(input, init)
  }) as typeof fetch
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const OPTIONS = [
  { label: 'Order the red one', value: 'red', description: 'Ships Friday, 129 zł', style: 'primary' },
  { label: 'Order the blue one', value: 'blue' },
  { label: 'Cancel the order', value: 'cancel', style: 'danger' },
]
const QUESTION = { prompt: 'Which one should I order?', help: 'Both are in stock.', options: OPTIONS }

async function activeRobot(settings: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { ...settings } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const proposals = async (id: string): Promise<ProposalView[]> => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'proposal' ? [item.proposal] : []))
const lastWake = (id: string) => JSON.stringify(requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'user').at(-1))
const answerAsk = (id: string, ask: ProposalView, body: Record<string, unknown>) => api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, ...body } })

/** The Robot asks; its Turn ends. */
async function asked(id: string, args: Record<string, unknown> = QUESTION): Promise<ProposalView> {
  scripts.set(id, [{ calls: [{ name: 'ask', args }] }, { calls: [{ name: 'say', args: { text: 'I asked you which one.' } }] }, { text: '' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'buy me a lamp' } })
  await settle(id)
  const open = (await proposals(id)).filter((proposal) => proposal.kind === 'question').at(-1)
  if (open === undefined) throw new Error(`no question Ask; the tool said ${toolResults(id)[0]}`)
  return open
}

describe('ask stores a question and returns at once (gb-b4wz, gb-htdw)', () => {
  it('stores the question with its options and styles, returns { askId, status: waiting } and does not block the program', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ calls: [{ name: 'ask', args: { ...QUESTION, allow_custom: true, dismiss_on_move_on: true } }, { name: 'say', args: { text: 'I went on while you decide.' } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'buy me a lamp' } })
    await settle(id)
    const [result, spoke] = toolResults(id)
    const ask = (await proposals(id)).find((proposal) => proposal.kind === 'question')!
    expect(JSON.parse(result!)).toMatchObject({ askId: ask.id, status: 'waiting' })
    expect(JSON.parse(spoke!)).toEqual({ said: true, attachments: 0 })
    expect(ask).toMatchObject({
      status: 'open', purpose: QUESTION.prompt,
      question: {
        prompt: QUESTION.prompt, help: 'Both are in stock.', allowCustom: true, dismissOnMoveOn: true, urgent: false, answer: null,
        options: [
          { label: 'Order the red one', value: 'red', description: 'Ships Friday, 129 zł', style: 'primary' },
          { label: 'Order the blue one', value: 'blue', description: null, style: 'default' },
          { label: 'Cancel the order', value: 'cancel', description: null, style: 'danger' },
        ],
      },
    })
    expect((await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.id === id)!.fleetState).toBe('waiting for you')
  })

  it('every active Robot and Mr. Robot has it, a Robot in setup and a Subagent do not', async () => {
    const mr = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await settle(mr)
    expect(await env.ROBOT.getByName(mr).toolNames()).toContain('ask')
    scripts.set('*', [{ text: '' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    expect(await env.ROBOT.getByName(body.id).toolNames()).not.toContain('ask')
    await testRobot(body.id).activateForTest()
    expect(await env.ROBOT.getByName(body.id).toolNames()).toContain('ask')
  })

  it('refuses a question it cannot show: no prompt, too many options, no way to answer, twin values', async () => {
    const id = await activeRobot()
    const seven = Array.from({ length: 7 }, (_, index) => ({ label: `Option ${index}`, value: `v${index}` }))
    scripts.set(id, [{ calls: [
      { name: 'ask', args: { prompt: '  ', options: OPTIONS } },
      { name: 'ask', args: { prompt: 'Which?', options: seven } },
      { name: 'ask', args: { prompt: 'Which?' } },
      { name: 'ask', args: { prompt: 'Which?', options: [{ label: 'A', value: 'x' }, { label: 'B', value: 'x' }] } },
      { name: 'ask', args: { prompt: 'Which?', options: [{ label: 'A', value: 'a', style: 'loud' }] } },
    ] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    const results = toolResults(id)
    expect(results[0]).toContain('"prompt" is required')
    expect(results[1]).toContain('at most 6 options')
    expect(results[2]).toContain('give at least one option, or set allow_custom')
    expect(results[3]).toContain('two options have the value "x"')
    expect(results[4]).toContain('style')
    expect(await proposals(id)).toEqual([])
  })
})

describe('the answer wakes the Robot as a steer (gb-1lfb, gb-ewfe)', () => {
  it('an option wakes it with the Ask id, the label and the value; the Ask is closed and cannot be answered twice', async () => {
    const id = await activeRobot()
    const ask = await asked(id)
    scripts.set(id, [{ calls: [{ name: 'say', args: { text: 'Ordering the red one.' } }] }, { text: '' }])
    const answered = await answerAsk(id, ask, { approve: true, value: 'red' })
    expect(answered.status).toBe(200)
    expect(answered.body).toMatchObject({ id: ask.id, status: 'approved', question: { answer: { kind: 'option', value: 'red', label: 'Order the red one' } } })
    await settle(id)
    expect(lastWake(id)).toContain(`[Your owner answered your question ${ask.id}: \\"Order the red one\\" (value: red)]`)
    expect((await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.id === id)!.fleetState).toBe('sleeping')
    expect((await answerAsk(id, ask, { approve: true, value: 'blue' })).status).toBe(409)
  })

  it('reaches a Turn that is still running at its next step, as a steer', async () => {
    const id = await activeRobot()
    const ask = await asked(id)
    const startsBefore = (await env.ROBOT.getByName(id).trajectory()).filter((event) => event.type === 'turn/start').length
    let open!: () => void
    const wait = new Promise<void>((resolve) => { open = resolve })
    scripts.set(id, [{ gate: wait, then: { calls: [{ name: 'my_capabilities', args: {} }] } }, { calls: [{ name: 'say', args: { text: 'Got your answer.' } }] }, { text: '' }])
    const before = requests.get(id)!.length
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'and keep going meanwhile' } })
    await vi.waitFor(() => expect(requests.get(id)!.length).toBeGreaterThan(before), { timeout: 10_000 })
    await answerAsk(id, ask, { approve: true, value: 'blue' })
    open()
    await settle(id)
    const second = JSON.stringify(requests.get(id)![before + 1]!.messages)
    expect(second).toContain(`[Your owner answered your question ${ask.id}`)
    expect(second).toContain('(value: blue)')
    // One Turn took the message and the answer: the answer did not start a Turn of its own.
    expect((await env.ROBOT.getByName(id).trajectory()).filter((event) => event.type === 'turn/start')).toHaveLength(startsBefore + 1)
  })

  it("the owner's own words wake it when the question allows them, and are refused when it does not", async () => {
    const id = await activeRobot()
    const closed = await asked(id)
    expect((await answerAsk(id, closed, { approve: true, text: 'Neither, the green one.' })).status).toBe(400)
    expect((await answerAsk(id, closed, { approve: true, value: 'purple' })).status).toBe(400)
    expect((await proposals(id)).find((proposal) => proposal.id === closed.id)).toMatchObject({ status: 'open' })
    const open = await asked(id, { ...QUESTION, prompt: 'Any other colour?', allow_custom: true })
    scripts.set(id, [{ text: '' }])
    expect((await answerAsk(id, open, { approve: true, text: 'Neither, the green one.' })).body).toMatchObject({ question: { answer: { kind: 'custom', text: 'Neither, the green one.' } } })
    await settle(id)
    const wake = lastWake(id)
    expect(wake).toContain(`[Your owner answered your question ${open.id} in their own words]`)
    expect(wake).toContain('Neither, the green one.')
  })

  it('a dismissal wakes it once with that fact and tells it not to ask again', async () => {
    const id = await activeRobot()
    const ask = await asked(id)
    scripts.set(id, [{ text: '' }])
    const dismissed = await answerAsk(id, ask, { approve: false })
    expect(dismissed.body).toMatchObject({ status: 'rejected', question: { answer: { kind: 'dismissed', reason: 'owner' } } })
    await settle(id)
    expect(lastWake(id)).toContain(`[Your owner dismissed your question ${ask.id}]`)
    expect(lastWake(id)).toContain('Do not ask it again')
    expect((await answerAsk(id, ask, { approve: false })).status).toBe(409)
  })
})

describe('dismiss_on_move_on (gb-nr8s)', () => {
  it("dismisses the question on the owner's next message and tells the Robot with the reason, in that message's Wake-up", async () => {
    const id = await activeRobot()
    // Two questions in one Turn: only the one that asked to go is dismissed.
    scripts.set(id, [{ calls: [{ name: 'ask', args: { ...QUESTION, dismiss_on_move_on: true } }, { name: 'ask', args: { ...QUESTION, prompt: 'A second one that stays?' } }] }, { calls: [{ name: 'say', args: { text: 'Asked.' } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'buy me a lamp' } })
    await settle(id)
    const [ask, keeps] = (await proposals(id)).filter((proposal) => proposal.kind === 'question') as [ProposalView, ProposalView]
    scripts.set(id, [{ text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'never mind the lamp, what time is it?' } })
    await settle(id)
    const after = await proposals(id)
    expect(after.find((proposal) => proposal.id === ask.id)).toMatchObject({ status: 'rejected', question: { answer: { kind: 'dismissed', reason: 'moved-on' } } })
    expect(after.find((proposal) => proposal.id === keeps.id)).toMatchObject({ status: 'open' })
    const wake = lastWake(id)
    expect(wake).toContain('never mind the lamp, what time is it?')
    expect(wake).toContain(`you asked \\"Which one should I order?\\" (${ask.id}); your owner moved on without answering, so it was dismissed. Do not ask again.`)
    // The chat shows the owner's own words only.
    const messages = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'message' ? [item.text] : []))
    expect(messages.at(-1)).toBe('never mind the lamp, what time is it?')
  })

  it('a Robot message is not the owner moving on', async () => {
    const id = await activeRobot()
    const ask = await asked(id, { ...QUESTION, dismiss_on_move_on: true })
    scripts.set(id, [{ text: '' }])
    await testRobot(id).wake({ kind: 'platform', sender: { kind: 'platform' }, text: 'A notice.', payload: { summary: 'Notice' } })
    await settle(id)
    expect((await proposals(id)).find((proposal) => proposal.id === ask.id)).toMatchObject({ status: 'open' })
  })
})

describe('notification (gb-e5bs, gb-viep)', () => {
  async function pushDevice() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    await api(ANNA, '/api/push/subscriptions', { body: { endpoint: 'https://push.example/phone', keys: { p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) }, device: 'phone' } })
  }
  const sentTo = async () => (await (env.MEMBER.getByName(annaId) as unknown as DurableObjectStub<TestMember>).deliveredForTest())

  it('pushes "needs you" with the question; urgent says so; both follow the owner\'s notification settings', async () => {
    await pushDevice()
    const id = await activeRobot()
    delivered.clear()
    await asked(id)
    await asked(id, { ...QUESTION, prompt: 'Is the server on fire?', urgent: true })
    const needs = (await sentTo()).filter((notification) => notification.title.endsWith('needs you'))
    expect(needs.map((notification) => notification.body.split('\n')[0])).toEqual([QUESTION.prompt, 'Urgent: Is the server on fire?'])
    expect(needs.every((notification) => notification.url === `/#/r/${id}`)).toBe(true)

    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { notifications: { enabled: false, members: [], channels: ['pwa'] } } })
    delivered.clear()
    await asked(id, { ...QUESTION, prompt: 'Quiet one?' })
    expect(await sentTo()).toEqual([])
  })

  it('reaches Discord as text with numbered options', async () => {
    connectorFixtures.on('GET', `${API}/users/@me`, { id: 'B1', username: 'mr-robot', global_name: 'Mr. Robot', bot: true })
    await api<ConnectionView>(ANNA, '/api/connections/discord', { body: { shared: false, values: { token: 'bot-token-123' } } })
    connectorFixtures.on('POST', `${API}/channels/C-robot/messages`, { id: 'M-out', channel_id: 'C-robot', content: '', timestamp: '2026-10-20T10:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } })
    const id = await activeRobot({ discordChannel: 'C-robot' })
    connectorFixtures.calls = []
    await asked(id)
    const posts = connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${API}/channels/C-robot/messages`).map((call) => (JSON.parse(call.body ?? '{}') as { content: string }).content)
    expect(posts).toEqual([[
      'New robot: Which one should I order?',
      'Both are in stock.',
      '1. Order the red one — Ships Friday, 129 zł',
      '2. Order the blue one',
      '3. Cancel the order',
      'Answer with a number here or answer in the app.',
    ].join('\n')])
  })

  it('writes the text form for a question that takes free words', () => {
    expect(questionText({ prompt: 'Which?', help: null, options: [], allowCustom: true, multiSelect: false, urgent: false })).toBe('Which?\nAnswer in the app, or write your own answer here.')
  })
})

describe('multi-select (dp-xz6h, dp-f8z1, dp-rys9)', () => {
  const TOPPINGS = { prompt: 'Which toppings?', options: [{ label: 'Cheese', value: 'cheese' }, { label: 'Ham', value: 'ham' }, { label: 'Olives', value: 'olives' }], multi_select: true, allow_custom: true }

  it('stores the question as multi-select and refuses one with fewer than two options', async () => {
    const id = await activeRobot()
    const ask = await asked(id, TOPPINGS)
    expect(ask.question).toMatchObject({ multiSelect: true, allowCustom: true })
    scripts.set(id, [{ calls: [{ name: 'ask', args: { prompt: 'Which?', options: [{ label: 'A', value: 'a' }], multi_select: true } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    expect(toolResults(id).at(-1)).toContain('multi_select needs at least two options')
  })

  it('answers with every chosen value in the order of the options, the owner\'s words alongside, and wakes the Robot with the list', async () => {
    const id = await activeRobot()
    const ask = await asked(id, TOPPINGS)
    expect((await answerAsk(id, ask, { approve: true, values: ['tomato'] })).status).toBe(400)
    expect((await answerAsk(id, ask, { approve: true, values: [] })).status).toBe(400)
    scripts.set(id, [{ text: '' }])
    const answered = await answerAsk(id, ask, { approve: true, values: ['olives', 'cheese'], text: 'and extra basil' })
    expect(answered.body).toMatchObject({ status: 'approved', question: { answer: { kind: 'selected', selected: [{ value: 'cheese', label: 'Cheese' }, { value: 'olives', label: 'Olives' }], text: 'and extra basil' } } })
    await settle(id)
    const wake = lastWake(id)
    expect(wake).toContain(`[Your owner answered your question ${ask.id}: \\"Cheese\\", \\"Olives\\" (values: cheese, olives), with their own words]`)
    expect(wake).toContain('cheese, olives\\nand extra basil')
  })

  it('takes several numbers on Discord from the owner; a number with no option stays a message', async () => {
    await env.MEMBER.getByName(annaId).addConnection({ kind: 'discord-user', label: 'anna', account: 'anna', services: [], shared: false, meta: { userId: 'u-anna' }, secrets: { token: 't' } })
    connectorFixtures.on('GET', `${API}/users/@me`, { id: 'B1', username: 'mr-robot', global_name: 'Mr. Robot', bot: true })
    await api<ConnectionView>(ANNA, '/api/connections/discord', { body: { shared: false, values: { token: 'bot-token-123' } } })
    connectorFixtures.on('POST', `${API}/channels/C-robot/messages`, { id: 'M-out', channel_id: 'C-robot', content: '', timestamp: '2026-10-20T10:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } })
    const id = await activeRobot({ discordChannel: 'C-robot' })
    connectorFixtures.calls = []
    const ask = await asked(id, TOPPINGS)
    const posted = connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${API}/channels/C-robot/messages`).map((call) => (JSON.parse(call.body ?? '{}') as { content: string }).content)
    expect(posted[0]).toContain('1. Cheese\n2. Ham\n3. Olives\nAnswer with one or more numbers here (for example 1, 3), write your own answer, or answer in the app.')
    scripts.set(id, [{ text: '' }])
    await env.SPACE.getByName('space').discordReceived({ id: 'M-9', channelId: 'C-robot', guildId: 'G-1', authorId: 'u-anna', authorName: 'Anna', text: '1, 7', direct: false }, annaId)
    await settle(id)
    expect((await proposals(id)).find((proposal) => proposal.id === ask.id)).toMatchObject({ status: 'open' })
    expect(lastWake(id)).toContain('1, 7')
    scripts.set(id, [{ text: '' }])
    await env.SPACE.getByName('space').discordReceived({ id: 'M-10', channelId: 'C-robot', guildId: 'G-1', authorId: 'u-anna', authorName: 'Anna', text: '3 and 1', direct: false }, annaId)
    await settle(id)
    expect((await proposals(id)).find((proposal) => proposal.id === ask.id)).toMatchObject({ status: 'approved', question: { answer: { kind: 'selected', selected: [{ value: 'cheese' }, { value: 'olives' }], text: null } } })
    expect(lastWake(id)).toContain('(values: cheese, olives)')
  })
})
