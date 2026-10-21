/**
 * Drafts (v1.17 ticket 03): a send tool's call at ask is an Ask the view shows as the message it would send; the owner edits it and Send
 * sends exactly that, Discard rejects it with a reason the Robot reads; draft: true asks at allow; e-mail goes as HTML with a text part.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Conversation, Me, ProposalView, RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { connectorFixtures } from './connector-fixtures.ts'
import { decodeRaw } from './connector-host.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const DISCORD = 'https://discord.com/api/v10'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  connectorFixtures.reset()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

const google = () => env.MEMBER.getByName(annaId).addConnection({ kind: 'google', label: 'Private', account: 'anna@gmail.test', services: ['gmail'], shared: false, meta: { expiresAt: Date.now() + 3_600_000 }, secrets: { accessToken: 'a', refreshToken: 'r' } })

async function mailRobot(write: 'allow' | 'ask', settings: Record<string, unknown> = {}): Promise<{ id: string; connection: string }> {
  const mail = await google()
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow' }, connections: { [mail.id]: 'allow', [`${mail.id}:write`]: write } }, ...settings } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return { id: body.id, connection: mail.id }
}

const SEND = { to: ['ben@example.com'], subject: 'Dinner', body: 'Hi Ben,\n\nDinner is at **seven**.\n\n- bring wine', attachments: ['notes/menu.md'] }

async function drafted(id: string, args: Record<string, unknown>): Promise<ProposalView> {
  scripts.set(id, [{ calls: [{ name: 'gmail_send', args }] }, { calls: [{ name: 'say', args: { text: 'A draft waits for you.' } }] }, { text: '' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'write to Ben about dinner' } })
  await settle(id)
  const ask = (await asks(id)).at(-1)
  if (ask === undefined) throw new Error('no Ask')
  return ask
}

const asks = async (id: string): Promise<ProposalView[]> => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'proposal' && item.proposal.kind === 'tool-call' ? [item.proposal] : []))
const sends = () => connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${GMAIL}/messages/send`)
const lastWake = (id: string) => JSON.stringify(requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'user').at(-1))

/** The decoded text of one part of a MIME message, by content type. */
function part(mime: string, type: string): string {
  const start = mime.indexOf(`Content-Type: ${type}`)
  if (start === -1) return ''
  const body = mime.slice(start).split('\r\n\r\n')[1]!.split('\r\n--')[0]!.replace(/\r\n/g, '')
  return new TextDecoder().decode(Uint8Array.from(atob(body), (char) => char.charCodeAt(0)))
}

