/**
 * One Member (a person): profile, preferences, Member files (USER.md and
 * PROACTIVE_PREFERENCES.md, mounted read-only into each of their Robots), and the
 * Member's private secrets, Provider credentials, push subscriptions and usage.
 */
import { HostHub, type HostEntry, type HostAction } from './hosts.ts'
import { GoogleConsents } from './google-consent.ts'
import { CONNECTOR_PLUGINS } from '../connectors/registry.ts'
import { describeConnectorFailure } from '../connectors/connector.ts'
import { ConnectionStore, type ConnectionChange, type ConnectionMeta, type NewConnection, type OwnConnection } from './connections.ts'
import { metaOf, parseEntry, type LoginMeta } from '../platform/logins.ts'
import { DurableObject } from 'cloudflare:workers'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Semaphore from 'effect/Semaphore'
import type { ConnectorKind, NotificationKind, ProviderView, QuietHours, WorkDetails } from '@mr-robot/protocol'
import { sendPush, type DeviceSubscription, type PushFailed, type PushGone, type PushNotification } from '../platform/push.ts'
import { DurableRuntime, invalid, kvDelete, kvGet, kvSet, notFound, Sql, sqlLayer } from '../platform/durable.ts'
import { localDate, zonedTime } from '../robot/schedule.ts'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'
import { HOME_ID, type Env } from '../env.ts'
import { makeVault, type VaultError, type VaultShape } from '../platform/vault.ts'
import type { OpencodeKey } from '../providers/opencode-go.ts'
import { finishPasted, pollDevice, refreshTokens, startFlow, type FlowStart, type OAuthClients, type OAuthTokens, type PendingFlow } from '../providers/oauth.ts'
import { MEMBER_FILES } from '../workspace/templates.ts'

export type MemberFileName = 'USER.md' | 'PROACTIVE_PREFERENCES.md' | 'memory/world.md'
export const MEMBER_FILE_NAMES: readonly MemberFileName[] = ['USER.md', 'PROACTIVE_PREFERENCES.md', 'memory/world.md']

export interface MemberProfile {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly timeZone: string
  readonly quietHours: QuietHours | null
  readonly workDetails?: WorkDetails
}

/** What a Member's programs need besides its SQLite: vaults, sign-in clients, push, the Home and its alarm. */
export interface MemberPlatformShape {
  readonly credentials: VaultShape
  readonly secrets: VaultShape
  readonly oauthClients: OAuthClients
  readonly vapid: { readonly privateKeyHex: string; readonly publicKey: string }
  publishSharing(memberId: string, provider: ProviderId, shared: boolean): Effect.Effect<void>
  getAlarm(): Effect.Effect<number | null>
  setAlarm(at: number): Effect.Effect<void>
  send(vapid: { privateKeyHex: string; publicKey: string; subject: string }, device: DeviceSubscription, notification: PushNotification): Effect.Effect<void, PushGone | PushFailed>
  /** Push to every device now (the DO's overridable delivery). */
  deliverNow(notification: PushNotification): Effect.Effect<void>
  /** Credential pool changes are read-modify-write across awaits: one at a time. */
  readonly poolLock: Semaphore.Semaphore
  /** One OAuth refresh at a time per Provider: the refresh token rotates. */
  readonly refreshing: Map<string, Promise<OAuthTokens>>
}

export class MemberPlatform extends Context.Service<MemberPlatform, MemberPlatformShape>()('mr-robot/MemberPlatform') {}

type R = Sql | MemberPlatform

const promise = <A>(run: () => Promise<A>) => Effect.promise(run)

// ------------------------------------------------------------------ profile

const profile = Effect.gen(function* () {
  const value = yield* kvGet<MemberProfile>('profile')
  if (value === undefined) return yield* notFound('member is not initialised')
  return value
})

const init = (input: { id: string; email: string; name: string }) => Effect.gen(function* () {
  const existing = yield* kvGet<MemberProfile>('profile')
  if (existing !== undefined) return existing
  const sql = yield* Sql
  const created: MemberProfile = { ...input, timeZone: 'Europe/Warsaw', quietHours: null }
  yield* sql.transaction(() => {
    sql.raw.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', 'profile', JSON.stringify(created))
    for (const name of MEMBER_FILE_NAMES) {
      sql.raw.exec('INSERT INTO member_file (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING', name, MEMBER_FILES[name].replace('{{name}}', input.name), Date.now())
    }
  })
  return created
})

const updateProfile = (patch: { name?: string; timeZone?: string; quietHours?: QuietHours | null; workDetails?: WorkDetails }) => Effect.gen(function* () {
  const next = { ...(yield* profile), ...patch }
  yield* kvSet('profile', next)
  return next
})

// ------------------------------------------------------------------ Member files (robot-mj7v)

const file = (name: MemberFileName) => Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.first<{ content: string }>('SELECT content FROM member_file WHERE name = ?', name))?.content ?? ''
})

