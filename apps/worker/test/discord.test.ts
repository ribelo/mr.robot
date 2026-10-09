import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Conversation, Me, RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts, requests } from './stub-llm.ts'
import { connectorFixtures, type RecordedCall } from './connector-fixtures.ts'
import { account, runTool, testHost, bodyOf } from './connector-host.ts'
import { accountsTool } from '../src/connectors/connector.ts'
import { DiscordPlugin, inviteUrl, BOT_PERMISSIONS } from '../src/connectors/discord.ts'
import { gatewayStep, initialGateway, INTENTS, readPayload } from '../src/connectors/discord-gateway.ts'

const ANNA = 'anna@example.com'
const TOKEN = 'bot-token-123'
const API = 'https://discord.com/api/v10'
const BOT = account('discord', 'Bot Mr. Robot', 'mr-robot', ['discord'], true)

const json = (call: RecordedCall) => JSON.parse(call.body ?? 'null') as Record<string, unknown>
const last = () => connectorFixtures.calls.at(-1)!
const setup = (accounts = [BOT]) => {
  const test = testHost('discord', accounts, { [BOT.id]: { token: TOKEN } })
  return { ...test, tools: DiscordPlugin.tools(test.host) }
}

const person = { id: 'U-anna', username: 'anna', global_name: 'Anna' }
const message = (id: string, content: string, extra: Record<string, unknown> = {}) => ({ id, channel_id: 'C-1', content, timestamp: '2026-10-08T12:00:00.000000+00:00', author: person, ...extra })

describe('the Discord gateway as a state machine (recorded gateway payloads)', () => {
  it('identifies after HELLO, keeps the sequence for heartbeats, and stores the session from READY', () => {
    const hello = gatewayStep(initialGateway, readPayload('{"op":10,"d":{"heartbeat_interval":41250},"s":null,"t":null}')!, TOKEN)
    expect(hello.state.heartbeatMs).toBe(41250)
    expect(JSON.parse(hello.send[0]!)).toEqual({ op: 2, d: { token: TOKEN, intents: INTENTS, properties: { os: 'linux', browser: 'mr-robot', device: 'mr-robot' }, compress: false } })
    // Guilds, guild messages, direct messages and message content (Discord's intent bits).
    expect(INTENTS).toBe(1 + 512 + 4096 + 8192 + 32768)
    const ready = gatewayStep(hello.state, readPayload('{"op":0,"t":"READY","s":1,"d":{"session_id":"sess-1","resume_gateway_url":"wss://gateway-us-east1-b.discord.gg","user":{"id":"B1","username":"mr-robot"}}}')!, TOKEN)
    expect(ready.state).toMatchObject({ sessionId: 'sess-1', sequence: 1, identified: true })
    const asked = gatewayStep(ready.state, readPayload('{"op":1,"d":null}')!, TOKEN)
    expect(JSON.parse(asked.send[0]!)).toEqual({ op: 1, d: 1 })
  })

  it('turns a person\'s message into a wake-up and ignores bots, webhooks and empty messages', () => {
    const at = { ...initialGateway, identified: true, sequence: 4 }
    const inGuild = gatewayStep(at, readPayload(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: 5, d: { ...message('M-1', ' hi robot '), guild_id: 'G-1' } }))!, TOKEN)
    expect(inGuild.state.sequence).toBe(5)
    expect(inGuild.messages).toEqual([{ id: 'M-1', channelId: 'C-1', guildId: 'G-1', authorId: 'U-anna', authorName: 'Anna', text: 'hi robot', direct: false }])
    const direct = gatewayStep(at, readPayload(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: 6, d: message('M-2', 'psst') }))!, TOKEN)
    expect(direct.messages[0]).toMatchObject({ direct: true, guildId: null })
    for (const ignored of [{ ...message('M-3', 'beep'), author: { ...person, bot: true } }, { ...message('M-4', 'hook'), webhook_id: 'W1' }, message('M-5', '   ')]) {
      expect(gatewayStep(at, readPayload(JSON.stringify({ op: 0, t: 'MESSAGE_CREATE', s: 7, d: ignored }))!, TOKEN).messages).toEqual([])
    }
  })

  it('reconnects when Discord asks, and identifies again after an invalid session', () => {
    expect(gatewayStep(initialGateway, readPayload('{"op":7,"d":null}')!, TOKEN).reconnect).toBe(true)
    const invalid = gatewayStep({ ...initialGateway, sessionId: 'old', sequence: 9 }, readPayload('{"op":9,"d":false}')!, TOKEN)
    expect(invalid.state.sessionId).toBeNull()
    expect(JSON.parse(invalid.send[0]!).op).toBe(2)
    expect(readPayload('not json')).toBeNull()
  })
})

