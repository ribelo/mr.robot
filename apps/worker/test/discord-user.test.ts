import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Me, SettingsCatalog } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import { connectorFixtures, type RecordedCall } from './connector-fixtures.ts'
import { account, bodyOf, runTool, testHost } from './connector-host.ts'
import { DiscordUserPlugin } from '../src/connectors/discord-user.ts'

// v1.12 ticket 09: Discord as you, a user token on Discord's REST API (ux-urf8, ux-l2ul, ux-cbo3).
const ANNA = 'anna@example.com'
const API = 'https://discord.com/api/v9'
const TOKEN = 'user-token-123'
const ME = { id: '111', username: 'anna_n', global_name: 'Anna' }
const BEN = { id: '222', username: 'ben', global_name: 'Ben' }
const PERSON = account('discord-user', 'Anna', 'anna_n', [], true)
let annaId = ''

beforeEach(async () => {
  await reset()
  connectorFixtures.reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

// Discord's web app keeps the token as a JSON string: a pasted copy with its quotes still works.
const setup = (accounts = [PERSON]) => {
  const test = testHost('discord-user', accounts, { [PERSON.id]: { token: '"' + TOKEN + '"' } })
  return { ...test, tools: DiscordUserPlugin.tools(test.host) }
}
const json = (call: RecordedCall) => JSON.parse(call.body ?? 'null') as unknown
const last = () => connectorFixtures.calls.at(-1)!
const message = (id: string, content: string, author = BEN, extra: Record<string, unknown> = {}) => ({ id, channel_id: 'C1', content, timestamp: '2026-10-14T09:00:00.000Z', author, ...extra })
const READ_TOOLS = ['discord_list_user_guilds', 'discord_list_user_channels', 'discord_read_channel', 'discord_read_thread', 'discord_search_messages', 'discord_search_users', 'discord_read_user_profile']
const WRITE_TOOLS = ['discord_send_message_as_user', 'discord_reply_as_user', 'discord_add_reaction', 'discord_mark_read']

describe('Discord as you: read tools (ux-urf8)', () => {
  it('sends the bare user token, lists servers, direct messages newest first and a server\'s channels', async () => {
    connectorFixtures.on('GET', API + '/users/@me/guilds', [{ id: 'G1', name: 'Makers', owner: true }, { id: 'G2', name: 'Games' }])
    // 175928847299117063 is the example id of Discord's API reference: 2016-04-30T11:18:25.796Z.
    connectorFixtures.on('GET', API + '/users/@me/channels', [
      { id: 'D1', type: 1, last_message_id: '1000', recipients: [BEN] },
      { id: 'D2', type: 1, last_message_id: '175928847299117063', recipients: [{ id: '333', username: 'cleo' }] },
      { id: 'D3', type: 3, name: null, last_message_id: null, recipients: [BEN, { id: '333', username: 'cleo' }] },
    ])
    connectorFixtures.on('GET', API + '/guilds/G1/channels', [
      { id: 'K1', type: 4, name: 'Work', position: 0 },
      { id: 'C2', type: 0, name: 'random', position: 2, parent_id: 'K1' },
      { id: 'C1', type: 0, name: 'general', position: 1, parent_id: 'K1', topic: 'All hands' },
      { id: 'V1', type: 2, name: 'Lounge', position: 3, parent_id: null },
      { id: 'S1', type: 13, name: 'Stage', position: 4 },
    ])
    const { tools } = setup()
    expect(tools.map((tool) => tool.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
    const guilds = await runTool(tools, 'discord_list_user_guilds', {})
    expect(last().headers['authorization']).toBe(TOKEN)
    expect(guilds).not.toContain(TOKEN)
    expect(JSON.parse(guilds).account).toBe('anna_n')
    expect(bodyOf(guilds)).toEqual([{ id: 'G1', name: 'Makers', owner: true }, { id: 'G2', name: 'Games' }])
    expect(bodyOf(await runTool(tools, 'discord_list_user_channels', {}))).toEqual([
      { id: 'D2', channel: 'DM cleo', type: 'dm', lastMessageAt: '2016-04-30T11:18:25.796Z' },
      { id: 'D1', channel: 'DM Ben', type: 'dm', lastMessageAt: '2015-01-01T00:00:00.000Z' },
      { id: 'D3', channel: 'group DM Ben, cleo', type: 'group-dm' },
    ])
    expect(bodyOf(await runTool(tools, 'discord_list_user_channels', { guildId: 'G1' }))).toEqual([
      { id: 'C1', channel: '#general', type: 'text', category: 'Work', topic: 'All hands' },
      { id: 'C2', channel: '#random', type: 'text', category: 'Work' },
      { id: 'V1', channel: '#Lounge', type: 'voice' },
    ])
  })

  it('reads a channel newest first with authors, replies, reactions and threads, and a thread oldest first', async () => {
    connectorFixtures.on('GET', API + '/channels/C1/messages', [
      message('3', 'see the thread', BEN, { thread: { id: 'T1', name: 'plans', message_count: 2 }, reactions: [{ emoji: { name: '👍' }, count: 2 }] }),
      message('2', 'hello', ME, { referenced_message: { id: '1', content: 'hi', author: BEN }, attachments: [{ id: 'A1', filename: 'plan.pdf', size: 10, content_type: 'application/pdf', url: 'https://cdn.discordapp.com/plan.pdf' }] }),
    ])
    connectorFixtures.on('GET', API + '/channels/T1/messages', [message('5', 'second', ME), message('4', 'first', BEN)])
    const { tools } = setup()
    const channel = bodyOf(await runTool(tools, 'discord_read_channel', { channelId: 'C1', limit: 10, before: '9' }))
    expect(last().url).toBe(API + '/channels/C1/messages?limit=10&before=9')
    expect(channel).toEqual({ channel: 'C1', messages: [
      { id: '3', at: '2026-10-14T09:00:00.000Z', from: 'Ben', fromId: '222', text: 'see the thread', reactions: [':👍: 2'], thread: { id: 'T1', name: 'plans', messages: 2 } },
      { id: '2', at: '2026-10-14T09:00:00.000Z', from: 'Anna', fromId: '111', text: 'hello', replyTo: { id: '1', from: 'Ben', text: 'hi' }, attachments: [{ id: 'A1', name: 'plan.pdf', size: 10, type: 'application/pdf', url: 'https://cdn.discordapp.com/plan.pdf' }] },
    ] })
    const thread = bodyOf(await runTool(tools, 'discord_read_thread', { threadId: 'T1' }))
    expect(last().url).toBe(API + '/channels/T1/messages?limit=100')
    expect(thread.messages.map((entry: { text: string }) => entry.text)).toEqual(['first', 'second'])
  })

  it('searches a server or one direct message, and says when Discord still indexes', async () => {
    connectorFixtures.on('GET', API + '/guilds/G1/messages/search', { total_results: 1, messages: [[message('7', 'invoice paid', BEN, { hit: true })]] })
    connectorFixtures.on('GET', API + '/channels/D1/messages/search', { code: 110000, message: 'Index not yet available. Try again later', retry_after: 2 }, 202)
    const { tools } = setup()
    expect(bodyOf(await runTool(tools, 'discord_search_messages', { query: 'invoice paid', guildId: 'G1', authorId: '222' }))).toEqual({ total: 1, matches: [
      { channel: 'C1', id: '7', at: '2026-10-14T09:00:00.000Z', from: 'Ben', fromId: '222', text: 'invoice paid' },
    ] })
    expect(last().url).toBe(API + '/guilds/G1/messages/search?content=invoice%20paid&author_id=222')
    await expect(runTool(tools, 'discord_search_messages', { query: 'invoice', channelId: 'D1' })).rejects.toThrow('Failed: Discord is still indexing these messages')
    const calls = connectorFixtures.calls.length
    await expect(runTool(tools, 'discord_search_messages', { query: 'invoice' })).rejects.toThrow('give exactly one of guildId and channelId')
    expect(connectorFixtures.calls).toHaveLength(calls)
  })

  it('finds friends and server members, and reads a profile', async () => {
    connectorFixtures.on('GET', API + '/users/@me/relationships', [
      { id: '222', type: 1, user: BEN, nickname: 'Benek' },
      { id: '444', type: 2, user: { id: '444', username: 'benny' } },
    ])
    connectorFixtures.on('GET', API + '/guilds/G1/members/search', [{ user: { id: '555', username: 'bendy', global_name: null }, nick: 'B' }])
    connectorFixtures.on('GET', API + '/users/222/profile', { user: { ...BEN, bio: '' }, user_profile: { bio: 'Builds things', pronouns: 'he/him' }, mutual_guilds: [{ id: 'G1', nick: null }] })
    const { tools } = setup()
    expect(bodyOf(await runTool(tools, 'discord_search_users', { query: 'ben' }))).toEqual([{ id: '222', name: 'Ben', username: 'ben', nickname: 'Benek' }])
    expect(bodyOf(await runTool(tools, 'discord_search_users', { query: 'ben', guildId: 'G1', max: 5 }))).toEqual([{ id: '555', name: 'bendy', username: 'bendy', nick: 'B' }])
    expect(last().url).toBe(API + '/guilds/G1/members/search?query=ben&limit=5')
    expect(bodyOf(await runTool(tools, 'discord_read_user_profile', { userId: '222' }))).toEqual({ id: '222', name: 'Ben', username: 'ben', bio: 'Builds things', pronouns: 'he/him', bot: false, mutualServers: ['G1'] })
    expect(last().url).toBe(API + '/users/222/profile?with_mutual_guilds=true')
  })
})

describe('Discord as you: write tools behind the write grant (ux-l2ul)', () => {
  it('has no write tool without the write grant', () => {
    const reader = account('discord-user', 'Anna', 'anna_n', [], false)
    expect(setup([reader]).tools.map((tool) => tool.name)).toEqual(READ_TOOLS)
  })

  it('sends to a channel or a person, replies, reacts and marks read', async () => {
    connectorFixtures.on('POST', API + '/channels/', (call: RecordedCall) => ({ ...message('9', String((json(call) as { content: string }).content), ME), channel_id: call.url.split('/')[6] }))
    connectorFixtures.on('POST', API + '/users/@me/channels', { id: 'D9', type: 1, recipients: [BEN] })
    connectorFixtures.on('PUT', API + '/channels/C1/messages/3/reactions/', () => new Response(null, { status: 204 }))
    connectorFixtures.on('GET', API + '/channels/C1', { id: 'C1', type: 0, last_message_id: '3' })
    connectorFixtures.on('POST', API + '/channels/C1/messages/3/ack', { token: null })
    const { tools } = setup()
    expect(bodyOf(await runTool(tools, 'discord_send_message_as_user', { channelId: 'C1', text: 'on my way' }))).toEqual({ sent: true, channel: 'C1', messageIds: ['9'] })
    expect(last().url).toBe(API + '/channels/C1/messages')
    expect(last().headers['authorization']).toBe(TOKEN)
    expect(json(last())).toEqual({ content: 'on my way' })
    expect(bodyOf(await runTool(tools, 'discord_send_message_as_user', { userId: '222', text: 'hi Ben' }))).toEqual({ sent: true, channel: 'D9', messageIds: ['9'] })
    const opened = connectorFixtures.calls.find((call) => call.url === API + '/users/@me/channels')!
    expect(json(opened)).toEqual({ recipients: ['222'] })
    expect(last().url).toBe(API + '/channels/D9/messages')
    await expect(runTool(tools, 'discord_send_message_as_user', { channelId: 'C1', userId: '222', text: 'both' })).rejects.toThrow('give exactly one of channelId and userId')
    await runTool(tools, 'discord_reply_as_user', { channelId: 'C1', messageId: '3', text: 'agreed' })
    expect(json(last())).toEqual({ content: 'agreed', message_reference: { message_id: '3', channel_id: 'C1', fail_if_not_exists: false } })
    expect(bodyOf(await runTool(tools, 'discord_add_reaction', { channelId: 'C1', messageId: '3', emoji: '✅' }))).toEqual({ reacted: true })
    expect(last()).toMatchObject({ method: 'PUT', url: API + '/channels/C1/messages/3/reactions/' + encodeURIComponent('✅') + '/@me' })
    expect(bodyOf(await runTool(tools, 'discord_mark_read', { channelId: 'C1' }))).toEqual({ marked: true, channel: 'C1', messageId: '3' })
    expect(last().url).toBe(API + '/channels/C1/messages/3/ack')
    expect(json(last())).toEqual({ token: null })
  })
})

describe('Discord as you: refusals and rate limits (ux-cbo3)', () => {
  it('a 401 rejects the call and marks the connection "sign in again"; a 403 does not', async () => {
    connectorFixtures.on('GET', API + '/users/@me/guilds', { message: '401: Unauthorized', code: 0 }, 401)
    connectorFixtures.on('GET', API + '/channels/C7/messages', { message: 'Missing Access', code: 50001 }, 403)
    const { tools, statuses } = setup()
    await expect(runTool(tools, 'discord_read_channel', { channelId: 'C7' })).rejects.toThrow('Failed: the service answered 403: Missing Access')
    expect(statuses).toEqual([])
    const failure = await runTool(tools, 'discord_list_user_guilds', {}).catch((error: Error) => error.message)
    expect(failure).toContain("Failed: the account's credentials were refused: Discord refused the token")
    expect(statuses).toEqual([{ id: PERSON.id, status: 'rejected', note: 'Discord refused the token' }])
  })

  it('waits for Retry-After and tries once more, then gives up', async () => {
    let answered = 0
    const limited = () => new Response(JSON.stringify({ message: 'You are being rate limited.', retry_after: 0, global: false }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } })
    connectorFixtures.on('GET', API + '/users/@me/guilds', () => (++answered === 1 ? limited() : [{ id: 'G1', name: 'Makers' }]))
    const { tools } = setup()
    expect(bodyOf(await runTool(tools, 'discord_list_user_guilds', {}))).toEqual([{ id: 'G1', name: 'Makers' }])
    expect(answered).toBe(2)
    connectorFixtures.reset()
    connectorFixtures.on('GET', API + '/users/@me/guilds', limited)
    await expect(runTool(tools, 'discord_list_user_guilds', {})).rejects.toThrow('rate-limiting')
    expect(connectorFixtures.calls).toHaveLength(2)
  })
})

async function robotOf(connections: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, '/api/robots/' + body.id + '/settings', { method: 'PATCH', body: { codeMode: false, grants: { tools: [], skills: [], recipients: [], secrets: [], connections } } })
  await testRobot(body.id).activateForTest()
  return body.id
}
const toolsOf = async (id: string) => (await api<{ tools: string[] }>(ANNA, '/api/robots/' + id + '/prompt')).body.tools
const paste = (values: Record<string, string>, shared = false) => api<ConnectionView & { error: string }>(ANNA, '/api/connections/discord-user', { body: { shared, values } })

describe('connecting Discord as you through the edge API (ux-urf8, ux-l2ul, ux-bk91, ux-cbo3)', () => {
  it('checks the token with Discord, stores a person connection that is never shared, and gives a granted Robot its tools', async () => {
    connectorFixtures.on('GET', API + '/users/@me', ME)
    expect((await paste({ token: TOKEN }, true)).body.error).toBe('a Discord connection acts as you, so it cannot be shared with the Space')
    const saved = await paste({ token: TOKEN })
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ kind: 'discord-user', label: 'Anna', account: 'anna_n', status: 'connected', shared: false })
    expect(connectorFixtures.calls.find((call) => call.url === API + '/users/@me')!.headers['authorization']).toBe(TOKEN)
    expect((await env.MEMBER.getByName(annaId).useConnection(saved.body.id))!.secrets).toEqual({ token: TOKEN })
    expect((await api<{ error: string }>(ANNA, '/api/connections/' + saved.body.id, { method: 'PATCH', body: { shared: true } })).status).toBe(400)

    const reader = await robotOf([saved.body.id])
    const catalog = (await api<SettingsCatalog>(ANNA, '/api/robots/' + reader + '/catalog')).body
    expect(catalog.connections?.find((connection) => connection.id === saved.body.id)?.pluginTitle).toBe('Discord')
    const read = await toolsOf(reader)
    expect(read).toEqual(expect.arrayContaining(['discord_user_accounts', ...READ_TOOLS]))
    expect(read.filter((name) => WRITE_TOOLS.includes(name))).toEqual([])
    const writer = await robotOf([saved.body.id, saved.body.id + ':write'])
    expect(await toolsOf(writer)).toEqual(expect.arrayContaining([...READ_TOOLS, ...WRITE_TOOLS]))

    // Both Discord ways follow the Discord plugin's switch.
    await api(ANNA, '/api/admin/plugins/discord', { method: 'PUT', body: { enabled: false } })
    expect((await toolsOf(writer)).filter((name) => name.startsWith('discord_'))).toEqual([])
  })

  it('refuses a bot token and a refused token before storing anything', async () => {
    connectorFixtures.on('GET', API + '/users/@me', { id: '999', username: 'Mr. Robot', bot: true })
    expect((await paste({ token: 'bot-token' })).body.error).toBe('this is a bot token: connect it as a bot')
    connectorFixtures.on('GET', API + '/users/@me', { message: '401: Unauthorized', code: 0 }, 401)
    expect((await paste({ token: 'gone' })).body.error).toBe('the pasted values were refused: Discord refused the token')
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toEqual([])
  })

  it('a 401 in a Robot\'s Turn shows "sign in again"; signing in again restores the same connection', async () => {
    connectorFixtures.on('GET', API + '/users/@me', ME)
    const saved = (await paste({ token: TOKEN })).body
    const id = await robotOf([saved.id])
    connectorFixtures.on('GET', API + '/users/@me/guilds', { message: '401: Unauthorized', code: 0 }, 401)
    scripts.set(id, [{ calls: [{ name: 'discord_list_user_guilds', args: {} }] }, { text: 'Your Discord session is gone.' }])
    await api(ANNA, '/api/robots/' + id + '/messages', { body: { text: 'what servers am I on?' } })
    await settle(id)
    const result = requests.get(id)!.at(-1)!.messages.filter((entry) => entry.role === 'tool').map((entry) => entry.content.map((block) => ('text' in block ? block.text : '')).join('')).join('\n')
    expect(result).toContain('Discord refused the token')
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toEqual([expect.objectContaining({ id: saved.id, status: 'rejected', statusNote: 'Discord refused the token' })])

    const again = await paste({ token: 'new-token' })
    expect(again.body).toMatchObject({ id: saved.id, status: 'connected', statusNote: null })
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toHaveLength(1)
    expect((await env.MEMBER.getByName(annaId).useConnection(saved.id))!.secrets).toEqual({ token: 'new-token' })
    expect(await toolsOf(id)).toContain('discord_read_channel')
  })
})