const files = Effect.gen(function* () {
  return { 'USER.md': yield* file('USER.md'), 'PROACTIVE_PREFERENCES.md': yield* file('PROACTIVE_PREFERENCES.md'), 'memory/world.md': yield* file('memory/world.md') } as Record<MemberFileName, string>
})

const writeFile = (name: MemberFileName, content: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('INSERT INTO member_file (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at', name, content, Date.now())
})

// ------------------------------------------------------------------ Provider credentials (robot-dic7, robot-lzu3, robot-7v9s)

const publish = (provider: ProviderId, shared: boolean) => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  yield* platform.publishSharing((yield* profile).id, provider, shared)
})

const saveCredential = (provider: ProviderId, kind: 'api-key' | 'oauth', sealed: string, shared: boolean, expires: number | null) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run(
    `INSERT INTO credential (provider, kind, sealed, shared, expires, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider) DO UPDATE SET kind = excluded.kind, sealed = excluded.sealed, shared = excluded.shared,
       expires = excluded.expires, updated_at = excluded.updated_at`,
    provider, kind, sealed, shared ? 1 : 0, expires, Date.now(),
  )
})

const providers = Effect.gen(function* () {
  const sql = yield* Sql
  const me = yield* profile
  const rows = yield* sql.all<{ provider: ProviderId; kind: 'api-key' | 'oauth'; shared: number; expires: number | null; updated_at: number }>('SELECT provider, kind, shared, expires, updated_at FROM credential ORDER BY provider')
  return rows.map((row): ProviderView => ({ provider: row.provider, kind: row.kind, shared: row.shared === 1, connectedAt: row.updated_at, ownerId: me.id, ownerName: me.name }))
})

const setApiKey = (provider: ProviderId, key: string, shared: boolean) => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  yield* saveCredential(provider, 'api-key', yield* platform.credentials.seal(JSON.stringify({ key })), shared, null)
  yield* publish(provider, shared)
})

const startOAuth = (provider: 'openai' | 'anthropic') => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  const start = yield* startFlow(platform.oauthClients, provider, Date.now())
  yield* kvSet(`oauth-flow:${provider}`, start.flow)
  return { url: start.url, ...(start.userCode === undefined ? {} : { userCode: start.userCode }) } as Omit<FlowStart, 'flow'>
})

const saveTokens = (provider: ProviderId, tokens: OAuthTokens, shared: boolean) => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  yield* saveCredential(provider, 'oauth', yield* platform.credentials.seal(JSON.stringify(tokens)), shared, tokens.expires)
})

const finishOAuth = (provider: 'openai' | 'anthropic', pasted: string | undefined, shared: boolean) => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  const flow = yield* kvGet<PendingFlow>(`oauth-flow:${provider}`)
  if (flow === undefined || flow.provider !== provider) return yield* invalid('start the sign-in first')
  if (Date.now() - flow.createdAt > 15 * 60_000) return yield* invalid('the sign-in expired; start again')
  const tokens = flow.provider === 'openai' ? yield* pollDevice(platform.oauthClients, flow) : yield* finishPasted(platform.oauthClients, flow, pasted ?? '')
  if (tokens === undefined) return false
  yield* saveTokens(provider, tokens, shared)
  yield* kvDelete(`oauth-flow:${provider}`)
  yield* publish(provider, shared)
  return true
})

const setShared = (provider: ProviderId, shared: boolean) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('UPDATE credential SET shared = ? WHERE provider = ?', shared ? 1 : 0, provider)
  yield* publish(provider, shared)
})

const removeCredential = (provider: ProviderId) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('DELETE FROM credential WHERE provider = ?', provider)
  yield* publish(provider, false)
})

/** Refresh shared by concurrent callers: the second waits for the first instead of spending the rotated token. */
const refreshOnce = (provider: 'openai' | 'anthropic', tokens: OAuthTokens): Effect.Effect<OAuthTokens, unknown, R> => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  const running = platform.refreshing.get(provider)
  if (running !== undefined) return yield* promise(() => running)
  const sql = yield* Sql
  const shared = (yield* sql.first<{ shared: number }>('SELECT shared FROM credential WHERE provider = ?', provider))?.shared === 1
  const services = yield* Effect.context<R>()
  const next = Effect.runPromise(Effect.provideContext(Effect.gen(function* () {
    const fresh = yield* refreshTokens(platform.oauthClients, provider, tokens)
    yield* saveTokens(provider, fresh, shared)
    return fresh
  }), services)).finally(() => platform.refreshing.delete(provider))
  platform.refreshing.set(provider, next)
  return yield* promise(() => next)
})

/**
 * The current credential, refreshed when its access token is about to expire. A request on
 * behalf of another Member's Robot (`forHome`) gets only a credential shared with the Home.
 */
