import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Me } from '@mr-robot/protocol'
import { api, stubModels } from './api.ts'
import { connectorFixtures, type RecordedCall } from './connector-fixtures.ts'
import { account, runTool, testHost } from './connector-host.ts'
import { SlackPlugin } from '../src/connectors/slack.ts'

const ANNA = 'anna@example.com'
const TEAM = account('slack', 'Acme', 'acme.slack.com', ['slack'], true)
const TOKEN = 'xoxc-1234'
const COOKIE = 'xoxd-abcd'

beforeEach(async () => {
  await reset()
  connectorFixtures.reset()
  await stubModels()
  await api(ANNA, '/api/me')
})

const setup = (accounts = [TEAM]) => {
  const test = testHost('slack', accounts, { [TEAM.id]: { token: TOKEN, cookie: COOKIE } })
  return { ...test, tools: SlackPlugin.tools(test.host) }
}
const json = (call: RecordedCall) => JSON.parse(call.body ?? 'null') as Record<string, unknown>
const last = () => connectorFixtures.calls.at(-1)!
const bodyOf = (text: string) => JSON.parse(text.split('\n').slice(1).join('\n'))

const USERS = { ok: true, members: [
  { id: 'U1', name: 'anna', real_name: 'Anna Nowak', profile: { display_name: 'Anna', email: 'anna@acme.test', title: 'Ops' } },
  { id: 'U2', name: 'ben', real_name: 'Ben Kowal', profile: { display_name: 'Ben', email: 'ben@acme.test' } },
  { id: 'U3', name: 'bot', real_name: 'Deploy Bot', is_bot: true, profile: {} },
] }
const CHANNELS = { ok: true, channels: [
  { id: 'C1', name: 'general', num_members: 12, purpose: { value: 'Company-wide announcements' }, latest: { text: 'standup at 10' } },
  { id: 'C2', name: 'finance', num_members: 4, is_private: true, purpose: { value: 'Invoices and budgets' } },
  { id: 'D1', is_im: true, user: 'U2' },
] }

