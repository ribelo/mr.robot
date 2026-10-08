/**
 * The Discord connector (v1.5 ticket 05, cn-csae, cn-q259): one official bot per Home, its token in the
 * vault; REST tools for channels, messages, files, reactions and DMs with the owner. The gateway (a
 * Durable Object, see discord-gateway.ts) carries inbound messages; this file is only the REST surface.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { ConnectorRefused, request, type ConnectorFailure, type ConnectorHost, type ConnectorToolSpec, type ConnectionUse } from './connector.ts'
import { connectorTools, type ConnectorPlugin, type VerifiedConnection } from './connector.ts'

const API = 'https://discord.com/api/v10'

/** The permissions the invite link asks for: view channels, send, history, reactions, files, threads. */
export const BOT_PERMISSIONS = 117824

export const inviteUrl = (applicationId: string): string =>
  'https://discord.com/oauth2/authorize?client_id=' + applicationId + '&scope=bot&permissions=' + BOT_PERMISSIONS

/** Discord answers 401 with {"message":"401: Unauthorized"}: that is a refused token (cn-bxmu for Discord). */
const refused = (status: number, body: unknown): string | null => {
  if (status === 401) return 'Discord refused the bot token'
  if (status === 403) return body !== null && typeof body === 'object' && typeof (body as Record<string, unknown>)['message'] === 'string' ? String((body as Record<string, unknown>)['message']) : 'the bot is not allowed to do that here'
  return null
}

export function discordCall<S extends Schema.Top>(host: ConnectorHost, use: ConnectionUse, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, schema: S, body?: unknown, bytes?: { readonly data: Uint8Array; readonly contentType: string }): Effect.Effect<S['Type'], ConnectorFailure> {
  const token = use.secrets['token'] ?? ''
  const headers = { authorization: 'Bot ' + token }
  // A message with files goes as multipart/form-data: payload_json plus the file (Discord REST).
  if (bytes !== undefined) {
    const boundary = 'mr-robot-' + crypto.randomUUID()
    const encoder = new TextEncoder()
    const head = encoder.encode('--' + boundary + '\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(body ?? {}) + '\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="files[0]"; filename="file"\r\nContent-Type: ' + bytes.contentType + '\r\n\r\n')
    const tail = encoder.encode('\r\n--' + boundary + '--')
    const data = new Uint8Array(head.length + bytes.data.length + tail.length)
    data.set(head, 0)
    data.set(bytes.data, head.length)
    data.set(tail, head.length + bytes.data.length)
    return request(host.fetch, { method, url: API + path, headers, bytes: { data, contentType: 'multipart/form-data; boundary=' + boundary } }, schema, refused)
  }
  return request(host.fetch, { method, url: API + path, headers, ...(body === undefined ? {} : { json: body }) }, schema, refused)
}

const Posted = Schema.Struct({ id: Schema.String, channel_id: Schema.String, content: Schema.optional(Schema.String) })

/** Post a message with a bot token (the Channel side); true when Discord accepted it. */
export function discordPostMessage(fetch: typeof globalThis.fetch, token: string, channelId: string, text: string): Effect.Effect<boolean, ConnectorFailure> {
  return Effect.map(
    request(fetch, { method: 'POST', url: API + '/channels/' + encodeURIComponent(channelId) + '/messages', headers: { authorization: 'Bot ' + token }, json: { content: text.slice(0, 1900) } }, Posted, refused),
    () => true,
  )
}

const BotUser = Schema.Struct({ id: Schema.String, username: Schema.String, global_name: Schema.optional(Schema.NullOr(Schema.String)), bot: Schema.optional(Schema.Boolean), avatar: Schema.optional(Schema.NullOr(Schema.String)) })
const Guild = Schema.Struct({ id: Schema.String, name: Schema.String, owner: Schema.optional(Schema.Boolean) })
const Channel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  type: Schema.Number,
  guild_id: Schema.optional(Schema.String),
  parent_id: Schema.optional(Schema.NullOr(Schema.String)),
  topic: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.optional(Schema.Number),
  nsfw: Schema.optional(Schema.Boolean),
  // DMs carry the person on the other side instead of a name.
  recipients: Schema.optional(Schema.Array(BotUser)),
})
type Channel = typeof Channel.Type
const Message = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  content: Schema.String,
  timestamp: Schema.String,
  author: BotUser,
  attachments: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, filename: Schema.String, size: Schema.optional(Schema.Number), url: Schema.optional(Schema.String), content_type: Schema.optional(Schema.String) }))),
  referenced_message: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, content: Schema.optional(Schema.String) }))),
  reactions: Schema.optional(Schema.Array(Schema.Struct({ emoji: Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) }), count: Schema.Number }))),
  thread: Schema.optional(Schema.Struct({ id: Schema.String })),
})
type Message = typeof Message.Type
const Ignored = Schema.Unknown

const TEXT_CHANNEL = new Set([0, 5, 10, 11, 12, 15])