const credential = (provider: ProviderId, forHome: boolean) => Effect.gen(function* () {
  if (provider === 'opencode-go') return null
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const row = yield* sql.first<{ kind: 'api-key' | 'oauth'; sealed: string; shared: number; expires: number | null }>('SELECT kind, sealed, shared, expires FROM credential WHERE provider = ?', provider)
  if (row === undefined || (forHome && row.shared !== 1)) return null
  const data = JSON.parse(yield* platform.credentials.open(row.sealed)) as { key?: string } & Partial<OAuthTokens>
  if (row.kind === 'api-key') return { kind: 'api-key', key: data.key ?? '' } as ProviderCredential
  let tokens = data as OAuthTokens
  if ((row.expires ?? tokens.expires) <= Date.now()) tokens = yield* refreshOnce(provider as 'openai' | 'anthropic', tokens)
  return { kind: 'oauth', access: tokens.access, ...(tokens.accountId === undefined ? {} : { accountId: tokens.accountId }) } as ProviderCredential
})

// ------------------------------------------------------------------ the robot list, per person (robot-mktj)

const listPrefs = Effect.gen(function* () {
  const sql = yield* Sql
  const rows = yield* sql.all<{ robot_id: string; pinned: number; hidden: number; marked_unread: number; seen_at: number | null }>('SELECT * FROM list_pref')
  return Object.fromEntries(rows.map((row) => [row.robot_id, { pinned: row.pinned === 1, hidden: row.hidden === 1, markedUnread: row.marked_unread === 1, seenAt: row.seen_at }])) as Record<string, { pinned: boolean; hidden: boolean; markedUnread: boolean; seenAt: number | null }>
})

const setListPref = (robotId: string, change: { pinned?: boolean; hidden?: boolean; unread?: boolean }) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('INSERT INTO list_pref (robot_id) VALUES (?) ON CONFLICT (robot_id) DO NOTHING', robotId)
  if (change.pinned !== undefined) yield* sql.run('UPDATE list_pref SET pinned = ? WHERE robot_id = ?', change.pinned ? 1 : 0, robotId)
  if (change.hidden !== undefined) yield* sql.run('UPDATE list_pref SET hidden = ? WHERE robot_id = ?', change.hidden ? 1 : 0, robotId)
  if (change.unread !== undefined) yield* sql.run('UPDATE list_pref SET marked_unread = ? WHERE robot_id = ?', change.unread ? 1 : 0, robotId)
})

/** The person opened this Robot's conversation: everything up to now is read. */
const markSeen = (robotId: string, at: number) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('INSERT INTO list_pref (robot_id, seen_at) VALUES (?, ?) ON CONFLICT (robot_id) DO UPDATE SET seen_at = excluded.seen_at, marked_unread = 0', robotId, at)
})

// ------------------------------------------------------------------ private secrets (robot-vplt)

const setSecret = (name: string, value: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const sealed = yield* platform.secrets.seal(value)
  yield* sql.run('INSERT INTO secret (name, sealed, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at', name, sealed, Date.now())
})

const secret = (name: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const row = yield* sql.first<{ sealed: string }>('SELECT sealed FROM secret WHERE name = ?', name)
  return row === undefined ? null : yield* platform.secrets.open(row.sealed)
})

const takeSecret = (name: string) => Effect.gen(function* () {
  const value = yield* secret(name)
  const sql = yield* Sql
  yield* sql.run('DELETE FROM secret WHERE name = ?', name)
  return value
})

const secretNames = Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.all<{ name: string; updated_at: number }>('SELECT name, updated_at FROM secret ORDER BY name')).map((row) => ({ name: row.name, updatedAt: row.updated_at }))
})

/** The Member's login entries without passwords (ticket 05). */
const logins = Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const rows = yield* sql.all<{ name: string; sealed: string; updated_at: number }>('SELECT name, sealed, updated_at FROM secret ORDER BY name')
  return yield* Effect.forEach(rows, (row) => Effect.map(platform.secrets.open(row.sealed), (text) => ({ name: row.name, updatedAt: row.updated_at, ...metaOf(parseEntry(text)) })))
})

// ------------------------------------------------------------------ usage (robot-6jqh)

const addUsage = (month: string, robotId: string, inputTokens: number, outputTokens: number, costUsd: number) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run(
    `INSERT INTO usage (month, robot_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (month, robot_id) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd`,
    month, robotId, inputTokens, outputTokens, costUsd,
  )
})

const usage = (month: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const rows = (yield* sql.all<{ robot_id: string; input_tokens: number; output_tokens: number; cost_usd: number }>('SELECT robot_id, input_tokens, output_tokens, cost_usd FROM usage WHERE month = ?', month))
    .map((row) => ({ robotId: row.robot_id, inputTokens: row.input_tokens, outputTokens: row.output_tokens, costUsd: row.cost_usd }))
  return {
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    byRobot: rows,
  }
})

// ------------------------------------------------------------------ OpenCode Go key pool (ticket 19)