describe('Discord tools against recorded responses (cn-q259)', () => {
  it('names the bot with its invite link, lists servers and their text channels, reads messages', async () => {
    connectorFixtures.on('GET', `${API}/users/@me`, { id: 'B1', username: 'mr-robot', bot: true })
    connectorFixtures.on('GET', `${API}/users/@me/guilds`, [{ id: 'G-1', name: 'Home server', owner: false }])
    connectorFixtures.on('GET', `${API}/guilds/G-1/channels`, [{ id: 'C-1', name: 'general', type: 0, position: 0 }, { id: 'V-1', name: 'Voice', type: 2 }, { id: 'K-1', name: 'Text', type: 4 }, { id: 'C-2', name: 'flat-watcher', type: 0, topic: 'Flats', position: 1 }])
    connectorFixtures.on('GET', `${API}/channels/C-1/messages`, [message('M-2', 'second', { referenced_message: { id: 'M-1', content: 'first' }, reactions: [{ emoji: { name: '👍' }, count: 2 }] }), message('M-1', 'first', { attachments: [{ id: 'A1', filename: 'plan.pdf', size: 10, content_type: 'application/pdf', url: 'https://cdn.discordapp.com/a/plan.pdf' }] })])
    const { tools } = setup()
    const me = bodyOf(await runTool(tools, 'discord_me', {}))
    expect(me).toEqual({ id: 'B1', name: 'mr-robot', username: 'mr-robot', invite: `https://discord.com/oauth2/authorize?client_id=B1&scope=bot&permissions=${BOT_PERMISSIONS}` })
    expect(connectorFixtures.calls[0]!.headers['authorization']).toBe('Bot ' + TOKEN)
    expect(bodyOf(await runTool(tools, 'discord_guilds', {}))).toEqual([{ id: 'G-1', name: 'Home server' }])
    expect(bodyOf(await runTool(tools, 'discord_channels', { guildId: 'G-1' }))).toEqual([
      { id: 'C-1', channel: '#general', type: 'text', position: 0 },
      { id: 'C-2', channel: '#flat-watcher', type: 'text', topic: 'Flats', position: 1 },
    ])
    const read = bodyOf(await runTool(tools, 'discord_read_messages', { channelId: 'C-1', limit: 2 }))
    expect(new URL(last().url).searchParams.get('limit')).toBe('2')
    expect(read[0]).toMatchObject({ id: 'M-2', from: 'Anna', text: 'second', replyTo: { id: 'M-1', text: 'first' }, reactions: [':👍: 2'] })
    expect(read[1].attachments).toEqual([{ id: 'A1', name: 'plan.pdf', size: 10, type: 'application/pdf', url: 'https://cdn.discordapp.com/a/plan.pdf' }])
  })

  it('sends, sends a Workspace file as multipart, replies, reacts and DMs; only with the write grant', async () => {
    const reader = account('discord', 'Bot Mr. Robot', 'mr-robot', ['discord'], false)
    expect(setup([reader]).tools.map((tool) => tool.name).filter((name) => /send|reply|react|_dm/.test(name))).toEqual([])
    connectorFixtures.on('POST', `${API}/channels/C-1/messages`, (call: RecordedCall) => ({ id: 'M-9', channel_id: 'C-1', content: 'x', timestamp: '2026-10-08T12:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } }))
    connectorFixtures.on('PUT', `${API}/channels/C-1/messages/M-1/reactions/`, new Response(null, { status: 204 }))
    connectorFixtures.on('POST', `${API}/users/@me/channels`, { id: 'D-1', type: 1, recipients: [person] })
    connectorFixtures.on('POST', `${API}/channels/D-1/messages`, { id: 'M-10', channel_id: 'D-1', content: 'hi', timestamp: '2026-10-08T12:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } })
    const { tools, host } = setup()
    expect(bodyOf(await runTool(tools, 'discord_send_message', { channelId: 'C-1', text: 'Done.' }))).toEqual({ sent: true, messageId: 'M-9', channel: 'C-1' })
    expect(json(last())).toEqual({ content: 'Done.' })
    await host.saveFile('out/plan.pdf', new TextEncoder().encode('%PDF plan'))
    await runTool(tools, 'discord_send_message', { channelId: 'C-1', text: 'The plan', attachment: 'out/plan.pdf' })
    expect(last().headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(last().body).toContain('name="payload_json"')
    expect(last().body).toContain('{"content":"The plan","attachments":[{"id":0,"filename":"plan.pdf"}]}')
    expect(last().body).toContain('Content-Type: application/pdf\r\n\r\n%PDF plan')
    await runTool(tools, 'discord_reply', { channelId: 'C-1', messageId: 'M-1', text: 'Yes' })
    expect(json(last())).toEqual({ content: 'Yes', message_reference: { message_id: 'M-1', channel_id: 'C-1' } })
    await runTool(tools, 'discord_react', { channelId: 'C-1', messageId: 'M-1', emoji: '✅' })
    expect(last().url).toBe(`${API}/channels/C-1/messages/M-1/reactions/${encodeURIComponent('✅')}/@me`)
    expect(bodyOf(await runTool(tools, 'discord_dm', { userId: 'U-anna', text: 'hi' }))).toEqual({ sent: true, channel: 'D-1', messageId: 'M-10' })
    expect(json(connectorFixtures.calls.find((call) => call.url.endsWith('/users/@me/channels'))!)).toEqual({ recipient_id: 'U-anna' })
  })

  it('discord_accounts lists the services the bot grants (ts-z0ip)', async () => {
    const bare = account('discord', 'Bot Mr. Robot', 'mr-robot', [], true)
    const { host } = setup([bare])
    const list = [accountsTool(host, DiscordPlugin.defaultServices), ...DiscordPlugin.tools(host)]
    expect(JSON.parse(await runTool(list, 'discord_accounts', {}))).toEqual([{ label: bare.label, account: bare.account, services: ['channels', 'messages', 'dms'], write: true, isDefault: true }])
  })

  it('a refused token marks the connection "paste again"', async () => {
    connectorFixtures.on('GET', `${API}/users/@me/guilds`, { message: '401: Unauthorized', code: 0 }, 401)
    const { tools, statuses } = setup()
    await expect(runTool(tools, 'discord_guilds', {})).rejects.toThrow('Failed: the account\'s credentials were refused: Discord refused the bot token')
    expect(statuses).toEqual([{ id: BOT.id, status: 'rejected', note: 'Discord refused the bot token' }])
  })
})

describe('Discord as a channel of Mr. Robot (cn-csae, cn-65gg, cn-y1ac)', () => {
  let annaId = ''
  beforeEach(async () => {
    await reset()
    scripts.clear()
    requests.clear()
    connectorFixtures.reset()
    await stubModels()
    annaId = (await api<Me>(ANNA, '/api/me')).body.id
    connectorFixtures.on('GET', `${API}/users/@me`, { id: 'B1', username: 'mr-robot', global_name: 'Mr. Robot', bot: true })
  })

  const connectBot = () => api<ConnectionView>(ANNA, '/api/connections/discord', { body: { shared: false, values: { token: TOKEN } } })
  const posted = (channel: string) => connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${API}/channels/${channel}/messages`).map((call) => json(call)['content'])

  it('connects the bot from a pasted token and offers the invite link on its row', async () => {
    const connected = await connectBot()
    expect(connected.status).toBe(200)
    expect(connected.body).toMatchObject({ kind: 'discord', label: 'Bot Mr. Robot', account: 'mr-robot', setupLink: inviteUrl('B1'), setupLabel: 'Invite the bot to a server' })
    expect(connectorFixtures.calls.find((call) => call.url === `${API}/users/@me`)!.headers['authorization']).toBe('Bot ' + TOKEN)
  })

  const echo = (channel: string) => (call: RecordedCall) => ({ id: 'M-out', channel_id: channel, content: json(call)['content'], timestamp: '2026-10-08T12:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } })
  /** Every body posted to a Discord channel, in order. */
  const postsTo = (channel: string) => connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${API}/channels/${channel}/messages`).map(json)
  const incoming = (id: string, text: string) => ({ id, channelId: 'C-robot', guildId: 'G-1', authorId: 'U-anna', authorName: 'Anna', text, direct: false })
  const notifyGrant = { tools: ['notify', 'routines'], skills: [], recipients: [], secrets: [] }

  /** An active robot with its own Discord channel; `settings` adds to what the owner set. */
  async function discordRobot(settings: Record<string, unknown> = {}): Promise<string> {
    await connectBot()
    connectorFixtures.on('POST', `${API}/channels/C-robot/messages`, echo('C-robot'))
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, discordChannel: 'C-robot', grants: notifyGrant, notifications: { enabled: true, members: [], channels: ['pwa'] }, ...settings } })
    await testRobot(body.id).activateForTest()
    connectorFixtures.calls = []
    return body.id
  }

  it("a message in a robot's channel wakes it and the final reply goes back there as a reply to the message", async () => {
    const id = await discordRobot()
    scripts.set(id, [{ text: 'The flat on Prosta is still free.' }])
    expect(await env.HOME.getByName('home').discordReceived(incoming('M-in', 'any news?'), annaId)).toBe(id)
    await settle(id)
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.some((item) => item.kind === 'message' && item.text === 'any news?' && item.sender.kind === 'channel' && item.sender.channel === 'discord' && item.sender.from === 'Anna')).toBe(true)
    expect(postsTo('C-robot')).toEqual([{ content: 'The flat on Prosta is still free.', message_reference: { message_id: 'M-in', channel_id: 'C-robot', fail_if_not_exists: false } }])
    // The same Discord message twice wakes the robot once.
    await env.HOME.getByName('home').discordReceived(incoming('M-in', 'any news?'), annaId)
    await settle(id)
    expect(postsTo('C-robot')).toHaveLength(1)
  })

  it('a Turn woken on Discord posts only its final reply, and no "finished" notification', async () => {
    const id = await discordRobot()
    scripts.set(id, [{ text: "I'll check the listings.", calls: [{ name: 'react', args: { emoji: '👀' } }] }, { text: 'Two flats match.' }])
    await env.HOME.getByName('home').discordReceived(incoming('M-ask', 'what is new?'), annaId)
    await settle(id)
    const replies = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.filter((item) => item.kind === 'reply').slice(-2)
    expect(replies.map((item) => item.kind === 'reply' ? item.text : '')).toEqual(["I'll check the listings.", 'Two flats match.'])
    expect(postsTo('C-robot')).toEqual([{ content: 'Two flats match.', message_reference: { message_id: 'M-ask', channel_id: 'C-robot', fail_if_not_exists: false } }])
  })

  it('a message written in the app never reaches Discord, whatever the old channel list says', async () => {
    const id = await discordRobot({ notifications: { enabled: true, members: [], channels: ['pwa', 'discord'] } })
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.notifications.channels).toEqual(['pwa'])
    scripts.set(id, [{ text: 'Looking.', calls: [{ name: 'react', args: { emoji: '👀' } }] }, { text: 'It is still free.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'is the flat free?' } })
    await settle(id)
    expect(connectorFixtures.calls.filter((call) => call.url.includes('/channels/'))).toEqual([])
  })

  it("the robot's own notifications go to its channel, a \"finished\" copy of a reply never does", async () => {
    const id = await discordRobot()
    scripts.set(id, [{ calls: [{ name: 'notify_owner', args: { message: 'A new flat matches.' } }] }, { calls: [{ name: 'notify_owner', args: { message: 'Pick a date.', needs_owner: true } }] }, { text: 'Told you.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'tell me when something matches' } })
    await settle(id)
    expect(postsTo('C-robot').map((body) => body['content'])).toEqual([expect.stringContaining('A new flat matches.'), expect.stringContaining('Pick a date.')])
  })

  async function routineRobot(settings: Record<string, unknown>): Promise<string> {
    const id = await discordRobot(settings)
    scripts.set(id, [
      { calls: [{ name: 'schedule_create', args: { title: 'Flat check', prompt: 'Look at the listings.', weekly: { time: '02:00:00', time_zone: 'Europe/Warsaw', weekdays: [7] } } }] },
      { text: 'Scheduled.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Check every week.' } })
    await settle(id)
    expect(connectorFixtures.calls.filter((call) => call.url.includes('/channels/'))).toEqual([])
    return id
  }
  const runRoutine = async (id: string) => {
    scripts.set(id, [{ text: 'Checked: nothing new.' }])
    await testRobot(id).backdateRoutinesForTest(1000)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
  }

  it('a Routine nobody asked for posts its final reply to the channel while "also send its own messages" is on', async () => {
    const id = await routineRobot({})
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.discordProactive).toBe(true)
    await runRoutine(id)
    expect(postsTo('C-robot')).toEqual([{ content: 'Checked: nothing new.' }])
  })

  it('a Routine posts nothing to Discord when "also send its own messages" is off', async () => {
    const id = await routineRobot({ discordProactive: false })
    await runRoutine(id)
    expect(postsTo('C-robot')).toEqual([])
    // Replies to Discord messages still go back.
    scripts.set(id, [{ text: 'Still nothing.' }])
    await env.HOME.getByName('home').discordReceived(incoming('M-q', 'and now?'), annaId)
    await settle(id)
    expect(postsTo('C-robot')).toEqual([{ content: 'Still nothing.', message_reference: { message_id: 'M-q', channel_id: 'C-robot', fail_if_not_exists: false } }])
  })

  it('a reply over 2000 characters arrives as several posts with nothing lost', async () => {
    const id = await discordRobot()
    const paragraphs = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}: ` + 'word '.repeat(70).trim() + '.')
    const long = paragraphs.join('\n\n')
    expect(long.length).toBeGreaterThan(4000)
    scripts.set(id, [{ text: long }])
    await env.HOME.getByName('home').discordReceived(incoming('M-long', 'tell me everything'), annaId)
    await settle(id)
    const posts = postsTo('C-robot')
    expect(posts.length).toBeGreaterThan(1)
    expect(posts.every((body) => String(body['content']).length <= 2000)).toBe(true)
    expect(posts.map((body) => String(body['content'])).join('\n\n')).toBe(long)
    expect(posts.map((body) => body['message_reference'] !== undefined)).toEqual(posts.map((_, index) => index === 0))
  })

  it("a direct message to the bot reaches the bot owner's Mr. Robot, which needs no channel of its own, and the answer goes to the DM", async () => {
    await connectBot()
    connectorFixtures.on('POST', `${API}/channels/D-anna/messages`, echo('D-anna'))
    const robots = (await api<Array<{ id: string; kind: string }>>(ANNA, '/api/robots')).body
    const mrRobot = robots.find((robot) => robot.kind === 'mr-robot')!.id
    expect((await api<RobotPanel>(ANNA, `/api/robots/${mrRobot}/panel`)).body.settings.discordChannel).toBeNull()
    scripts.set(mrRobot, [{ text: 'Hi Anna, on it.' }])
    expect(await env.HOME.getByName('home').discordReceived({ id: 'M-dm', channelId: 'D-anna', guildId: null, authorId: 'U-anna', authorName: 'Anna', text: 'hello from my phone', direct: true }, annaId)).toBe(mrRobot)
    await settle(mrRobot)
    expect(postsTo('D-anna')).toEqual([{ content: 'Hi Anna, on it.', message_reference: { message_id: 'M-dm', channel_id: 'D-anna', fail_if_not_exists: false } }])
    // A message in a channel no robot owns wakes nobody.
    expect(await env.HOME.getByName('home').discordReceived({ id: 'M-x', channelId: 'C-nobody', guildId: 'G-1', authorId: 'U-anna', authorName: 'Anna', text: 'hm', direct: false }, annaId)).toBeNull()
  })
})