describe('Slack from a pasted session (cn-3cnb, cn-clwd, cn-aljt, cn-bxmu)', () => {
  it('sends the token and the d cookie exactly as slkx does, and never puts them in the result', async () => {
    connectorFixtures.on('POST', 'https://slack.com/api/conversations.list', CHANNELS)
    connectorFixtures.on('POST', 'https://slack.com/api/client.counts', { ok: true, channels: [{ id: 'C1', has_unreads: true, unread_count_display: 3, mention_count: 1, last_read: '1.0', latest: '1791400000.000100' }], groups: [{ id: 'C2', has_unreads: true, unread_count_display: 7 }] })
    const { tools } = setup()
    const text = await runTool(tools, 'slack_list_unreads', {})
    const call = connectorFixtures.calls.find((entry) => entry.url.endsWith('/client.counts'))!
    expect(call.method).toBe('POST')
    expect(call.headers['authorization']).toBe('Bearer ' + TOKEN)
    expect(call.headers['cookie']).toBe('d=' + COOKIE)
    expect(call.headers['content-type']).toMatch(/^application\/json/)
    expect(call.body).toBe('{}')
    expect(text).toContain('[slack · Acme (acme.slack.com)] list unreads')
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(COOKIE)
    expect(bodyOf(text)).toEqual([
      { id: 'C1', channel: '#general', unread: 3, mentions: 1, lastRead: '1.0', latestAt: new Date(1791400000 * 1000).toISOString() },
      { id: 'C2', channel: '#finance', unread: 7, mentions: 0, lastRead: null },
    ])
  })

  it('lists channels and people, reads a channel with names, and reads a thread', async () => {
    connectorFixtures.on('POST', 'https://slack.com/api/conversations.list', CHANNELS)
    connectorFixtures.on('POST', 'https://slack.com/api/users.list', USERS)
    connectorFixtures.on('POST', 'https://slack.com/api/client.counts', { ok: true, channels: [{ id: 'C1', has_unreads: true, unread_count_display: 2, mention_count: 0, last_read: '1.0', latest: '1791400200.000300' }] })
    connectorFixtures.on('POST', 'https://slack.com/api/conversations.history', { ok: true, has_more: false, messages: [
      { ts: '1791400000.000100', user: 'U1', text: 'the invoice is paid' },
      { ts: '1791400100.000200', user: 'U2', text: 'thanks!', thread_ts: '1791400000.000100', reply_count: 2, reactions: [{ name: 'thumbsup', count: 1 }] },
      { ts: '1791400200.000300', bot_id: 'B1', text: 'deploy finished', files: [{ id: 'F1', name: 'log.txt', mimetype: 'text/plain' }] },
    ] })
    connectorFixtures.on('POST', 'https://slack.com/api/users.info', { ok: true, user: USERS.members[0] })
    connectorFixtures.on('POST', 'https://slack.com/api/conversations.replies', { ok: true, messages: [
      { ts: '1791400000.000100', user: 'U1', text: 'the invoice is paid' },
      { ts: '1791400100.000200', user: 'U2', text: 'thanks!', thread_ts: '1791400000.000100' },
    ] })
    const { tools } = setup()
    const channels = bodyOf(await runTool(tools, 'slack_list_user_channels', {}))
    expect(channels).toEqual([
      expect.objectContaining({ id: 'C1', channel: '#general', private: false, members: 12, latest: 'standup at 10' }),
      expect.objectContaining({ id: 'C2', channel: '#finance', private: true }),
      expect.objectContaining({ id: 'D1', channel: 'DM U2' }),
    ])
    expect(await runTool(tools, 'slack_search_channels', { query: 'invoice' })).toContain('#finance')
    expect(bodyOf(await runTool(tools, 'slack_search_users', { query: 'ben@acme.test' }))).toEqual([expect.objectContaining({ id: 'U2', name: 'Ben', email: 'ben@acme.test', bot: false })])
    expect(bodyOf(await runTool(tools, 'slack_read_user_profile', { user: 'U1' }))).toMatchObject({ id: 'U1', username: 'anna', title: 'Ops', email: 'anna@acme.test' })
    const channel = bodyOf(await runTool(tools, 'slack_read_channel', { channel: 'C1', limit: 10 }))
    expect(json(connectorFixtures.calls.find((call) => call.url.endsWith('/conversations.history'))!)).toEqual({ channel: 'C1', limit: 10 })
    expect(channel.messages[0]).toEqual({ ts: '1791400000.000100', at: new Date(1791400000 * 1000).toISOString(), from: 'Anna', text: 'the invoice is paid' })
    expect(channel.messages[1]).toMatchObject({ from: 'Ben', inThread: '1791400000.000100', replies: 2, reactions: [':thumbsup: 1'] })
    expect(channel.messages[2]).toMatchObject({ from: 'bot B1', files: [{ id: 'F1', name: 'log.txt', type: 'text/plain' }] })
    const thread = bodyOf(await runTool(tools, 'slack_read_thread', { channel: 'C1', threadTs: '1791400000.000100' }))
    expect(thread.messages.map((message: { from: string }) => message.from)).toEqual(['Anna', 'Ben'])
  })

  it('searches messages and finds a person by id or name', async () => {
    connectorFixtures.on('POST', 'https://slack.com/api/search.messages', { ok: true, messages: { total: 1, matches: [{ text: 'invoice 10/2026', ts: '1791400000.000100', channel: { id: 'C2', name: 'finance' }, username: 'anna', permalink: 'https://acme.slack.com/archives/C2/p1791400000000100' }] } })
    const { tools } = setup()
    const found = bodyOf(await runTool(tools, 'slack_search_public_and_private', { query: 'invoice', max: 5 }))
    expect(json(last())).toEqual({ query: 'invoice', count: 5, sort: 'timestamp' })
    expect(found).toEqual({ total: 1, matches: [{ text: 'invoice 10/2026', channel: 'finance', from: 'anna', at: new Date(1791400000 * 1000).toISOString(), link: 'https://acme.slack.com/archives/C2/p1791400000000100' }] })
  })

  it('write tools exist only with the write grant: send, reply in a thread, mark read', async () => {
    const reader = account('slack', 'Acme', 'acme.slack.com', ['slack'], false)
    expect(setup([reader]).tools.map((tool) => tool.name).filter((name) => /send|mark_read/.test(name))).toEqual([])
    connectorFixtures.on('POST', 'https://slack.com/api/chat.postMessage', { ok: true, channel: 'C1', ts: '1791400300.000400' })
    connectorFixtures.on('POST', 'https://slack.com/api/client.counts', { ok: true, channels: [{ id: 'C1', latest: '1791400200.000300' }] })
    connectorFixtures.on('POST', 'https://slack.com/api/conversations.mark', { ok: true })
    const { tools } = setup()
    expect(bodyOf(await runTool(tools, 'slack_send_message', { channel: 'C1', text: 'deploy done' }))).toEqual({ sent: true, channel: 'C1', ts: '1791400300.000400' })
    expect(json(last())).toEqual({ channel: 'C1', text: 'deploy done', unfurl_links: false })
    await runTool(tools, 'slack_send_message', { channel: 'C1', text: 'ack', threadTs: '1791400000.000100' })
    expect(json(last())).toEqual({ channel: 'C1', text: 'ack', thread_ts: '1791400000.000100', unfurl_links: false })
    expect(bodyOf(await runTool(tools, 'slack_mark_read', { channel: 'C1' }))).toEqual({ marked: true, channel: 'C1', ts: '1791400200.000300' })
    expect(json(last())).toEqual({ channel: 'C1', ts: '1791400200.000300' })
  })

  it('a refused session is reported in the result and marks the connection "paste again" (cn-bxmu)', async () => {
    connectorFixtures.on('POST', 'https://slack.com/api/client.counts', { ok: false, error: 'invalid_auth' })
    const { tools, statuses } = setup()
    const text = await runTool(tools, 'slack_list_unreads', {})
    expect(text).toContain("Failed: the account's credentials were refused: Slack says invalid_auth")
    expect(text).toContain('The owner sees this on the connection\'s row')
    expect(statuses).toEqual([{ id: TEAM.id, status: 'rejected', note: 'Slack says invalid_auth' }])
  })

  it('a non-auth failure reads as its own message, not as a broken session', async () => {
    connectorFixtures.on('POST', 'https://slack.com/api/conversations.history', { ok: false, error: 'channel_not_found' })
    const { tools, statuses } = setup()
    const text = await runTool(tools, 'slack_read_channel', { channel: 'C9' })
    expect(text).toContain('Failed: Slack refused conversations.history: channel_not_found')
    expect(statuses).toEqual([])
  })
})

