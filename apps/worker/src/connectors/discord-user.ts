/**
 * Discord as you (v1.12 ticket 09, ux-urf8, ux-l2ul, ux-cbo3): the person's own Discord account, by its
 * user token, on Discord's REST API. There is no gateway: the Robot reads when it calls. Read tools are
 * there by default (servers, channels, messages, threads, search, people); send, reply, react and mark
 * read only with the Connection's write grant. Tool names follow the Slack connector's with the discord_
 * prefix; the two names the Discord bot already uses (discord_send_message, discord_reply) end in
 * _as_user here, so a Robot granted both ways has both.
 *
 * Discord answers 401 when the token stops working (signed out, password changed): the connection then
 * shows "Sign in again". A 429 waits as long as Discord's Retry-After says and tries once more.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { ConnectorRefused, connectorTools, request, type ConnectionUse, type ConnectorFailure, type ConnectorHost, type ConnectorPlugin, type ConnectorToolSpec, type HttpCall, type VerifiedConnection } from './connector.ts'
import { discordMessages } from './discord-text.ts'

/** The API version Discord's own web app uses with a user token. */
const API = 'https://discord.com/api/v9'

/** Discord's web app keeps the token in localStorage as a JSON string, so a copied value may keep its quotes. */
export const userToken = (raw: string): string => raw.trim().replace(/^"(.*)"$/, '$1')

/** Only 401 means the token is gone; a 403 is a channel or server this account may not use. */
const refused = (status: number): string | null => (status === 401 ? 'Discord refused the token' : null)

function userCall<S extends Schema.Top>(host: Pick<ConnectorHost, 'fetch'>, use: ConnectionUse, method: HttpCall['method'], path: string, schema: S, body?: unknown): Effect.Effect<S['Type'], ConnectorFailure> {
  // A user token goes bare in Authorization; only a bot token carries "Bot ".
  const headers = { authorization: userToken(use.secrets['token'] ?? '') }
  return request(host.fetch, { method, url: API + path, headers, ...(body === undefined ? {} : { json: body }) }, schema, refused, 'retry-after-once')
}

const User = Schema.Struct({ id: Schema.String, username: Schema.String, global_name: Schema.optional(Schema.NullOr(Schema.String)), bot: Schema.optional(Schema.Boolean) })
type User = typeof User.Type
const Guild = Schema.Struct({ id: Schema.String, name: Schema.String, owner: Schema.optional(Schema.Boolean) })
const Channel = Schema.Struct({
  id: Schema.String,
  type: Schema.Number,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  parent_id: Schema.optional(Schema.NullOr(Schema.String)),
  topic: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.optional(Schema.Number),
  last_message_id: Schema.optional(Schema.NullOr(Schema.String)),
  // Direct messages carry the people on the other side instead of a name.
  recipients: Schema.optional(Schema.Array(User)),
})
type Channel = typeof Channel.Type
const Message = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  content: Schema.String,
  timestamp: Schema.String,
  author: User,
  attachments: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, filename: Schema.String, size: Schema.optional(Schema.Number), url: Schema.optional(Schema.String), content_type: Schema.optional(Schema.String) }))),
  referenced_message: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, content: Schema.optional(Schema.String), author: Schema.optional(User) }))),
  reactions: Schema.optional(Schema.Array(Schema.Struct({ emoji: Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) }), count: Schema.Number }))),
  thread: Schema.optional(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String), message_count: Schema.optional(Schema.Number) })),
  // Search answers each match with its context; the match carries hit.
  hit: Schema.optional(Schema.Boolean),
})
type Message = typeof Message.Type
/** A search answer; while Discord still indexes the messages it answers 202 with code 110000 instead. */
const Found = Schema.Struct({ total_results: Schema.optional(Schema.Number), messages: Schema.optional(Schema.Array(Schema.Array(Message))), code: Schema.optional(Schema.Number) })
const GuildMember = Schema.Struct({ user: User, nick: Schema.optional(Schema.NullOr(Schema.String)) })
const Relationship = Schema.Struct({ id: Schema.String, type: Schema.Number, user: User, nickname: Schema.optional(Schema.NullOr(Schema.String)) })
const Profile = Schema.Struct({
  user: Schema.Struct({ ...User.fields, bio: Schema.optional(Schema.NullOr(Schema.String)) }),
  user_profile: Schema.optional(Schema.Struct({ bio: Schema.optional(Schema.NullOr(Schema.String)), pronouns: Schema.optional(Schema.NullOr(Schema.String)) })),
  mutual_guilds: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, nick: Schema.optional(Schema.NullOr(Schema.String)) }))),
})
const Ignored = Schema.Unknown