type Pool = { keys: OpencodeKey[]; activeId: string | null }

const poolShared = Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.first<{ shared: number }>("SELECT shared FROM credential WHERE provider = 'opencode-go'"))?.shared
})

const readPool = Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const row = yield* sql.first<{ sealed: string }>("SELECT sealed FROM credential WHERE provider = 'opencode-go'")
  if (row === undefined) return { keys: [], activeId: null } as Pool
  return JSON.parse(yield* platform.credentials.open(row.sealed)) as Pool
})

const writePool = (pool: Pool, shared?: boolean) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const current = yield* poolShared
  const share = shared ?? current === 1
  if (pool.keys.length === 0) {
    yield* sql.run("DELETE FROM credential WHERE provider = 'opencode-go'")
    yield* publish('opencode-go', false)
    return
  }
  yield* saveCredential('opencode-go', 'api-key', yield* platform.credentials.seal(JSON.stringify(pool)), share, null)
  if (current === undefined || shared !== undefined) yield* publish('opencode-go', share)
})

const withPool = <A, E>(change: Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  return yield* platform.poolLock.withPermits(1)(change)
})

const opencodeKeys = Effect.gen(function* () {
  const pool = yield* readPool
  const shared = (yield* poolShared) === 1
  return { keys: pool.keys.map(({ id, key }) => ({ id, masked: `••••${key.length > 8 ? key.slice(-4) : ''}` })), activeId: pool.activeId, shared }
})

const addOpencodeKey = (raw: string, shared?: boolean) => Effect.gen(function* () {
  const key = raw.trim().replace(/,+$/, '')
  if (!/^(?:sk-|oc_sk_)[A-Za-z0-9_-]+$/.test(key)) return yield* invalid('Enter an OpenCode API key without a Bearer prefix or spaces')
  yield* withPool(Effect.gen(function* () {
    const pool = yield* readPool
    if (pool.keys.some((entry) => entry.key === key)) return yield* invalid('This key is already saved')
    const id = crypto.randomUUID()
    pool.keys.push({ id, key })
    pool.activeId ??= id
    yield* writePool(pool, shared)
  }))
})

const activateOpencodeKey = (id: string) => withPool(Effect.gen(function* () {
  const pool = yield* readPool
  if (!pool.keys.some((entry) => entry.id === id)) return yield* notFound('That key no longer exists')
  pool.activeId = id
  yield* writePool(pool)
}))

const removeOpencodeKey = (id: string) => withPool(Effect.gen(function* () {
  const pool = yield* readPool
  pool.keys = pool.keys.filter((entry) => entry.id !== id)
  if (pool.activeId === id) pool.activeId = pool.keys[0]?.id ?? null
  yield* writePool(pool)
}))

/** Keys in the order a request should try them: the session's sticky key or the active one first. */
const opencodeCandidates = (sessionId: string | null, forHome: boolean) => Effect.gen(function* () {
  if (forHome && (yield* poolShared) !== 1) return { keys: [], activeId: null } as Pool
  const pool = yield* readPool
  const sticky = sessionId === null ? undefined : (yield* kvGet<Record<string, string>>('opencode-sticky'))?.[sessionId]
  const first = pool.keys.findIndex((entry) => entry.id === (sticky !== undefined && pool.keys.some((key) => key.id === sticky) ? sticky : pool.activeId))
  return { keys: first < 0 ? pool.keys : [...pool.keys.slice(first), ...pool.keys.slice(0, first)], activeId: pool.activeId }
})

const opencodePromote = (expectedActiveId: string, id: string) => withPool(Effect.gen(function* () {
  const pool = yield* readPool
  if (pool.activeId !== expectedActiveId || !pool.keys.some((entry) => entry.id === id)) return
  pool.activeId = id
  yield* writePool(pool)
}))

const opencodeStick = (sessionId: string, id: string) => Effect.gen(function* () {
  const sticky = (yield* kvGet<Record<string, string>>('opencode-sticky')) ?? {}
  if (sticky[sessionId] === id) return
  yield* kvSet('opencode-sticky', Object.fromEntries(Object.entries({ ...sticky, [sessionId]: id }).slice(-500)))
})

// ------------------------------------------------------------------ Web Push (robot-ajrp, robot-9xoj, robot-bden)

const addPushDevice = (device: DeviceSubscription & { device?: string }) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run(
    `INSERT INTO push_device (endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`,
    device.endpoint, device.keys.p256dh, device.keys.auth, device.device ?? '', Date.now(),
  )
})

const removePushDevice = (endpoint: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('DELETE FROM push_device WHERE endpoint = ?', endpoint)
})

const pushDevices = Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.all<{ endpoint: string; device: string; created_at: number }>('SELECT endpoint, device, created_at FROM push_device ORDER BY created_at'))
    .map((row) => ({ endpoint: row.endpoint, device: row.device, createdAt: row.created_at }))
})

