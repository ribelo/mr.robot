/**
 * request_credential (v1.15 ticket 05, gb-3192...): a Robot asks for a login or a secret; the owner fills the form in its Conversation; saving
 * creates the entry under the owner, grants it to the Robot and wakes it with the name. The password never reaches the Robot.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Conversation, LoginView, Me, ProposalView, RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { connectorFixtures } from './connector-fixtures.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const API = 'https://discord.com/api/v10'
const PASSWORD = 'correct-horse-battery-staple'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  connectorFixtures.reset()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

const REQUEST = { kind: 'login', service: 'mBank', why: 'To read the statements for the VAT return.', websites: ['online.mbank.pl'], scope: 'read statements, never pay' }

async function activeRobot(settings: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['secrets'], skills: [], recipients: [], secrets: [] }, ...settings } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const proposals = async (id: string): Promise<ProposalView[]> => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'proposal' ? [item.proposal] : []))
/** The results of the last n tool calls of the last request. */
const lastResults = (id: string, n: number) => toolResults(id).slice(-n)
const lastWake = (id: string) => JSON.stringify(requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'user').at(-1))

async function requested(id: string, args: Record<string, unknown> = REQUEST): Promise<ProposalView> {
  scripts.set(id, [{ calls: [{ name: 'request_credential', args }] }, { calls: [{ name: 'say', args: { text: 'I need a login for that. I asked you.' } }] }, { text: '' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'get the bank statements' } })
  await settle(id)
  const ask = (await proposals(id)).filter((proposal) => proposal.kind === 'credential').at(-1)
  if (ask === undefined) throw new Error(`no credential Ask; the tool said ${toolResults(id)[0]}`)
  return ask
}