/** Relationship type 1 is a friend (2 blocked, 3 and 4 pending requests). */
const FRIEND = 1
const CATEGORY = 4
/** Server channels with messages to read: text, voice (its chat), announcement, forum. */
const READABLE = new Set([0, 2, 5, 15])
const CHANNEL_TYPE: Readonly<Record<number, string>> = { 0: 'text', 1: 'dm', 2: 'voice', 3: 'group-dm', 5: 'announcement', 10: 'thread', 11: 'thread', 12: 'thread', 15: 'forum' }
/** Discord's epoch: a snowflake id carries its time in milliseconds since then. */
const DISCORD_EPOCH = 1420070400000n

const snowflake = (id: string | null | undefined): bigint => (id !== null && id !== undefined && /^\d+$/.test(id) ? BigInt(id) : 0n)
const snowflakeTime = (id: string): string => new Date(Number((snowflake(id) >> 22n) + DISCORD_EPOCH)).toISOString()
const newestFirst = (a: Channel, b: Channel): number => {
  const [left, right] = [snowflake(a.last_message_id), snowflake(b.last_message_id)]
  return left === right ? 0 : left > right ? -1 : 1
}

const nameOf = (user: User): string => user.global_name ?? user.username

function channelLabel(channel: Channel): string {
  const people = (channel.recipients ?? []).map(nameOf).join(', ')
  if (channel.type === 1) return 'DM ' + (people === '' ? channel.id : people)
  if (channel.type === 3) return 'group DM ' + (channel.name ?? (people === '' ? channel.id : people))
  return '#' + (channel.name ?? channel.id)
}

const shown = (message: Message) => ({
  id: message.id,
  at: message.timestamp,
  from: nameOf(message.author),
  fromId: message.author.id,
  text: message.content,
  ...(message.author.bot === true ? { bot: true } : {}),
  ...(message.referenced_message === undefined || message.referenced_message === null ? {} : {
    replyTo: { id: message.referenced_message.id, ...(message.referenced_message.author === undefined ? {} : { from: nameOf(message.referenced_message.author) }), text: message.referenced_message.content ?? '' },
  }),
  ...(message.attachments === undefined || message.attachments.length === 0 ? {} : { attachments: message.attachments.map((file) => ({ id: file.id, name: file.filename, size: file.size ?? null, type: file.content_type ?? null, url: file.url ?? null })) }),
  ...(message.reactions === undefined || message.reactions.length === 0 ? {} : { reactions: message.reactions.map((reaction) => ':' + (reaction.emoji.name ?? '?') + ': ' + reaction.count) }),
  ...(message.thread === undefined ? {} : { thread: { id: message.thread.id, ...(message.thread.name === undefined ? {} : { name: message.thread.name }), ...(message.thread.message_count === undefined ? {} : { messages: message.thread.message_count }) } }),
})

type Args = Record<string, unknown>
const str = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string).trim() : '')
const num = (args: Args, key: string, fallback: number, max: number): number => Math.min(Math.max(Number(args[key] ?? fallback) || fallback, 1), max)
const segment = (args: Args, key: string): string => encodeURIComponent(str(args, key))
const matches = (needle: string, values: ReadonlyArray<string | null | undefined>): boolean => values.some((value) => (value ?? '').toLowerCase().includes(needle))

/** Exactly one of two arguments: a server or one direct message, a channel or a person. */
const oneOf = (first: string, second: string, what: string) => (args: Args): ConnectorRefused | undefined =>
  (str(args, first) === '') === (str(args, second) === '') ? new ConnectorRefused({ message: 'give exactly one of ' + first + ' and ' + second + ' (' + what + ')' }) : undefined

const CHANNEL_ID = { type: 'string', description: 'Discord channel id (from discord_list_user_channels); a thread id works too' }
const MESSAGE_ID = { type: 'string', description: 'Id of the message' }