/** When the current quiet window ends, or null when now is outside it. */
const quietUntil = (now: number) => Effect.gen(function* () {
  const me = yield* profile
  const quiet = me.quietHours
  if (quiet === null) return null
  const [startHour, startMinute] = quiet.start.split(':').map(Number) as [number, number]
  const [endHour, endMinute] = quiet.end.split(':').map(Number) as [number, number]
  const local = localDate(now, me.timeZone)
  const minutes = local.hour * 60 + local.minute
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  const inside = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end
  if (!inside) return null
  const endToday = zonedTime(local, endHour, endMinute, me.timeZone)
  return endToday > now ? endToday : endToday + 86_400_000
})

/** Every device now; a device the push service no longer knows is removed. */
const deliver = (notification: PushNotification) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const vapid = { ...platform.vapid, subject: `mailto:${(yield* profile).email}` }
  const devices = yield* sql.all<{ endpoint: string; p256dh: string; auth: string }>('SELECT endpoint, p256dh, auth FROM push_device')
  yield* Effect.forEach(devices, (device) => platform.send(vapid, { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, notification).pipe(
    Effect.catchTag('PushGone', () => removePushDevice(device.endpoint)),
    Effect.catchTag('PushFailed', (error) => Effect.sync(() => console.warn('push failed', error.status))),
  ), { concurrency: 'unbounded', discard: true })
})

/**
 * A Robot wants this Member to hear something. Inside the Member's quiet hours it waits
 * for their end (robot-bden); otherwise it goes to every device now.
 */
const notify = (event: { robotId: string; robotName: string; kind: NotificationKind; body: string }) => Effect.gen(function* () {
  const notification: PushNotification = {
    title: event.kind === 'finished' ? event.robotName : `${event.robotName} ${event.kind === 'needs you' ? 'needs you' : 'is blocked'}`,
    body: event.body.slice(0, 400),
    url: `/#/r/${encodeURIComponent(event.robotId)}`,
    tag: `${event.robotId}-${event.kind}`,
    urgency: event.kind === 'finished' ? 'normal' : 'high',
  }
  const until = yield* quietUntil(Date.now())
  if (until !== null) {
    const sql = yield* Sql
    const platform = yield* MemberPlatform
    yield* sql.run('INSERT INTO pending_notification (deliver_at, notification) VALUES (?, ?)', until, JSON.stringify(notification))
    const alarm = yield* platform.getAlarm()
    if (alarm === null || alarm > until) yield* platform.setAlarm(until)
    return 'deferred' as const
  }
  yield* (yield* MemberPlatform).deliverNow(notification)
  return 'sent' as const
})

/** Quiet hours ended: deliver what waited, and arm for the next. */
const deliverDue = (now: number) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  for (const row of yield* sql.all<{ id: number; notification: string }>('SELECT id, notification FROM pending_notification WHERE deliver_at <= ? ORDER BY id', now)) {
    yield* sql.run('DELETE FROM pending_notification WHERE id = ?', row.id)
    yield* platform.deliverNow(JSON.parse(row.notification) as PushNotification)
  }
  const next = (yield* sql.first<{ at: number | null }>('SELECT MIN(deliver_at) AS at FROM pending_notification'))?.at ?? null
  if (next !== null) yield* platform.setAlarm(next)
})

/** The Member's programs, as run by the Durable Object. */
export const MemberProgram = {
  profile, init, updateProfile, file, files, writeFile, providers, setApiKey, startOAuth, finishOAuth, setShared, removeCredential, credential,
  listPrefs, setListPref, markSeen, setSecret, secret, takeSecret, secretNames, logins, addUsage, usage,
  opencodeKeys, addOpencodeKey, activateOpencodeKey, removeOpencodeKey, opencodeCandidates, opencodePromote, opencodeStick,
  addPushDevice, removePushDevice, pushDevices, notify, deliver, deliverDue,
}

/** Vault failures are not the caller's fault: they surface as defects (500s). */
const orDie = <A, E, X>(effect: Effect.Effect<A, E, X>) => effect.pipe(Effect.catch((error: unknown) => (error !== null && typeof error === 'object' && '_tag' in error && ['NotFound', 'Invalid', 'Conflict'].includes((error as { _tag: string })._tag) ? Effect.fail(error as never) : Effect.die(error)))) as Effect.Effect<A, never, X>