const save = (id: string, ask: ProposalView, entry: Record<string, unknown> = {}) => api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${ask.id}/credential`, {
  body: { revision: ask.revision, name: 'mbank', username: 'anna', password: PASSWORD, websites: ['online.mbank.pl'], notes: 'Allowed: read statements, never pay', allowRead: false, shared: false, ...entry },
})

describe('request_credential stores an Ask and returns at once (gb-3192)', () => {
  it('stores the login request with what the Robot gave and the owner sees nothing to approve but the form', async () => {
    const id = await activeRobot()
    const ask = await requested(id)
    expect(ask).toMatchObject({ status: 'open', purpose: 'mBank: login', credential: { credential: 'login', service: 'mBank', why: REQUEST.why, websites: ['online.mbank.pl'], scope: 'read statements, never pay', entry: null, declined: false } })
    expect(JSON.parse(lastResults(id, 2)[0]!)).toMatchObject({ askId: ask.id, status: 'waiting' })
    const secret = await requested(id, { kind: 'secret', service: 'OpenAI API', why: 'To summarise documents.' })
    expect(secret.credential).toMatchObject({ credential: 'secret', service: 'OpenAI API', websites: [], scope: null })
  })

  it('needs a service and a reason', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ calls: [{ name: 'request_credential', args: { ...REQUEST, why: '  ' } }, { name: 'request_credential', args: { kind: 'card', service: 'x', why: 'y' } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    expect(lastResults(id, 2)[0]).toContain('"why" is required')
    expect(lastResults(id, 2)[1]).toContain('kind is login or secret')
    expect(await proposals(id)).toEqual([])
  })
})

describe('saving the form (gb-923q, gb-196l)', () => {
  it('creates the entry under the owner, grants it to the Robot at allow and wakes it with the name; the password stays out of everything the Robot sees', async () => {
    const id = await activeRobot()
    const ask = await requested(id)
    scripts.set(id, [{ calls: [{ name: 'secret_get', args: { name: 'mbank' } }, { name: 'login_list', args: {} }] }, { calls: [{ name: 'say', args: { text: 'Got it.' } }] }, { text: '' }])
    const saved = await save(id, ask)
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ id: ask.id, status: 'approved', credential: { entry: 'mbank', declined: false } })
    await settle(id)

    const logins = (await api<LoginView[]>(ANNA, '/api/secrets')).body
    expect(logins).toEqual([expect.objectContaining({ name: 'mbank', username: 'anna', websites: ['online.mbank.pl'], allowRead: false, scope: 'member', mine: true, robots: [expect.any(String)] })])
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.grants.secrets).toEqual({ mbank: 'allow' })
    expect(lastWake(id)).not.toContain(PASSWORD)
    expect(JSON.stringify(requests.get(id))).toContain(`[Your owner saved the login or secret you asked for (${ask.id}): its name is mbank]`)
    expect(JSON.stringify(requests.get(id))).toContain('Use it with login_fill on its login page')

    // A login is filled into the page, never read: the program cannot get the password.
    const [read, listed] = lastResults(id, 3)
    expect(read).toContain('is a website login: use login_fill')
    expect(listed).toContain('mbank')
    expect(JSON.stringify(requests.get(id))).not.toContain(PASSWORD)
    expect(JSON.stringify(await env.ROBOT.getByName(id).trajectory())).not.toContain(PASSWORD)
    expect(JSON.stringify((await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body)).not.toContain(PASSWORD)
    expect((await proposals(id)).find((proposal) => proposal.id === ask.id)).toMatchObject({ status: 'approved', credential: { entry: 'mbank' } })
  })

  it('a secret is readable by the Robot that asked for it', async () => {
    const id = await activeRobot()
    const ask = await requested(id, { kind: 'secret', service: 'OpenAI API', why: 'To summarise documents.' })
    scripts.set(id, [{ calls: [{ name: 'secret_get', args: { name: 'openai-api' } }] }, { text: '' }])
    expect((await save(id, ask, { name: 'openai-api', username: '', websites: [], allowRead: true, notes: '' })).status).toBe(200)
    await settle(id)
    expect(lastResults(id, 1)[0]).toBe(PASSWORD)
  })

  it('refuses a name already used, a bad name and an empty password, and a second answer; the Ask stays open until it is saved', async () => {
    const id = await activeRobot()
    const ask = await requested(id)
    expect((await save(id, ask, { name: 'has spaces' })).status).toBe(400)
    expect((await save(id, ask, { password: '' })).status).toBe(400)
    expect((await save(id, ask, { revision: ask.revision + 1 })).status).toBe(409)
    expect((await proposals(id)).find((proposal) => proposal.id === ask.id)).toMatchObject({ status: 'open' })
    await api(ANNA, '/api/secrets/taken', { method: 'PUT', body: { username: '', password: 'x', websites: [], notes: '', allowRead: true, shared: false } })
    const taken = await save(id, ask, { name: 'taken' })
    expect(taken.status).toBe(409)
    expect(JSON.stringify(taken.body)).toContain('already have a login named')
    expect((await save(id, ask)).status).toBe(200)
    expect((await save(id, ask, { name: 'again' })).status).toBe(409)
  })

  it("only the Robot's owner saves it", async () => {
    const id = await activeRobot()
    const ask = await requested(id)
    await api('ben@example.com', '/api/me')
    expect((await api('ben@example.com', `/api/robots/${id}/proposals/${ask.id}/credential`, { body: { revision: ask.revision, name: 'x', username: '', password: 'p', websites: [], notes: '', allowRead: false, shared: false } })).status).toBeGreaterThanOrEqual(403)
  })
})

describe('declining (gb-7dl9)', () => {
  it('wakes the Robot with the refusal and leaves no entry', async () => {
    const id = await activeRobot()
    const ask = await requested(id)
    scripts.set(id, [{ text: '' }])
    const declined = await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, approve: false } })
    expect(declined.body).toMatchObject({ status: 'rejected', credential: { declined: true, entry: null } })
    await settle(id)
    expect(JSON.stringify(requests.get(id))).toContain(`[Your owner declined your request for a login or secret (${ask.id})]`)
    expect(lastWake(id)).toContain('does not want to give you access to mBank')
    expect((await api<LoginView[]>(ANNA, '/api/secrets')).body).toEqual([])
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, approve: false } })).status).toBe(409)
  })

  it('approve without the form is refused', async () => {
    const id = await activeRobot()
    const ask = await requested(id)
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, approve: true } })).status).toBe(400)
  })
})

describe('Discord (gb-atqq)', () => {
  it('shows one line and a link into the app', async () => {
    connectorFixtures.on('GET', `${API}/users/@me`, { id: 'B1', username: 'mr-robot', global_name: 'Mr. Robot', bot: true })
    await api<ConnectionView>(ANNA, '/api/connections/discord', { body: { shared: false, values: { token: 'bot-token-123' } } })
    connectorFixtures.on('POST', `${API}/channels/C-robot/messages`, { id: 'M-out', channel_id: 'C-robot', content: '', timestamp: '2026-10-20T10:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } })
    const id = await activeRobot({ discordChannel: 'C-robot' })
    connectorFixtures.calls = []
    await requested(id)
    const posts = connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${API}/channels/C-robot/messages`).map((call) => (JSON.parse(call.body ?? '{}') as { content: string }).content)
    expect(posts).toEqual([`New robot: asks you for a login for mBank: To read the statements for the VAT return.. Open the Conversation to fill it in (https://mr-robot.test/#/r/${id}).`])
    void annaId
  })
})