describe('connecting Slack by pasting (cn-3cnb)', () => {
  it('checks the values with auth.test, then stores the workspace', async () => {
    connectorFixtures.on('POST', 'https://slack.com/api/auth.test', { ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'anna', team_id: 'T1', user_id: 'U1' })
    const saved = await api<ConnectionView>(ANNA, '/api/connections/slack', { body: { shared: false, values: { token: TOKEN, cookie: COOKIE } } })
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ kind: 'slack', label: 'Acme', account: 'acme.slack.com', status: 'connected', services: [] })
    expect(JSON.stringify(saved.body)).not.toContain(TOKEN)
    const probe = connectorFixtures.calls.find((call) => call.url.endsWith('/auth.test'))!
    expect(probe.headers['cookie']).toBe('d=' + COOKIE)
    const me = (await api<Me>(ANNA, '/api/me')).body
    expect((await env.MEMBER.getByName(me.id).useConnection(saved.body.id))!.secrets).toEqual({ token: TOKEN, cookie: COOKIE })
    // A wrong paste is refused before anything is stored.
    connectorFixtures.on('POST', 'https://slack.com/api/auth.test', { ok: false, error: 'invalid_auth' })
    const refused = await api<{ error: string }>(ANNA, '/api/connections/slack', { body: { shared: false, values: { token: 'xoxc-nope', cookie: COOKIE } } })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe('the pasted values were refused: Slack says invalid_auth')
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toHaveLength(1)
  })

  it('requires both values', async () => {
    const missing = await api<{ error: string }>(ANNA, '/api/connections/slack', { body: { shared: false, values: { token: TOKEN } } })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain('Cookie d (xoxd-…) is required')
  })
})