/** The Durable Object: tables, the platform layer, and one RPC method per program. */
export class Member extends DurableObject<Env> {
  private readonly runtime: DurableRuntime<R>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const sql = ctx.storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS member_file (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS list_pref (robot_id TEXT PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, marked_unread INTEGER NOT NULL DEFAULT 0, seen_at INTEGER)')
    sql.exec('CREATE TABLE IF NOT EXISTS secret (name TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS usage (month TEXT NOT NULL, robot_id TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (month, robot_id)) WITHOUT ROWID')
    sql.exec('CREATE TABLE IF NOT EXISTS push_device (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS pending_notification (id INTEGER PRIMARY KEY AUTOINCREMENT, deliver_at INTEGER NOT NULL, notification TEXT NOT NULL)')
    sql.exec(`CREATE TABLE IF NOT EXISTS credential (
      provider TEXT PRIMARY KEY, kind TEXT NOT NULL, sealed TEXT NOT NULL, shared INTEGER NOT NULL, expires INTEGER, updated_at INTEGER NOT NULL
    )`)
    const platform: MemberPlatformShape = {
      credentials: makeVault(env.DATA_KEY, 'credentials'),
      secrets: makeVault(env.DATA_KEY, 'secrets'),
      oauthClients: { openai: env.OPENAI_OAUTH_CLIENT_ID, anthropic: env.ANTHROPIC_OAUTH_CLIENT_ID },
      vapid: { privateKeyHex: env.VAPID_PRIVATE_KEY, publicKey: env.VAPID_PUBLIC_KEY },
      publishSharing: (memberId, provider, shared) => Effect.promise(() => env.HOME.getByName(HOME_ID).credentialShared(memberId, provider, shared)),
      getAlarm: () => Effect.promise(() => ctx.storage.getAlarm()),
      setAlarm: (at) => Effect.promise(() => ctx.storage.setAlarm(at)),
      send: (vapid, device, notification) => sendPush(vapid, device, notification),
      poolLock: Semaphore.makeUnsafe(1),
      refreshing: new Map(),
      // Devices by Web Push, and the desktop app over the host channel (pl-b5vp).
      deliverNow: (notification) => Effect.promise(async () => {
        try { this.hosts.notify({ title: notification.title, body: notification.body, url: notification.url, tag: notification.tag }) } catch (error) { console.warn('host notification failed', error) }
        await this.deliver(notification)
      }),
    }
    this.runtime = new DurableRuntime(Layer.mergeAll(sqlLayer(ctx.storage), Layer.succeed(MemberPlatform)(platform)))
  }

  protected run<A, E>(program: Effect.Effect<A, E, R>): Promise<A> {
    return this.runtime.run(orDie(program))
  }

  init(input: { id: string; email: string; name: string }): Promise<MemberProfile> { return this.run(init(input)) }
  profile(): Promise<MemberProfile> { return this.run(profile) }
  updateProfile(patch: { name?: string; timeZone?: string; quietHours?: QuietHours | null }): Promise<MemberProfile> { return this.run(updateProfile(patch)) }
  file(name: MemberFileName): Promise<string> { return this.run(file(name)) }
  files(): Promise<Record<MemberFileName, string>> { return this.run(files) }
  /** A shared memory file changed: every Robot of this Member hears who changed it (pl-9n7w). */
  async writeFile(name: MemberFileName, content: string, by = 'your owner', exceptRobot?: string): Promise<void> {
    await this.run(writeFile(name, content))
    const memberId = (await this.run(profile)).id
    await this.env.HOME.getByName(HOME_ID).memoryChanged(memberId, name, by, exceptRobot ?? null).catch((error: unknown) => console.warn('memory change not delivered', error))
  }
  providers(): Promise<ProviderView[]> { return this.run(providers) }
  setApiKey(provider: ProviderId, key: string, shared: boolean): Promise<void> { return this.run(setApiKey(provider, key, shared)) }
  startOAuth(provider: 'openai' | 'anthropic'): Promise<Omit<FlowStart, 'flow'>> { return this.run(startOAuth(provider)) }
  finishOAuth(provider: 'openai' | 'anthropic', pasted: string | undefined, shared: boolean): Promise<boolean> { return this.run(finishOAuth(provider, pasted, shared)) }
  setShared(provider: ProviderId, shared: boolean): Promise<void> { return this.run(setShared(provider, shared)) }
  removeCredential(provider: ProviderId): Promise<void> { return this.run(removeCredential(provider)) }
  credential(provider: ProviderId, forHome: boolean): Promise<ProviderCredential | null> { return this.run(credential(provider, forHome)) }
  listPrefs(): Promise<Record<string, { pinned: boolean; hidden: boolean; markedUnread: boolean; seenAt: number | null }>> { return this.run(listPrefs) }
  setListPref(robotId: string, change: { pinned?: boolean; hidden?: boolean; unread?: boolean }): Promise<void> { return this.run(setListPref(robotId, change)) }
  markSeen(robotId: string, at: number): Promise<void> { return this.run(markSeen(robotId, at)) }