const channelName = (channel: Channel): string => (channel.type === 1 ? 'DM ' + (channel.recipients?.[0]?.username ?? channel.id) : channel.type === 3 ? 'group DM ' + channel.id : '#' + (channel.name ?? channel.id))

const shownMessage = (message: Message) => ({
  id: message.id,
  channel: message.channel_id,
  from: message.author.global_name ?? message.author.username,
  bot: message.author.bot === true,
  at: message.timestamp,
  text: message.content,
  ...(message.referenced_message === undefined || message.referenced_message === null ? {} : { replyTo: { id: message.referenced_message.id, text: message.referenced_message.content ?? '' } }),
  ...(message.attachments === undefined ? {} : { attachments: message.attachments.map((file) => ({ id: file.id, name: file.filename, size: file.size ?? null, type: file.content_type ?? null, url: file.url ?? null })) }),
  ...(message.reactions === undefined ? {} : { reactions: message.reactions.map((reaction) => ':' + (reaction.emoji.name ?? '?') + ': ' + reaction.count) }),
  ...(message.thread === undefined ? {} : { thread: message.thread.id }),
})

type Args = Record<string, unknown>
const str = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')
const num = (args: Args, key: string, fallback: number, max: number): number => Math.min(Math.max(Number(args[key] ?? fallback) || fallback, 1), max)

/** Where a DM with a person is: an open DM channel with them (Discord needs one per person). */
const dmChannel = (host: ConnectorHost, use: ConnectionUse, recipient: string) =>
  discordCall(host, use, 'POST', '/users/@me/channels', Channel, { recipient_id: recipient })

