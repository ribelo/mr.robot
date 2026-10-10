/**
 * need_help (v1.11 ticket 06): a Robot asks its owner for help with one structured call, the owner answers in text,
 * and the answer wakes the Robot with a label. Free messaging to Mr. Robot still needs a recipient Grant.
 */
import { env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me, ProposalView, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import { delivered, type Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const realFetch = globalThis.fetch

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  delivered.clear()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    return url.startsWith('https://push.example/') ? new Response(null, { status: 201 }) : realFetch(input, init)
  }) as typeof fetch
  await stubModels()
  await api(ANNA, '/api/me', { headers: { 'X-Time-Zone': 'Europe/Warsaw' } })
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const mrRobotId = async () => (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id

async function newRobot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  return body.id
}

async function activeRobot(): Promise<string> {
  const id = await newRobot()
  await testRobot(id).activateForTest()
  return id
}

const REQUEST = { doing: 'Filing the VAT return', tried: 'Looked in the shared folder and in my notes', need: 'The VAT number of the new company', urgent: false }
const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const questions = async (id: string): Promise<ProposalView[]> => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'question' ? [item.proposal] : []))

async function ask(id: string, args: Record<string, unknown> = REQUEST): Promise<ProposalView> {
  scripts.set(id, [{ calls: [{ name: 'need_help', args }] }, { text: 'Waiting for your answer.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'file the return' } })
  await settle(id)
  const open = (await questions(id)).find((proposal) => proposal.kind === 'help')
  if (open === undefined) throw new Error('no help Ask')
  return open
}

describe('need_help (sk-kf74, sk-fcr1, sk-jpyv, sk-81hw)', () => {
  it('stores a help Ask and tells the Robot to end its Turn, with no Grant at all (sk-kf74, sk-81hw)', async () => {
    const id = await activeRobot()
    const before = Date.now()
    const proposal = await ask(id, { ...REQUEST, urgent: true })
    expect(proposal).toMatchObject({ kind: 'help', status: 'open', purpose: REQUEST.need, help: { ...REQUEST, urgent: true, answeredBy: 'none', answer: null } })
    expect(proposal.help!.created).toBeGreaterThanOrEqual(before)

    const [result] = toolResults(id)
    expect(JSON.parse(result!)).toEqual({ requestId: proposal.id, status: expect.stringContaining('end your Turn with one short line') })
    expect(JSON.parse(result!).status).toContain('you will be woken with the answer')
    // The Robot has no Grants, yet it has the tool; the owner sees the Robot as waiting for them.
    expect(requests.get(id)!.at(-1)!.tools!.map((tool) => tool.name)).toContain('need_help')
    expect((await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.id === id)!.fleetState).toBe('waiting for you')
  })

  it('asks every part of the request before it stores anything (sk-kf74)', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ calls: [{ name: 'need_help', args: { ...REQUEST, tried: '   ' } }] }, { text: 'Oops.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    expect(toolResults(id)[0]).toContain('parameter "tried" is required and must not be empty')
    expect(await questions(id)).toEqual([])
  })

  it('is absent for Mr. Robot and while the Robot is in setup (sk-kf74)', async () => {
    const mr = await mrRobotId()
    await settle(mr)
    expect(await env.ROBOT.getByName(mr).toolNames()).not.toContain('need_help')

    const id = await newRobot()
    expect(await env.ROBOT.getByName(id).toolNames()).not.toContain('need_help')
    await testRobot(id).activateForTest()
    expect(await env.ROBOT.getByName(id).toolNames()).toContain('need_help')
  })

  it('pushes "needs you" to the owner when the Robot asks (sk-fcr1)', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    await api(ANNA, '/api/push/subscriptions', { body: { endpoint: 'https://push.example/phone', keys: { p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) }, device: 'phone' } })
    const id = await activeRobot()
    delivered.clear()
    await ask(id)
    const me = (await api<Me>(ANNA, '/api/me')).body
    const sent = await (env.MEMBER.getByName(me.id) as unknown as DurableObjectStub<TestMember>).deliveredForTest()
    expect(sent.find((notification) => notification.title.endsWith('needs you'))).toMatchObject({ body: `asks for help: ${REQUEST.need}`, url: `/#/r/${id}` })
  })

  it("the owner's text answer closes the request and wakes the Robot with a label; a second answer is refused (sk-fcr1, sk-jpyv)", async () => {
    const id = await activeRobot()
    const proposal = await ask(id)
    const owner = (await api<Me>(ANNA, '/api/me')).body.name

    scripts.set(id, [{ text: 'Thanks, continuing.' }])
    const answered = await api<ProposalView>(ANNA, `/api/robots/${id}/help/${proposal.id}`, { body: { text: 'It is PL 123-45-67-890.' } })
    expect(answered.status).toBe(200)
    expect(answered.body).toMatchObject({ id: proposal.id, status: 'done', help: { answeredBy: 'owner', answer: 'It is PL 123-45-67-890.' } })
    await settle(id)
    const wake = JSON.stringify(requests.get(id)!.at(-1)!.messages.at(-1))
    expect(wake).toContain(`[Answer to your request ${proposal.id} from ${owner}]`)
    expect(wake).toContain('It is PL 123-45-67-890.')

    // The Conversation keeps the exchange and the request is no longer open.
    expect((await questions(id)).find((item) => item.id === proposal.id)).toMatchObject({ status: 'done', help: { answer: 'It is PL 123-45-67-890.' } })
    expect((await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.id === id)!.fleetState).toBe('sleeping')

    const again = await api<{ error?: string; message?: string }>(ANNA, `/api/robots/${id}/help/${proposal.id}`, { body: { text: 'Never mind, use the old one.' } })
    expect(again.status).toBe(409)
    expect(JSON.stringify(again.body)).toContain('already answered')
    await settle(id)
    expect(JSON.stringify(requests.get(id)!.at(-1))).not.toContain('use the old one')
  })

  it('refuses an empty answer and an unknown request, and leaves the request open (sk-fcr1)', async () => {
    const id = await activeRobot()
    const proposal = await ask(id)
    expect((await api(ANNA, `/api/robots/${id}/help/${proposal.id}`, { body: { text: '' } })).status).toBe(400)
    expect((await api(ANNA, `/api/robots/${id}/help/${proposal.id}`, { body: { text: '   ' } })).status).toBe(400)
    expect((await api(ANNA, `/api/robots/${id}/help/nope`, { body: { text: 'hello' } })).status).toBe(404)
    expect((await questions(id)).find((item) => item.id === proposal.id)).toMatchObject({ status: 'open' })
  })

  it('only the owner answers (sk-fcr1)', async () => {
    const id = await activeRobot()
    const proposal = await ask(id)
    await api('ben@example.com', '/api/me')
    expect((await api('ben@example.com', `/api/robots/${id}/help/${proposal.id}`, { body: { text: 'hi' } })).status).toBeGreaterThanOrEqual(403)
  })

  it('does not change what robot_send to Mr. Robot needs: a recipient Grant (sk-81hw)', async () => {
    const id = await newRobot()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: ['messaging'], skills: [], recipients: [], secrets: [] } } })
    await testRobot(id).activateForTest()
    const mr = await mrRobotId()
    scripts.set(id, [{ calls: [{ name: 'robot_send', args: { to: mr, request: 'Please help me', idempotency_key: 'k1' } }] }, { calls: [{ name: 'need_help', args: REQUEST }] }, { text: 'Asked my owner.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    const [refused, asked] = toolResults(id)
    expect(refused).toContain(`no Grant to message ${mr}`)
    expect(JSON.parse(asked!)).toMatchObject({ requestId: expect.any(String) })
  })
})