  /** Reset everything (pl-062x): memory files back to templates, usage and list preferences gone; credentials, logins and devices stay. */
  async resetData(): Promise<void> {
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM usage')
    sql.exec('DELETE FROM list_pref')
    sql.exec('DELETE FROM pending_notification')
    for (const [name, content] of Object.entries(MEMBER_FILES)) sql.exec('INSERT INTO member_file (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at', name, content, Date.now())
  }
  setSecret(name: string, value: string): Promise<void> { return this.run(setSecret(name, value)) }
  secret(name: string): Promise<string | null> { return this.run(secret(name)) }
  takeSecret(name: string): Promise<string | null> { return this.run(takeSecret(name)) }
  secretNames(): Promise<Array<{ name: string; updatedAt: number }>> { return this.run(secretNames) }
  logins(): Promise<Array<{ name: string; updatedAt: number } & LoginMeta>> { return this.run(logins) }
  async sealedSecretForTest(name: string): Promise<string | undefined> {
    return this.ctx.storage.sql.exec<{ sealed: string }>('SELECT sealed FROM secret WHERE name = ?', name).toArray()[0]?.sealed
  }
  addUsage(month: string, robotId: string, inputTokens: number, outputTokens: number, costUsd: number): Promise<void> { return this.run(addUsage(month, robotId, inputTokens, outputTokens, costUsd)) }
  usage(month: string): Promise<{ inputTokens: number; outputTokens: number; costUsd: number; byRobot: Array<{ robotId: string; inputTokens: number; outputTokens: number; costUsd: number }> }> { return this.run(usage(month)) }
  opencodeKeys(): Promise<{ keys: Array<{ id: string; masked: string }>; activeId: string | null; shared: boolean }> { return this.run(opencodeKeys) }
  addOpencodeKey(raw: string, shared?: boolean): Promise<void> { return this.run(addOpencodeKey(raw, shared)) }
  activateOpencodeKey(id: string): Promise<void> { return this.run(activateOpencodeKey(id)) }
  removeOpencodeKey(id: string): Promise<void> { return this.run(removeOpencodeKey(id)) }
  opencodeCandidates(sessionId: string | null, forHome: boolean): Promise<{ keys: OpencodeKey[]; activeId: string | null }> { return this.run(opencodeCandidates(sessionId, forHome)) }
  opencodePromote(expectedActiveId: string, id: string): Promise<void> { return this.run(opencodePromote(expectedActiveId, id)) }
  opencodeStick(sessionId: string, id: string): Promise<void> { return this.run(opencodeStick(sessionId, id)) }
  addPushDevice(device: DeviceSubscription & { device?: string }): Promise<void> { return this.run(addPushDevice(device)) }
  removePushDevice(endpoint: string): Promise<void> { return this.run(removePushDevice(endpoint)) }
  pushDevices(): Promise<Array<{ endpoint: string; device: string; createdAt: number }>> { return this.run(pushDevices) }
  notify(event: { robotId: string; robotName: string; kind: NotificationKind; body: string }): Promise<'sent' | 'deferred'> { return this.run(notify(event)) }

  override async alarm(): Promise<void> {
    await this.run(deliverDue(Date.now()))
    await this.sweepHosts(Date.now())
  }

  /** Hosts whose heartbeats stopped go offline; the alarm comes back for the next check. */
  async sweepHosts(now: number): Promise<void> {
    const next = await this.hosts.sweep(now)
    if (next !== null) {
      const alarm = await this.ctx.storage.getAlarm()
      if (alarm === null || alarm > next) await this.ctx.storage.setAlarm(next)
    }
  }

  // ---------------------------------------------------------------- Connections (v1.5)

  private connectionStore: ConnectionStore | undefined
  private get connectionsOf(): ConnectionStore {
    this.connectionStore ??= new ConnectionStore(this.ctx.storage.sql, makeVault(this.env.DATA_KEY, 'connections'), async (connection, shared) => {
      const memberId = (await this.profile()).id
      await this.env.HOME.getByName(HOME_ID).connectionShared(memberId, connection, shared)
    }, async () => { await this.env.HOME.getByName(HOME_ID).seedConnectorSkills().catch((error: unknown) => console.warn('connector skills not seeded', error)) })
    return this.connectionStore
  }

  private googleConsents: GoogleConsents | undefined
  private get google(): GoogleConsents {
    this.googleConsents ??= new GoogleConsents(this.ctx.storage.sql, this.connectionsOf, async () => {
      const settings = await this.env.HOME.getByName(HOME_ID).pluginSettings('google')
      const clientId = settings.values['clientId']
      const clientSecret = settings.secrets['clientSecret']
      return typeof clientId === 'string' && clientId !== '' && clientSecret !== undefined ? { clientId, clientSecret } : null
    }, this.connectorFetch())
    return this.googleConsents
  }

  /** fetch for connector sign-ins and token refresh; tests substitute recorded responses. */
  protected connectorFetch(): typeof globalThis.fetch {
    return (input, init) => fetch(input, init)
  }