export function discordUserTools(host: ConnectorHost): ReadonlyArray<ConnectorToolSpec<never>> {
  /** Post text as the account: long text goes as several messages, only the first one a reply. */
  const post = (use: ConnectionUse, channelId: string, text: string, replyTo: string) =>
    Effect.forEach(discordMessages(text), (content, index) => userCall(host, use, 'POST', '/channels/' + encodeURIComponent(channelId) + '/messages', Message, {
      content,
      ...(index === 0 && replyTo !== '' ? { message_reference: { message_id: replyTo, channel_id: channelId, fail_if_not_exists: false } } : {}),
    }))
  const specs: Array<ConnectorToolSpec<Args>> = [
    {
      name: 'discord_list_user_guilds',
      description: 'List the servers (guilds) this Discord account is on.',
      parameters: { properties: {} },
      action: () => 'list servers',
      run: (_args, use) => Effect.map(userCall(host, use, 'GET', '/users/@me/guilds', Schema.Array(Guild)), (guilds) => guilds.map((guild) => ({ id: guild.id, name: guild.name, ...(guild.owner === true ? { owner: true } : {}) }))),
    },
    {
      name: 'discord_list_user_channels',
      description: 'List the channels of a server (text, voice chat, announcement, forum), or without guildId the direct messages of the account, most recent first.',
      parameters: { properties: { guildId: { type: 'string', description: 'A server id from discord_list_user_guilds; leave out for direct messages.' }, max: { type: 'number', description: 'At most this many (default 100).' } } },
      action: (args) => (str(args, 'guildId') === '' ? 'list direct messages' : 'list channels of ' + str(args, 'guildId')),
      run: (args, use) => Effect.gen(function* () {
        const max = num(args, 'max', 100, 500)
        if (str(args, 'guildId') === '') {
          const channels = yield* userCall(host, use, 'GET', '/users/@me/channels', Schema.Array(Channel))
          return [...channels].sort(newestFirst).slice(0, max).map((channel) => ({
            id: channel.id, channel: channelLabel(channel), type: CHANNEL_TYPE[channel.type] ?? 'other',
            ...(channel.last_message_id === undefined || channel.last_message_id === null ? {} : { lastMessageAt: snowflakeTime(channel.last_message_id) }),
          }))
        }
        const channels = yield* userCall(host, use, 'GET', '/guilds/' + segment(args, 'guildId') + '/channels', Schema.Array(Channel))
        const categories = new Map(channels.filter((channel) => channel.type === CATEGORY).map((channel) => [channel.id, channel.name ?? channel.id]))
        return channels
          .filter((channel) => READABLE.has(channel.type))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .slice(0, max)
          .map((channel) => {
            const category = channel.parent_id === undefined || channel.parent_id === null ? undefined : categories.get(channel.parent_id)
            return {
              id: channel.id, channel: channelLabel(channel), type: CHANNEL_TYPE[channel.type] ?? 'other',
              ...(category === undefined ? {} : { category }),
              ...(channel.topic === undefined || channel.topic === null || channel.topic === '' ? {} : { topic: channel.topic }),
            }
          })
      }),
    },
    {
      name: 'discord_read_channel',
      description: "Read a channel's or a direct message's recent messages, newest first. A message with a thread names the thread's id for discord_read_thread.",
      parameters: { properties: { channelId: CHANNEL_ID, limit: { type: 'number', description: 'Most messages to return (default 50, at most 100)' }, before: { type: 'string', description: 'A message id: only messages before it.' } }, required: ['channelId'] },
      action: (args) => 'read ' + str(args, 'channelId'),
      run: (args, use) => Effect.map(
        userCall(host, use, 'GET', '/channels/' + segment(args, 'channelId') + '/messages?limit=' + num(args, 'limit', 50, 100) + (str(args, 'before') === '' ? '' : '&before=' + segment(args, 'before')), Schema.Array(Message)),
        (messages) => ({ channel: str(args, 'channelId'), messages: messages.map(shown) }),
      ),
    },
    {
      name: 'discord_read_thread',
      description: 'Read a thread: its messages, oldest first (the thread id is in the thread field of a message from discord_read_channel).',
      parameters: { properties: { threadId: { type: 'string', description: 'The thread id' }, limit: { type: 'number', description: 'Most messages to return (default 100, at most 100)' } }, required: ['threadId'] },
      action: (args) => 'read thread ' + str(args, 'threadId'),
      run: (args, use) => Effect.map(
        userCall(host, use, 'GET', '/channels/' + segment(args, 'threadId') + '/messages?limit=' + num(args, 'limit', 100, 100), Schema.Array(Message)),
        (messages) => ({ thread: str(args, 'threadId'), messages: [...messages].reverse().map(shown) }),
      ),
    },
    {
      name: 'discord_search_messages',
      description: 'Search messages in a server, or in one direct message, newest first.',
      parameters: { properties: {
        query: { type: 'string', description: 'Words to search for' },
        guildId: { type: 'string', description: 'A server id from discord_list_user_guilds' },
        channelId: { type: 'string', description: 'Instead of guildId: a direct message id from discord_list_user_channels' },
        authorId: { type: 'string', description: 'Only messages by this user id' },
        max: { type: 'number', description: 'Most results to return (default 25, at most 25)' },
      }, required: ['query'] },
      action: (args) => 'search messages "' + str(args, 'query') + '"',
      check: oneOf('guildId', 'channelId', 'search a server, or one direct message'),
      run: (args, use) => Effect.gen(function* () {
        const where = str(args, 'guildId') === '' ? '/channels/' + segment(args, 'channelId') : '/guilds/' + segment(args, 'guildId')
        const found = yield* userCall(host, use, 'GET', where + '/messages/search?content=' + segment(args, 'query') + (str(args, 'authorId') === '' ? '' : '&author_id=' + segment(args, 'authorId')), Found)
        if (found.messages === undefined) {
          if (found.code === 110000) return yield* new ConnectorRefused({ message: 'Discord is still indexing these messages; search again in a minute' })
          return { total: 0, matches: [] }
        }
        const hits = found.messages.flatMap((group) => {
          const hit = group.find((message) => message.hit === true) ?? group[0]
          return hit === undefined ? [] : [hit]
        })
        return { total: found.total_results ?? hits.length, matches: hits.slice(0, num(args, 'max', 25, 25)).map((message) => ({ channel: message.channel_id, ...shown(message) })) }
      }),
    },
    {
      name: 'discord_search_users',
      description: "Find people by name: the account's friends, or with guildId the members of a server.",
      parameters: { properties: { query: { type: 'string', description: 'Words to search for' }, guildId: { type: 'string', description: 'A server id from discord_list_user_guilds' }, max: { type: 'number', description: 'Most results to return (default 20)' } }, required: ['query'] },
      action: (args) => 'search people "' + str(args, 'query') + '"' + (str(args, 'guildId') === '' ? '' : ' in ' + str(args, 'guildId')),
      run: (args, use) => Effect.gen(function* () {
        const max = num(args, 'max', 20, 100)
        if (str(args, 'guildId') !== '') {
          const members = yield* userCall(host, use, 'GET', '/guilds/' + segment(args, 'guildId') + '/members/search?query=' + segment(args, 'query') + '&limit=' + max, Schema.Array(GuildMember))
          return members.map((member) => ({ id: member.user.id, name: nameOf(member.user), username: member.user.username, ...(member.nick === undefined || member.nick === null ? {} : { nick: member.nick }), ...(member.user.bot === true ? { bot: true } : {}) }))
        }
        const needle = str(args, 'query').toLowerCase().replace(/^@/, '')
        const relationships = yield* userCall(host, use, 'GET', '/users/@me/relationships', Schema.Array(Relationship))
        return relationships
          .filter((relationship) => relationship.type === FRIEND && matches(needle, [relationship.user.username, relationship.user.global_name, relationship.nickname]))
          .slice(0, max)
          .map((relationship) => ({ id: relationship.user.id, name: nameOf(relationship.user), username: relationship.user.username, ...(relationship.nickname === undefined || relationship.nickname === null ? {} : { nickname: relationship.nickname }) }))
      }),
    },
    {
      name: 'discord_read_user_profile',
      description: "Read one person's profile: name, username, bio, pronouns and the servers the account shares with them.",
      parameters: { properties: { userId: { type: 'string', description: 'A user id (fromId of a message, or from discord_search_users)' } }, required: ['userId'] },
      action: (args) => 'read profile ' + str(args, 'userId'),
      run: (args, use) => Effect.map(
        userCall(host, use, 'GET', '/users/' + segment(args, 'userId') + '/profile?with_mutual_guilds=true', Profile),
        (profile) => ({
          id: profile.user.id, name: nameOf(profile.user), username: profile.user.username,
          bio: profile.user_profile?.bio ?? profile.user.bio ?? null,
          pronouns: profile.user_profile?.pronouns ?? null,
          bot: profile.user.bot === true,
          mutualServers: (profile.mutual_guilds ?? []).map((guild) => guild.id),
        }),
      ),
    },
    {
      name: 'discord_send_message_as_user',
      write: true,
      description: "Send a message as the account to a channel or a direct message, or to a person by userId (opens the direct message with them). It appears as written by the account's owner.",
      parameters: { properties: { channelId: CHANNEL_ID, userId: { type: 'string', description: 'Instead of channelId: a person\'s user id' }, text: { type: 'string', description: 'Message text' } }, required: ['text'] },
      action: (args) => 'send to ' + (str(args, 'channelId') === '' ? 'user ' + str(args, 'userId') : str(args, 'channelId')),
      check: oneOf('channelId', 'userId', 'a channel, or a person'),
      run: (args, use) => Effect.gen(function* () {
        const channelId = str(args, 'channelId') !== '' ? str(args, 'channelId') : (yield* userCall(host, use, 'POST', '/users/@me/channels', Channel, { recipients: [str(args, 'userId')] })).id
        const sent = yield* post(use, channelId, str(args, 'text'), '')
        return { sent: true, channel: channelId, messageIds: sent.map((message) => message.id) }
      }),
    },
    {
      name: 'discord_reply_as_user',
      write: true,
      description: 'Reply as the account to a message in its channel (Discord shows it as a reply).',
      parameters: { properties: { channelId: CHANNEL_ID, messageId: MESSAGE_ID, text: { type: 'string', description: 'Message text' } }, required: ['channelId', 'messageId', 'text'] },
      action: (args) => 'reply to ' + str(args, 'messageId'),
      run: (args, use) => Effect.map(post(use, str(args, 'channelId'), str(args, 'text'), str(args, 'messageId')), (sent) => ({ sent: true, channel: str(args, 'channelId'), messageIds: sent.map((message) => message.id) })),
    },
    {
      name: 'discord_add_reaction',
      write: true,
      description: 'React to a message as the account (a unicode emoji, or a custom one as name:id).',
      parameters: { properties: { channelId: CHANNEL_ID, messageId: MESSAGE_ID, emoji: { type: 'string', description: 'The emoji, for example ✅' } }, required: ['channelId', 'messageId', 'emoji'] },
      action: (args) => 'react ' + str(args, 'emoji') + ' to ' + str(args, 'messageId'),
      run: (args, use) => Effect.as(
        userCall(host, use, 'PUT', '/channels/' + segment(args, 'channelId') + '/messages/' + segment(args, 'messageId') + '/reactions/' + segment(args, 'emoji') + '/@me', Ignored),
        { reacted: true },
      ),
    },
    {
      name: 'discord_mark_read',
      write: true,
      description: 'Mark a channel or direct message read up to its latest message, or up to a given message.',
      parameters: { properties: { channelId: CHANNEL_ID, messageId: { type: 'string', description: 'Defaults to the latest message.' } }, required: ['channelId'] },
      action: (args) => 'mark ' + str(args, 'channelId') + ' read',
      run: (args, use) => Effect.gen(function* () {
        let messageId = str(args, 'messageId')
        if (messageId === '') {
          const channel = yield* userCall(host, use, 'GET', '/channels/' + segment(args, 'channelId'), Channel)
          if (channel.last_message_id === undefined || channel.last_message_id === null) return yield* new ConnectorRefused({ message: 'no messages in ' + str(args, 'channelId') + ' to mark read' })
          messageId = channel.last_message_id
        }
        yield* userCall(host, use, 'POST', '/channels/' + segment(args, 'channelId') + '/messages/' + encodeURIComponent(messageId) + '/ack', Ignored, { token: null })
        return { marked: true, channel: str(args, 'channelId'), messageId }
      }),
    },
  ]
  return specs as unknown as ReadonlyArray<ConnectorToolSpec<never>>
}