describe('a send tool at ask is a draft (dp-si4p, dp-wd2q, dp-qbt7, dp-ky1h)', () => {
  it('shows recipients, subject, body and attachments; Send sends the edited text as HTML with a plain-text part', async () => {
    const { id, connection } = await mailRobot('ask')
    await env.ROBOT.getByName(id).saveFile('notes/menu.md', '# Menu')
    connectorFixtures.on('POST', `${GMAIL}/messages/send`, { id: 'm-1', threadId: 't-1' })
    const ask = await drafted(id, { ...SEND, reason: 'Ben asked when dinner is' })
    expect(ask.toolCall!.draft).toEqual({
      medium: 'email', recipients: [{ label: 'To', value: 'ben@example.com' }], subject: 'Dinner', body: SEND.body, attachments: ['notes/menu.md'], revisions: [],
    })
    expect(ask.toolCall!.alwaysAllow).toEqual([{ kind: 'connection', name: `${connection}:write` }])
    expect(sends()).toEqual([])

    const edited = await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${ask.id}/draft`, { method: 'PATCH', body: { revision: ask.revision, body: 'Hi Ben,\n\nDinner is at **eight**.', subject: 'Dinner tonight' } })
    expect(edited.status).toBe(200)
    expect(edited.body.revision).toBe(ask.revision + 1)
    expect(edited.body.toolCall!.draft).toMatchObject({ subject: 'Dinner tonight', body: 'Hi Ben,\n\nDinner is at **eight**.', revisions: [{ seq: 1, by: 'robot', subject: 'Dinner' }, { seq: 2, by: 'owner', subject: 'Dinner tonight' }] })
    // Send of the version the owner no longer sees is stale.
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, approve: true } })).status).toBe(409)

    scripts.set(id, [{ text: '' }])
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: edited.body.revision, approve: true } })).status).toBe(200)
    await settle(id)
    expect(sends()).toHaveLength(1)
    const mime = decodeRaw((JSON.parse(sends()[0]!.body ?? '{}') as { raw: string }).raw)
    expect(mime).toContain('Subject: Dinner tonight')
    expect(mime).toContain('Content-Type: multipart/alternative')
    expect(part(mime, 'text/plain')).toBe('Hi Ben,\n\nDinner is at **eight**.')
    expect(part(mime, 'text/html')).toContain('<strong>eight</strong>')
    expect(mime).toContain('filename="menu.md"')
    expect(lastWake(id)).toContain(`[Your owner approved gmail_send (${ask.id})]`)
    expect(lastWake(id)).toContain('Your owner edited the message before it went')
  })

  it('Discard rejects with the reason the Robot reads, and nothing is sent (dp-gsf8)', async () => {
    const { id } = await mailRobot('ask')
    const ask = await drafted(id, { to: ['ben@example.com'], subject: 'Dinner', body: 'Hi', reason: 'Ben asked' })
    scripts.set(id, [{ text: '' }])
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, approve: false, note: 'I will call him instead' } })).status).toBe(200)
    await settle(id)
    expect(sends()).toEqual([])
    expect(lastWake(id)).toContain(`[Your owner rejected gmail_send (${ask.id}): I will call him instead]`)
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask.id}/draft`, { method: 'PATCH', body: { revision: ask.revision, body: 'late' } })).status).toBe(409)
  })

  it('draft: true asks even when the Robot may send on its own (dp-yhn7)', async () => {
    const { id } = await mailRobot('allow')
    connectorFixtures.on('POST', `${GMAIL}/messages/send`, { id: 'm-1', threadId: 't-1' })
    const schema = async () => requests.get(id)!.at(-1)!.tools?.find((tool) => tool.name === 'gmail_send')?.parameters as { properties: Record<string, unknown> }
    const ask = await drafted(id, { to: ['ben@example.com'], subject: 'Dinner', body: 'Hi', draft: true })
    expect((await schema()).properties).toHaveProperty('draft')
    expect(ask).toMatchObject({ status: 'open', toolCall: { tool: 'gmail_send', alwaysAllow: null, draft: { subject: 'Dinner', body: 'Hi' } } })
    expect(ask.toolCall!.arguments.map((argument) => argument.name)).not.toContain('draft')
    expect(sends()).toEqual([])
    // Without draft the same call goes at once.
    scripts.set(id, [{ calls: [{ name: 'gmail_send', args: { to: ['ben@example.com'], subject: 'Dinner', body: 'Hi' } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'just send it' } })
    await settle(id)
    expect(sends()).toHaveLength(1)
  })

  it('reaches Discord as text with a link into the app (dp-1tk6)', async () => {
    connectorFixtures.on('GET', `${DISCORD}/users/@me`, { id: 'B1', username: 'mr-robot', global_name: 'Mr. Robot', bot: true })
    await api<ConnectionView>(ANNA, '/api/connections/discord', { body: { shared: false, values: { token: 'bot-token-123' } } })
    connectorFixtures.on('POST', `${DISCORD}/channels/C-robot/messages`, { id: 'M-out', channel_id: 'C-robot', content: '', timestamp: '2026-10-20T10:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } })
    const { id } = await mailRobot('ask', { discordChannel: 'C-robot' })
    connectorFixtures.calls = []
    await drafted(id, { to: ['ben@example.com'], subject: 'Dinner', body: 'Hi Ben,\nseven works.', reason: 'Ben asked' })
    const posts = connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${DISCORD}/channels/C-robot/messages`).map((call) => (JSON.parse(call.body ?? '{}') as { content: string }).content)
    const card = posts.find((text) => text.includes('wrote a draft'))!
    expect(card).toContain('wrote a draft for you to check "Dinner" (To: ben@example.com).')
    expect(card).toContain('Hi Ben,\nseven works.')
    expect(card).toContain('Open the Conversation to send or discard it')
  })

  it('draft_revise replaces the body and subject of the open draft; the view carries both versions (dp-5ixt, dp-o3st)', async () => {
    const { id } = await mailRobot('ask')
    const ask = await drafted(id, { ...SEND, attachments: [], reason: 'Ben asked' })
    scripts.set(id, [{ calls: [{ name: 'draft_revise', args: { ask_id: ask.id, body: 'Dinner at seven.', subject: 'Dinner at 7' } }, { name: 'draft_revise', args: { ask_id: 'p-nope', body: 'x' } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'shorter, and put the time in the subject' } })
    await settle(id)
    const results = requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-2).map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
    expect(JSON.parse(results[0]!)).toMatchObject({ askId: ask.id, version: 2, status: 'waiting' })
    expect(results[1]).toContain('is not one of your drafts')
    const revised = (await asks(id)).find((entry) => entry.id === ask.id)!
    expect(revised.revision).toBe(ask.revision + 1)
    expect(revised.toolCall!.draft).toMatchObject({
      subject: 'Dinner at 7', body: 'Dinner at seven.',
      revisions: [{ seq: 1, by: 'robot', subject: 'Dinner', body: SEND.body }, { seq: 2, by: 'robot', subject: 'Dinner at 7', body: 'Dinner at seven.' }],
    })
    // Send sends the revised text.
    connectorFixtures.on('POST', `${GMAIL}/messages/send`, { id: 'm-1', threadId: 't-1' })
    scripts.set(id, [{ text: '' }])
    await api(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: revised.revision, approve: true } })
    await settle(id)
    expect(decodeRaw((JSON.parse(sends()[0]!.body ?? '{}') as { raw: string }).raw)).toContain('Subject: Dinner at 7')
  })

  it('"This Robot sends on its own" raises the write grant to allow and sends; the grants lower it back (dp-ef0p, dp-fjh7)', async () => {
    const { id, connection } = await mailRobot('ask')
    connectorFixtures.on('POST', `${GMAIL}/messages/send`, { id: 'm-1', threadId: 't-1' })
    const ask = await drafted(id, { to: ['ben@example.com'], subject: 'Dinner', body: 'Hi', reason: 'Ben asked' })
    const edited = (await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${ask.id}/draft`, { method: 'PATCH', body: { revision: ask.revision, body: 'Hi Ben' } })).body
    scripts.set(id, [{ text: '' }])
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask.id}/always-allow`, { body: { revision: edited.revision } })).status).toBe(200)
    await settle(id)
    expect(part(decodeRaw((JSON.parse(sends()[0]!.body ?? '{}') as { raw: string }).raw), 'text/plain')).toBe('Hi Ben')
    const grants = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.grants
    expect(grants.connections[`${connection}:write`]).toBe('allow')
    // From now on it sends without a card...
    await drafted(id, { to: ['ben@example.com'], subject: 'Again', body: 'Hi' }).catch(() => undefined)
    expect(sends()).toHaveLength(2)
    // ...until the owner lowers the grant again.
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { ...grants, connections: { ...grants.connections, [`${connection}:write`]: 'ask' } } } })
    const again = await drafted(id, { to: ['ben@example.com'], subject: 'Third', body: 'Hi', reason: 'Ben asked' })
    expect(again).toMatchObject({ status: 'open', toolCall: { draft: { subject: 'Third' } } })
    expect(sends()).toHaveLength(2)
  })

  it('keeps an Ask of a send tool stored before v1.17 as it was (dp-f0pp)', async () => {
    const { id } = await mailRobot('ask')
    const [askId] = await testRobot(id).legacyToolAsksForTest([{ tool: 'gmail_send', arguments: { to: ['ben@example.com'], subject: 'Old', body: 'Hi' }, reason: 'Ben asked' }])
    const old = (await asks(id)).find((ask) => ask.id === askId)!
    expect(old.toolCall).toMatchObject({ tool: 'gmail_send', draft: null, arguments: expect.arrayContaining([{ name: 'subject', value: 'Old' }]) })
    expect((await api(ANNA, `/api/robots/${id}/proposals/${askId}/draft`, { method: 'PATCH', body: { revision: old.revision, body: 'x' } })).status).toBe(400)
  })
})
