/**
 * The Slack connector (v1.5 ticket 06, cn-3cnb, cn-clwd, cn-aljt, cn-bxmu): a pasted browser session
 * (xoxc token + d cookie, the flow slkx documents), read tools by default, write tools behind the
 * separate write grant. Tool names follow the official Slack MCP server where it maps to this surface.
 *
 * Slack answers HTTP 200 with {"ok":false,"error":"invalid_auth"} when the session is gone: that sets
 * the connection to "paste again" (cn-bxmu).
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { ConnectorRefused, request, type ConnectorFailure, type ConnectorHost, type ConnectorToolSpec, type ConnectionUse } from './connector.ts'
import { connectorTools, type ConnectorPlugin, type VerifiedConnection } from './connector.ts'

const SLACK = 'https://slack.com/api'

/** Errors that mean the pasted session no longer works, in Slack's own words. */
const AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive', 'invalid_token', 'user_not_found'])

const refused = (status: number, body: unknown): string | null => {
  if (status === 401) return 'the Slack session was refused'
  if (body === null || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  return record['ok'] === false && typeof record['error'] === 'string' && AUTH_ERRORS.has(record['error']) ? 'Slack says ' + record['error'] : null
}

export function slackCall<S extends Schema.Top>(host: ConnectorHost, use: ConnectionUse, method: string, body: Record<string, unknown>, schema: S): Effect.Effect<S['Type'], ConnectorFailure> {
  const token = use.secrets['token'] ?? ''
  const cookie = use.secrets['cookie'] ?? ''
  const headers = {
    authorization: 'Bearer ' + token,
    // The d cookie is what makes a browser token work; slkx sends exactly this pair (plus a JSON body).
    cookie: cookie.includes('=') ? cookie : 'd=' + cookie,
  }
  return Effect.flatMap(
    request(host.fetch, { method: 'POST', url: SLACK + '/' + method, headers, json: body }, schema, refused),
    (answer) => ((answer as { ok?: boolean }).ok === false
      ? Effect.fail(new ConnectorRefused({ message: 'Slack refused ' + method + ': ' + String((answer as { error?: string }).error ?? 'unknown error') }))
      : Effect.succeed(answer)),
  ) as Effect.Effect<S['Type'], ConnectorFailure>
}

const AuthTest = Schema.Struct({ ok: Schema.Boolean, error: Schema.optional(Schema.String), url: Schema.optional(Schema.String), team: Schema.optional(Schema.String), user: Schema.optional(Schema.String), team_id: Schema.optional(Schema.String), user_id: Schema.optional(Schema.String) })
const Channel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  is_private: Schema.optional(Schema.Boolean),
  is_im: Schema.optional(Schema.Boolean),
  is_mpim: Schema.optional(Schema.Boolean),
  num_members: Schema.optional(Schema.Number),
  topic: Schema.optional(Schema.Struct({ value: Schema.optional(Schema.String) })),
  purpose: Schema.optional(Schema.Struct({ value: Schema.optional(Schema.String) })),
  user: Schema.optional(Schema.String),
  latest: Schema.optional(Schema.Struct({ ts: Schema.optional(Schema.String), text: Schema.optional(Schema.String) })),
  last_read: Schema.optional(Schema.String),
})
type Channel = typeof Channel.Type
const EnvelopeFields = { ok: Schema.Boolean, error: Schema.optional(Schema.String) }
const Channels = Schema.Struct({ ...EnvelopeFields, channels: Schema.optional(Schema.Array(Channel)), response_metadata: Schema.optional(Schema.Struct({ next_cursor: Schema.optional(Schema.String) })) })
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  real_name: Schema.optional(Schema.String),
  deleted: Schema.optional(Schema.Boolean),
  is_bot: Schema.optional(Schema.Boolean),
  profile: Schema.optional(Schema.Struct({ display_name: Schema.optional(Schema.String), real_name: Schema.optional(Schema.String), email: Schema.optional(Schema.String), title: Schema.optional(Schema.String), phone: Schema.optional(Schema.String) })),
})
type User = typeof User.Type
const Users = Schema.Struct({ ...EnvelopeFields, members: Schema.optional(Schema.Array(User)), response_metadata: Schema.optional(Schema.Struct({ next_cursor: Schema.optional(Schema.String) })) })
const Message = Schema.Struct({
  ts: Schema.String,
  user: Schema.optional(Schema.String),
  bot_id: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  thread_ts: Schema.optional(Schema.String),
  reply_count: Schema.optional(Schema.Number),
  reactions: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, count: Schema.Number }))),
  files: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String), mimetype: Schema.optional(Schema.String) }))),
  subtype: Schema.optional(Schema.String),
})
type Message = typeof Message.Type
const History = Schema.Struct({ ...EnvelopeFields, messages: Schema.optional(Schema.Array(Message)), has_more: Schema.optional(Schema.Boolean) })
const CountEntry = Schema.Struct({ id: Schema.String, has_unreads: Schema.optional(Schema.Boolean), mention_count: Schema.optional(Schema.Number), unread_count_display: Schema.optional(Schema.Number), last_read: Schema.optional(Schema.String), latest: Schema.optional(Schema.String) })
const Counts = Schema.Struct({ ...EnvelopeFields, channels: Schema.optional(Schema.Array(CountEntry)), groups: Schema.optional(Schema.Array(CountEntry)), mpims: Schema.optional(Schema.Array(CountEntry)), ims: Schema.optional(Schema.Array(CountEntry)) })
const Posted = Schema.Struct({ ...EnvelopeFields, ts: Schema.optional(Schema.String), channel: Schema.optional(Schema.String), message: Schema.optional(Schema.Struct({ ts: Schema.optional(Schema.String), text: Schema.optional(Schema.String) })) })
const Marked = Schema.Struct({ ...EnvelopeFields })
const SingleUser = Schema.Struct({ ...EnvelopeFields, user: Schema.optional(User) })
const Found = Schema.Struct({ ...EnvelopeFields, messages: Schema.optional(Schema.Struct({ matches: Schema.optional(Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String), ts: Schema.optional(Schema.String), channel: Schema.optional(Schema.Struct({ id: Schema.optional(Schema.String), name: Schema.optional(Schema.String) })), username: Schema.optional(Schema.String), permalink: Schema.optional(Schema.String) }))), total: Schema.optional(Schema.Number) })) })