export function discordTools(host: ConnectorHost): ReadonlyArray<ConnectorToolSpec<never>> {
  const specs: Array<ConnectorToolSpec<Args>> = [
    {
      name: 'discord_me',
      service: 'discord',
      description: 'The bot itself: its name, id and the link that invites it to a server.',
      parameters: { properties: {} },
      action: () => 'who am I',
      run: (_args, use) => Effect.map(discordCall(host, use, 'GET', '/users/@me', BotUser), (bot) => ({ id: bot.id, name: bot.global_name ?? bot.username, username: bot.username, invite: inviteUrl(bot.id) })),
    },
    {
      name: 'discord_guilds',
      service: 'discord',
      description: 'The servers this bot is in.',
      parameters: { properties: {} },
      action: () => 'list servers',
      run: (_args, use) => Effect.map(discordCall(host, use, 'GET', '/users/@me/guilds', Schema.Array(Guild)), (guilds) => guilds.map((guild) => ({ id: guild.id, name: guild.name }))),
    },
    {
      name: 'discord_channels',
      service: 'discord',
      description: 'The channels of a server (text channels and threads), or the direct messages the bot can see.',
      parameters: { properties: { guildId: { type: 'string', description: 'A server id from discord_guilds; leave out to list the bot\'s direct messages.' } } },
      action: (args) => (str(args, 'guildId') === '' ? 'list direct messages' : 'list channels of ' + str(args, 'guildId')),
      run: (args, use) => Effect.gen(function* () {
        if (str(args, 'guildId') === '') {
          const channels = yield* discordCall(host, use, 'GET', '/users/@me/channels', Schema.Array(Channel))
          return channels.map((channel) => ({ id: channel.id, channel: channelName(channel), type: channel.type === 1 ? 'dm' : 'group-dm' }))
        }
        const channels = yield* discordCall(host, use, 'GET', '/guilds/' + encodeURIComponent(str(args, 'guildId')) + '/channels', Schema.Array(Channel))
        return channels.filter((channel) => TEXT_CHANNEL.has(channel.type)).map((channel) => ({ id: channel.id, channel: channelName(channel), type: channel.type === 15 ? 'forum' : channel.type === 5 ? 'announcement' : channel.type === 2 ? 'voice' : 'text', ...(channel.topic === undefined || channel.topic === null || channel.topic === '' ? {} : { topic: channel.topic }), position: channel.position ?? null }))
      }),
    },
    {
      name: 'discord_read_messages',
      service: 'discord',
      description: 'Read recent messages of a channel or direct message, newest first.',
      parameters: { properties: { channelId: { type: 'string' }, limit: { type: 'number' }, before: { type: 'string', description: 'A message id: only messages before it.' } }, required: ['channelId'] },
      action: (args) => 'read ' + str(args, 'channelId'),
      run: (args, use) => Effect.map(
        discordCall(host, use, 'GET', '/channels/' + encodeURIComponent(str(args, 'channelId')) + '/messages?limit=' + num(args, 'limit', 50, 100) + (str(args, 'before') === '' ? '' : '&before=' + encodeURIComponent(str(args, 'before'))), Schema.Array(Message)),
        (messages) => messages.map(shownMessage),
      ),
    },
    {
      name: 'discord_send_message',
      service: 'discord',
      write: true,
      description: 'Send a message to a channel; one Workspace file may go with it as an attachment.',
      parameters: { properties: { channelId: { type: 'string' }, text: { type: 'string' }, attachment: { type: 'string', description: 'A Workspace path to send as a file.' } }, required: ['channelId', 'text'] },
      action: (args) => 'send to ' + str(args, 'channelId'),
      run: (args, use) => Effect.gen(function* () {
        const path = str(args, 'attachment')
        if (path === '') {
          const sent = yield* discordCall(host, use, 'POST', '/channels/' + encodeURIComponent(str(args, 'channelId')) + '/messages', Message, { content: str(args, 'text') })
          return { sent: true, messageId: sent.id, channel: sent.channel_id }
        }
        const bytes = yield* Effect.tryPromise({ try: () => host.readFile(path), catch: (error) => new ConnectorRefused({ message: 'cannot attach ' + path + ': ' + (error instanceof Error ? error.message : String(error)) }) })
        const sent = yield* discordCall(host, use, 'POST', '/channels/' + encodeURIComponent(str(args, 'channelId')) + '/messages', Message, { content: str(args, 'text'), attachments: [{ id: 0, filename: path.split('/').at(-1) ?? 'file' }] }, { data: bytes, contentType: contentTypeOf(path) })
        return { sent: true, messageId: sent.id, channel: sent.channel_id, file: path.split('/').at(-1) }
      }),
    },
    {
      name: 'discord_reply',
      service: 'discord',
      write: true,
      description: 'Reply to a message in its channel (Discord shows it as a reply).',
      parameters: { properties: { channelId: { type: 'string' }, messageId: { type: 'string' }, text: { type: 'string' } }, required: ['channelId', 'messageId', 'text'] },
      action: (args) => 'reply to ' + str(args, 'messageId'),
      run: (args, use) => Effect.map(
        discordCall(host, use, 'POST', '/channels/' + encodeURIComponent(str(args, 'channelId')) + '/messages', Message, { content: str(args, 'text'), message_reference: { message_id: str(args, 'messageId'), channel_id: str(args, 'channelId') } }),
        (sent) => ({ sent: true, messageId: sent.id }),
      ),
    },
    {
      name: 'discord_react',
      service: 'discord',
      write: true,
      description: 'Add a reaction to a message (a unicode emoji, or a custom one as name:id).',
      parameters: { properties: { channelId: { type: 'string' }, messageId: { type: 'string' }, emoji: { type: 'string' } }, required: ['channelId', 'messageId', 'emoji'] },
      action: (args) => 'react ' + str(args, 'emoji') + ' to ' + str(args, 'messageId'),
      run: (args, use) => Effect.as(
        discordCall(host, use, 'PUT', '/channels/' + encodeURIComponent(str(args, 'channelId')) + '/messages/' + encodeURIComponent(str(args, 'messageId')) + '/reactions/' + encodeURIComponent(str(args, 'emoji')) + '/@me', Ignored),
        { reacted: true },
      ),
    },
    {
      name: 'discord_dm',
      service: 'discord',
      write: true,
      description: 'Send a direct message to a person the bot shares a server with (a user id from discord_read_messages, or the owner\'s id).',
      parameters: { properties: { userId: { type: 'string' }, text: { type: 'string' } }, required: ['userId', 'text'] },
      action: (args) => 'DM ' + str(args, 'userId'),
      run: (args, use) => Effect.gen(function* () {
        const channel = yield* dmChannel(host, use, str(args, 'userId'))
        const sent = yield* discordCall(host, use, 'POST', '/channels/' + encodeURIComponent(channel.id) + '/messages', Message, { content: str(args, 'text') })
        return { sent: true, channel: channel.id, messageId: sent.id }
      }),
    },
  ]
  return specs as unknown as ReadonlyArray<ConnectorToolSpec<never>>
}

function contentTypeOf(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json', zip: 'application/zip' } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

export const DiscordPlugin: ConnectorPlugin = {
  kind: 'discord',
  /** A pasted bot token is checked with GET /users/@me; the invite link comes from the bot id (cn-csae). */
  verifyPasted(secrets: Readonly<Record<string, string>>, fetch: typeof globalThis.fetch): Effect.Effect<VerifiedConnection, ConnectorFailure> {
    // SAFETY: verifyPasted only makes the connector's HTTP calls; the other host members are unused here.
    const probe = { fetch } as ConnectorHost
    return Effect.map(discordCall(probe, { secrets, meta: {} }, 'GET', '/users/@me', BotUser), (bot) => ({
      account: bot.username,
      label: 'Bot ' + (bot.global_name ?? bot.username),
      meta: { applicationId: bot.id, setupLink: inviteUrl(bot.id), setupLabel: 'Invite the bot to a server' },
    }))
  },
  tools: (host: ConnectorHost) => connectorTools(host, discordTools(host) as never),
  prompt: () => [
    '- Discord: the bot is in the servers its owner invited it to. Read tools need no extra grant; sending, replying, reacting and DMs need the write grant.',
    '- A robot has its own channel when its settings name one: messages there and direct messages to the bot wake it, and its replies go back to that channel.',
  ].join('\n'),
}