  /**
   * A connection from pasted values (Slack session, Discord bot token): the connector checks them with
   * the service first (cn-3cnb), so a wrong paste fails here instead of at the first call.
   */
  async connectPasted(input: { kind: ConnectorKind; label: string | null; shared: boolean; services: readonly string[]; secrets: Readonly<Record<string, string>> }): Promise<OwnConnection> {
    const connector = CONNECTOR_PLUGINS[input.kind]
    if (connector?.verifyPasted === undefined) throw new Error(`${input.kind} is not available yet`)
    const outcome = await Effect.runPromise(Effect.result(connector.verifyPasted(input.secrets, this.connectorFetch())))
    if (outcome._tag === 'Failure') throw new Error(outcome.failure._tag === 'ConnectorUnauthorized' ? `the pasted values were refused: ${outcome.failure.message}` : describeConnectorFailure(outcome.failure))
    const added = await this.connectionsOf.add({
      kind: input.kind,
      label: input.label === null || input.label.trim() === '' ? outcome.success.label : input.label.trim(),
      account: outcome.success.account,
      services: input.services,
      shared: input.shared,
      meta: outcome.success.meta,
      secrets: input.secrets,
    })
    // A Discord bot starts listening at once (the Home holds its gateway).
    if (input.kind === 'discord') await this.env.HOME.getByName(HOME_ID).ensureDiscordGateway().catch(() => undefined)
    return added
  }

  startGoogleConsent(origin: string, services: string[], shared: boolean, reconnect: string | null): Promise<string> { return this.google.start(origin, services, shared, reconnect) }
  finishGoogleConsent(origin: string, code: string, state: string): Promise<OwnConnection> { return this.google.finish(origin, code, state) }

  connections(): OwnConnection[] { return this.connectionsOf.list() }
  connection(id: string): OwnConnection | undefined { return this.connectionsOf.get(id) }
  addConnection(input: NewConnection): Promise<OwnConnection> { return this.connectionsOf.add(input) }
  updateConnection(id: string, change: ConnectionChange): Promise<OwnConnection | undefined> { return this.connectionsOf.update(id, change) }
  removeConnection(id: string): Promise<boolean> { return this.connectionsOf.remove(id) }
  /** Secrets and state of a connection for one call; the caller (the Home, for a granted Robot) never keeps them. */
  async useConnection(id: string): Promise<{ connection: OwnConnection; secrets: Record<string, string>; meta: ConnectionMeta } | undefined> {
    const use = await this.connectionsOf.use(id)
    return use !== undefined && use.connection.kind === 'google' ? this.google.fresh(use) : use
  }

  // ---------------------------------------------------------------- Hosts (v1.2)

  /** The Member's computers; built lazily so the tables exist before the first host call. */
  private hostHub: HostHub | undefined
  private get hosts(): HostHub {
    this.hostHub ??= new HostHub(this.ctx, this.env, () => this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM kv WHERE k = 'profile'").toArray().map((row) => (JSON.parse(row.v) as { id: string }).id)[0] ?? '')
    return this.hostHub
  }

  pairHost(name: string, platform: string): Promise<{ hostId: string; token: string }> { return this.hosts.pair(name, platform) }
  hostList(): HostEntry[] { return this.hosts.list() }
  setHostSharing(id: string, sharing: 'private' | 'home'): Promise<void> { return this.hosts.setSharing(id, sharing) }
  unpairHost(id: string): Promise<void> { return this.hosts.unpair(id) }

  hostRead(id: string, robotId: string, path: string) { return this.hosts.run(id, robotId, 'files', (client) => client.Read({ path }), undefined, { action: 'read', detail: path }) }
  hostWrite(id: string, robotId: string, input: { path: string; text?: string; base64?: string }) { return this.hosts.run(id, robotId, 'files', (client) => client.Write(input), undefined, { action: 'write', detail: input.path }) }
  hostRun(id: string, robotId: string, input: { command: string; cwd?: string; timeoutMs?: number }) {
    return this.hosts.run(id, robotId, 'shell', (client) => client.Run(input), Math.min(input.timeoutMs ?? 120_000, 600_000) + 10_000, { action: 'run', detail: input.cwd === undefined ? input.command : `${input.command}  (in ${input.cwd})`, exitCode: (result) => result.exitCode })
  }
  hostActions(id: string): HostAction[] { return this.hosts.actions(id) }
  hostBrowserOpen(id: string, robotId: string, robotName: string): Promise<string> { return this.hosts.openBrowser(id, robotId, robotName) }
  hostBrowserClose(id: string, robotId: string, session: string): Promise<void> { return this.hosts.closeBrowser(id, robotId, session) }

  /** WebSockets: a host's channel, a relay end of a host browser session. */
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path.endsWith('/host/connect')) return this.hosts.connect(request)
    if (path.endsWith('/host/relay')) return this.hosts.relay(request)
    return new Response('not found', { status: 404 })
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.hosts.message(socket, message)
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    try { socket.close(code === 1005 ? 1000 : code) } catch { /* closed */ }
    await this.hosts.closed(socket)
  }

  /** Delivery to devices; a test subclass records instead of sending. */
  protected async deliver(notification: PushNotification): Promise<void> {
    await this.run(deliver(notification))
  }

}