type Args = Record<string, unknown>
const str = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')
const num = (args: Args, key: string, fallback: number, max: number): number => Math.min(Math.max(Number(args[key] ?? fallback) || fallback, 1), max)

const userNames = (users: readonly User[], ids: readonly string[]): Record<string, string> => {
  const wanted = new Set(ids)
  return Object.fromEntries(users.filter((user) => wanted.has(user.id)).map((user) => [user.id, user.profile?.display_name || user.real_name || user.name || user.id]))
}

const shown = (message: Message, names: Record<string, string>) => ({
  ts: message.ts,
  at: new Date(Number(message.ts) * 1000).toISOString(),
  from: message.user === undefined ? (message.bot_id === undefined ? message.username ?? 'unknown' : 'bot ' + message.bot_id) : names[message.user] ?? message.user,
  text: message.text ?? '',
  ...(message.thread_ts === undefined || message.thread_ts === message.ts ? {} : { inThread: message.thread_ts }),
  ...(message.reply_count === undefined ? {} : { replies: message.reply_count }),
  ...(message.reactions === undefined ? {} : { reactions: message.reactions.map((reaction) => ':' + reaction.name + ': ' + reaction.count) }),
  ...(message.files === undefined ? {} : { files: message.files.map((file) => ({ id: file.id, name: file.name ?? file.id, type: file.mimetype ?? null })) }),
  ...(message.subtype === undefined ? {} : { subtype: message.subtype }),
})

const channelLabel = (channel: Channel): string => (channel.is_im === true ? ('DM ' + (channel.user ?? '')).trim() : channel.is_mpim === true ? 'group ' + (channel.name ?? channel.id) : '#' + (channel.name ?? channel.id))