export const DiscordUserPlugin: ConnectorPlugin = {
  kind: 'discord-user',
  /** A pasted (or captured) token is checked with GET /users/@me before it is stored; a bot token is refused here. */
  verifyPasted(secrets: Readonly<Record<string, string>>, fetch: typeof globalThis.fetch): Effect.Effect<VerifiedConnection, ConnectorFailure> {
    return Effect.flatMap(userCall({ fetch }, { secrets, meta: {} }, 'GET', '/users/@me', User), (me) => (me.bot === true
      ? Effect.fail(new ConnectorRefused({ message: 'this is a bot token: connect it as a bot' }))
      : Effect.succeed({ account: me.username, label: nameOf(me), meta: { userId: me.id } })))
  },
  tools: (host: ConnectorHost) => connectorTools(host, discordUserTools(host)),
  prompt: () => [
    "- Discord as you: these tools act as your owner's own Discord account; what you send appears as written by them. Read tools need no extra grant; sending, replying, reacting and marking read need the write grant.",
    '- There is no unread list: discord_list_user_channels without a server gives the direct messages most recent first. Messages name their author (from, fromId); a thread field gives the id for discord_read_thread.',
    '- If Discord refuses the token, tell your owner to sign in again on the Discord row (As you).',
  ].join('\n'),
}