export function slackTools(host: ConnectorHost): ReadonlyArray<ConnectorToolSpec<never>> {
  /** The workspace's channels and people, one page each: for names, and for local search. */
  const directory = (use: ConnectionUse) => Effect.gen(function* () {
    const channels = yield* slackCall(host, use, 'conversations.list', { types: 'public_channel,private_channel,mpim,im', limit: 1000, exclude_archived: true }, Channels)
    const users = yield* slackCall(host, use, 'users.list', { limit: 200 }, Users)
    return { channels: channels.channels ?? [], users: users.members ?? [] }
  })
  const specs: Array<ConnectorToolSpec<Args>> = [
    {
      name: 'slack_list_user_channels',
      service: 'slack',
      description: 'List the channels and direct messages of the workspace with their unread counts, most recent activity first.',
      parameters: { properties: { max: { type: 'number', description: 'At most this many (default 100).' } } },
      action: () => 'list channels',
      run: (args, use) => Effect.gen(function* () {
        const listed = yield* slackCall(host, use, 'conversations.list', { types: 'public_channel,private_channel,mpim,im', limit: 200, exclude_archived: true }, Channels)
        const counts = yield* slackCall(host, use, 'client.counts', {}, Counts)
        const unread = new Map([...(counts.channels ?? []), ...(counts.groups ?? []), ...(counts.mpims ?? []), ...(counts.ims ?? [])].map((entry) => [entry.id, entry]))
        return (listed.channels ?? []).slice(0, num(args, 'max', 100, 1000)).map((channel) => {
          const count = unread.get(channel.id)
          return {
            id: channel.id, channel: channelLabel(channel), private: channel.is_private === true, members: channel.num_members ?? null,
            unread: count?.unread_count_display ?? 0,
            ...(count?.mention_count === undefined ? {} : { mentions: count.mention_count }),
            lastRead: count?.last_read ?? channel.last_read ?? null,
            ...(channel.latest?.text === undefined ? {} : { latest: channel.latest.text }),
          }
        })
      }),
    },
    {
      name: 'slack_list_unreads',
      service: 'slack',
      description: 'What is unread: every channel, group and direct message with unread messages, how many, and when the last one arrived (slkx reads this the same way).',
      parameters: { properties: { withChannels: { type: 'boolean', description: 'Name each channel (one extra call); default true.' } } },
      action: () => 'list unreads',
      run: (args, use) => Effect.gen(function* () {
        const counts = yield* slackCall(host, use, 'client.counts', {}, Counts)
        const entries = [...(counts.channels ?? []), ...(counts.groups ?? []), ...(counts.mpims ?? []), ...(counts.ims ?? [])]
          .filter((entry) => entry.has_unreads === true || (entry.mention_count ?? 0) > 0 || (entry.unread_count_display ?? 0) > 0)
        const labels = new Map<string, string>()
        if (args['withChannels'] !== false && entries.length > 0) {
          const listed = yield* slackCall(host, use, 'conversations.list', { types: 'public_channel,private_channel,mpim,im', limit: 1000, exclude_archived: true }, Channels)
          for (const channel of listed.channels ?? []) labels.set(channel.id, channelLabel(channel))
        }
        return entries.map((entry) => ({
          id: entry.id, channel: labels.get(entry.id) ?? entry.id,
          unread: entry.unread_count_display ?? 0, mentions: entry.mention_count ?? 0,
          lastRead: entry.last_read ?? null,
          ...(entry.latest === undefined ? {} : { latestAt: new Date(Number(entry.latest) * 1000).toISOString() }),
        }))
      }),
    },
    {
      name: 'slack_read_channel',
      service: 'slack',
      description: "Read a channel's recent messages, newest first (slack_list_user_channels gives the ids).",
      parameters: { properties: { channel: { type: 'string' }, limit: { type: 'number' }, oldest: { type: 'string', description: 'A ts or ISO time: only messages after it.' }, latest: { type: 'string' } }, required: ['channel'] },
      action: (args) => 'read ' + str(args, 'channel'),
      run: (args, use) => Effect.gen(function* () {
        const history = yield* slackCall(host, use, 'conversations.history', {
          channel: str(args, 'channel'), limit: num(args, 'limit', 50, 200),
          ...(str(args, 'oldest') === '' ? {} : { oldest: str(args, 'oldest') }),
          ...(str(args, 'latest') === '' ? {} : { latest: str(args, 'latest') }),
        }, History)
        const messages = history.messages ?? []
        const users = yield* slackCall(host, use, 'users.list', { limit: 200 }, Users)
        const names = userNames(users.members ?? [], messages.flatMap((entry) => (entry.user === undefined ? [] : [entry.user])))
        return { channel: str(args, 'channel'), hasMore: history.has_more ?? false, messages: messages.map((message) => shown(message, names)) }
      }),
    },
    {
      name: 'slack_read_thread',
      service: 'slack',
      description: 'Read a thread: the parent message and its replies, oldest first.',
      parameters: { properties: { channel: { type: 'string' }, threadTs: { type: 'string' }, limit: { type: 'number' } }, required: ['channel', 'threadTs'] },
      action: (args) => 'read thread ' + str(args, 'threadTs') + ' in ' + str(args, 'channel'),
      run: (args, use) => Effect.gen(function* () {
        const replies = yield* slackCall(host, use, 'conversations.replies', { channel: str(args, 'channel'), ts: str(args, 'threadTs'), limit: num(args, 'limit', 100, 200) }, History)
        const messages = replies.messages ?? []
        const users = yield* slackCall(host, use, 'users.list', { limit: 200 }, Users)
        const names = userNames(users.members ?? [], messages.flatMap((entry) => (entry.user === undefined ? [] : [entry.user])))
        return { channel: str(args, 'channel'), messages: messages.map((message) => shown(message, names)) }
      }),
    },
    {
      name: 'slack_search_channels',
      service: 'slack',
      description: 'Find channels and direct messages by name, topic or purpose.',
      parameters: { properties: { query: { type: 'string' }, max: { type: 'number' } }, required: ['query'] },
      action: (args) => 'search channels "' + str(args, 'query') + '"',
      run: (args, use) => Effect.gen(function* () {
        const found = yield* directory(use)
        const needle = str(args, 'query').toLowerCase().replace(/^#/, '')
        return found.channels
          .filter((channel) => [channel.name, channel.topic?.value, channel.purpose?.value, channel.user].some((value) => (value ?? '').toLowerCase().includes(needle)))
          .slice(0, num(args, 'max', 20, 200))
          .map((channel) => ({ id: channel.id, channel: channelLabel(channel), private: channel.is_private === true, members: channel.num_members ?? null, ...(channel.purpose?.value === undefined || channel.purpose.value === '' ? {} : { purpose: channel.purpose.value }) }))
      }),
    },
    {
      name: 'slack_search_users',
      service: 'slack',
      description: 'Find people by name, display name or e-mail address.',
      parameters: { properties: { query: { type: 'string' }, max: { type: 'number' } }, required: ['query'] },
      action: (args) => 'search people "' + str(args, 'query') + '"',
      run: (args, use) => Effect.gen(function* () {
        const found = yield* directory(use)
        const needle = str(args, 'query').toLowerCase().replace(/^@/, '')
        return found.users
          .filter((user) => user.deleted !== true && [user.name, user.real_name, user.profile?.display_name, user.profile?.real_name, user.profile?.email].some((value) => (value ?? '').toLowerCase().includes(needle)))
          .slice(0, num(args, 'max', 20, 200))
          .map((user) => ({ id: user.id, name: user.profile?.display_name || user.real_name || user.name || user.id, username: user.name ?? null, bot: user.is_bot === true, ...(user.profile?.title === undefined ? {} : { title: user.profile.title }), ...(user.profile?.email === undefined ? {} : { email: user.profile.email }) }))
      }),
    },
    {
      name: 'slack_read_user_profile',
      service: 'slack',
      description: "Read one person's profile: display name, username, title, e-mail and phone.",
      parameters: { properties: { user: { type: 'string', description: 'A user id (U…) or a name as slack_search_users shows it.' } }, required: ['user'] },
      action: (args) => 'read profile ' + str(args, 'user'),
      run: (args, use) => Effect.gen(function* () {
        let id = str(args, 'user')
        if (!/^[UW][A-Z0-9]+$/.test(id)) {
          const found = yield* directory(use)
          const needle = id.toLowerCase().replace(/^@/, '')
          const matches = (user: User) => [user.name, user.real_name, user.profile?.display_name, user.profile?.real_name].some((value) => (value ?? '').toLowerCase() === needle)
          const near = (user: User) => [user.name, user.real_name, user.profile?.display_name, user.profile?.real_name].some((value) => (value ?? '').toLowerCase().includes(needle))
          const who = found.users.find(matches) ?? found.users.find(near)
          if (who === undefined) return yield* new ConnectorRefused({ message: 'no one here matches "' + id + '"; use slack_search_users' })
          id = who.id
        }
        const answer = yield* slackCall(host, use, 'users.info', { user: id }, SingleUser)
        const user = answer.user
        if (user === undefined) return yield* new ConnectorRefused({ message: 'Slack has no user ' + id })
        return { id: user.id, name: user.profile?.display_name || user.real_name || user.name || user.id, username: user.name ?? null, realName: user.real_name ?? null, title: user.profile?.title ?? null, email: user.profile?.email ?? null, phone: user.profile?.phone ?? null, bot: user.is_bot === true, deleted: user.deleted === true }
      }),
    },
    {
      name: 'slack_search_public_and_private',
      service: 'slack',
      description: 'Search messages across the workspace channels and direct messages (Slack search syntax, e.g. "from:@anna invoice", "in:#finance budget").',
      parameters: { properties: { query: { type: 'string' }, max: { type: 'number' } }, required: ['query'] },
      action: (args) => 'search messages "' + str(args, 'query') + '"',
      run: (args, use) => Effect.map(
        slackCall(host, use, 'search.messages', { query: str(args, 'query'), count: num(args, 'max', 20, 100), sort: 'timestamp' }, Found),
        (result) => ({ total: result.messages?.total ?? 0, matches: (result.messages?.matches ?? []).map((match) => ({ text: match.text ?? '', channel: match.channel?.name ?? match.channel?.id ?? '', from: match.username ?? '', at: match.ts === undefined ? '' : new Date(Number(match.ts) * 1000).toISOString(), ...(match.permalink === undefined ? {} : { link: match.permalink }) })) }),
      ),
    },
    {
      name: 'slack_send_message',
      service: 'slack',
      write: true,
      description: 'Send a message to a channel or a direct message, or reply in a thread by giving threadTs.',
      parameters: { properties: { channel: { type: 'string' }, text: { type: 'string' }, threadTs: { type: 'string' } }, required: ['channel', 'text'] },
      action: (args) => (str(args, 'threadTs') === '' ? 'send to ' : 'reply in ') + str(args, 'channel'),
      run: (args, use) => Effect.map(
        slackCall(host, use, 'chat.postMessage', { channel: str(args, 'channel'), text: str(args, 'text'), ...(str(args, 'threadTs') === '' ? {} : { thread_ts: str(args, 'threadTs') }), unfurl_links: false }, Posted),
        (posted) => ({ sent: true, channel: posted.channel ?? str(args, 'channel'), ts: posted.ts ?? posted.message?.ts ?? null, ...(str(args, 'threadTs') === '' ? {} : { threadTs: str(args, 'threadTs') }) }),
      ),
    },
    {
      name: 'slack_mark_read',
      service: 'slack',
      write: true,
      description: 'Mark a channel read up to now, or up to a given ts.',
      parameters: { properties: { channel: { type: 'string' }, ts: { type: 'string', description: 'Defaults to the latest activity.' } }, required: ['channel'] },
      action: (args) => 'mark ' + str(args, 'channel') + ' read',
      run: (args, use) => Effect.gen(function* () {
        let ts = str(args, 'ts')
        if (ts === '') {
          const counts = yield* slackCall(host, use, 'client.counts', {}, Counts)
          const entry = [...(counts.channels ?? []), ...(counts.groups ?? []), ...(counts.mpims ?? []), ...(counts.ims ?? [])].find((candidate) => candidate.id === str(args, 'channel'))
          ts = entry?.latest ?? ''
          if (ts === '') return yield* new ConnectorRefused({ message: 'nothing recent in ' + str(args, 'channel') + '; give a ts' })
        }
        yield* slackCall(host, use, 'conversations.mark', { channel: str(args, 'channel'), ts }, Marked)
        return { marked: true, channel: str(args, 'channel'), ts }
      }),
    },
  ]
  return specs as unknown as ReadonlyArray<ConnectorToolSpec<never>>
}

export const SlackPlugin: ConnectorPlugin = {
  kind: 'slack',
  /** Pasted values are checked with auth.test before they are stored (cn-3cnb). */
  verifyPasted(secrets: Readonly<Record<string, string>>, fetch: typeof globalThis.fetch): Effect.Effect<VerifiedConnection, ConnectorFailure> {
    // SAFETY: verifyPasted only makes the connector's HTTP calls; the other host members are unused here.
    const probe = { fetch } as ConnectorHost
    return Effect.map(slackCall(probe, { secrets, meta: {} }, 'auth.test', {}, AuthTest), (answer) => {
      const domain = (answer.url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
      return {
        account: domain === '' ? (answer.team ?? 'slack') : domain,
        label: answer.team ?? (domain === '' ? 'Slack' : domain),
        meta: { teamId: answer.team_id ?? null, userId: answer.user_id ?? null, user: answer.user ?? null, team: answer.team ?? null },
      }
    })
  },
  tools: (host: ConnectorHost) => connectorTools(host, slackTools(host) as never),
  prompt: () => [
    '- Slack: read tools need no extra grant; posting and marking read need the separate write grant.',
    '- Reading a channel or a thread answers with people\'s names, not raw ids. Send to a channel id from slack_list_user_channels or slack_search_channels.',
    '- If Slack says the session is gone, tell your owner to paste the token and cookie again on the Slack row.',
  ].join('\n'),
}
