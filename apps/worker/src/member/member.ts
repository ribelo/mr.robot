/**
 * One Member (a person): profile, preferences, Member files (USER.md and
 * PROACTIVE_PREFERENCES.md, mounted read-only into each of their Robots), and the
 * Member's private secrets, Provider credentials, push subscriptions and usage.
 */
import * as Schema from 'effect/Schema'
import { hostPartDeadlineMs, RUN_MAX_WAIT_SECONDS, type UploadPart } from '@mr-robot/host-protocol'
import type { Reach } from '../places/host-facet.ts'
import { HostHub, jobRef, type HostEntry, type HostAction, type HostRunAnswer } from './hosts.ts'
import { replyOf, type HostCallReply } from './host-call.ts'
import { GoogleConsents } from './google-consent.ts'
import { CONNECTOR_PLUGINS } from '../connectors/registry.ts'
import { describeConnectorFailure } from '../connectors/connector.ts'
import { actsAsPerson } from '../plugins/catalog.ts'
import { ConnectionStore, type ConnectionChange, type ConnectionMeta, type NewConnection, type OwnConnection } from './connections.ts'
import { metaOf, parseEntry, type LoginMeta } from '../platform/logins.ts'
import { DurableObject } from 'cloudflare:workers'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Semaphore from 'effect/Semaphore'
import { probeAccount, type Probe } from '../providers/usage.ts'
import type { AccountStatus, AccountUsage, ConnectorKind, GroupPatch, ListPrefPatch, MissionPrefs, NotificationKind, ProviderView, QuietHours, RobotGroup, RobotOwner, ThemeChoice, WorkDetails } from '@mr-robot/protocol'
import { costBreakdown, DEFAULT_MISSION_PREFS, type CostBreakdown, type UsageSource } from '@mr-robot/protocol'
import { sendPush, type DeviceSubscription, type PushFailed, type PushGone, type PushNotification } from '../platform/push.ts'
import { DurableRuntime, invalid, kvDelete, kvGet, kvSet, notFound, Sql, sqlLayer } from '../platform/durable.ts'
import { localDate, zonedTime } from '../robot/schedule.ts'
import { DEFAULT_TIME_ZONE, parseTimeZone } from '../robot/time-zone.ts'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'
import { HOME_ID, type Env } from '../env.ts'
import { makeVault, type VaultError, type VaultShape } from '../platform/vault.ts'
import { finishPasted, pollDevice, refreshTokens, startFlow, type FlowStart, type OAuthClients, type OAuthTokens, type PendingFlow } from '../providers/oauth.ts'
import { MEMBER_FILES } from '../workspace/templates.ts'
import { mintShareToken, sharedPagePath, shareTokenHash } from '../pages/share-token.ts'
import type { SharedPageView } from '@mr-robot/protocol'

type SharedPageRow = {
  readonly token_hash: string
  readonly robot_id: string
  readonly path: string
  readonly title: string
  readonly sealed_token: string
  readonly created_at: number
}

export type MemberFileName = 'USER.md' | 'PROACTIVE_PREFERENCES.md' | 'memory/world.md'
export const MEMBER_FILE_NAMES: readonly MemberFileName[] = ['USER.md', 'PROACTIVE_PREFERENCES.md', 'memory/world.md']

export interface MemberProfile {
  readonly id: string
  readonly email: string
  readonly name: string
  /** How the Member's Robots address them (ux-i8ff); trimmed, never empty. Absent: by their name. */
  readonly nickname?: string
  /** The zone the owner's Robots work in: the app's zone, unless pinned. */
  readonly timeZone: string
  /** The person set the zone by hand; the app's zone no longer replaces it. Absent: not pinned. */
  readonly timeZonePinned?: boolean
  /** The zone the app last reported; absent before the first report. */
  readonly detectedTimeZone?: string
  readonly quietHours: QuietHours | null
  readonly workDetails?: WorkDetails
  readonly theme?: ThemeChoice
  /** The Members whose Robots may give this Member Tasks (mc-a1aa); absent: nobody's. */
  readonly acceptTasksFrom?: readonly string[]
  /** Mission Control as the Member left it; absent: the defaults. */
  readonly mission?: MissionPrefs
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
  /** Push to every device now (the DO's overridable delivery), and show it on the computers named, or on every computer when none is (ob-6jr5). */
  deliverNow(notification: PushNotification, hosts: readonly string[]): Effect.Effect<void>
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
  const created: MemberProfile = { ...input, timeZone: DEFAULT_TIME_ZONE, quietHours: null }
  yield* sql.transaction(() => {
    sql.raw.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', 'profile', JSON.stringify(created))
    for (const name of MEMBER_FILE_NAMES) {
      sql.raw.exec('INSERT INTO member_file (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING', name, MEMBER_FILES[name].replace('{{name}}', input.name), Date.now())
    }
  })
  return created
})

/**
 * What a person can change on the profile. A `timeZone` is typed by hand and pins; `useDetectedTimeZone`
 * unpins. A `nickname` replaces the stored one; a blank one removes it.
 */
export interface ProfilePatch {
  readonly name?: string
  readonly nickname?: string
  readonly timeZone?: string
  readonly useDetectedTimeZone?: true
  readonly quietHours?: QuietHours | null
  readonly workDetails?: WorkDetails
  readonly theme?: ThemeChoice
  readonly mission?: Partial<MissionPrefs>
  readonly acceptTasksFrom?: readonly string[]
}

const updateProfile = (patch: ProfilePatch) => Effect.gen(function* () {
  const current = yield* profile
  const { timeZone, useDetectedTimeZone, nickname, mission, ...rest } = patch
  if (timeZone !== undefined && useDetectedTimeZone === true) return yield* invalid('give a time zone or ask for the app\'s zone, not both')
  const typed = timeZone === undefined ? undefined : parseTimeZone(timeZone)
  if (timeZone !== undefined && typed === undefined) return yield* invalid(`"${timeZone}" is not a time zone; use a name like Europe/Warsaw`)
  const zone: Partial<MemberProfile> =
    typed !== undefined ? { timeZone: typed, timeZonePinned: true }
      : useDetectedTimeZone === true ? { timeZonePinned: false, ...(current.detectedTimeZone === undefined ? {} : { timeZone: current.detectedTimeZone }) }
        : {}
  const { nickname: kept, ...others } = current
  const named = nickname === undefined ? kept : nickname.trim()
  const next: MemberProfile = {
    ...others, ...(named === undefined || named === '' ? {} : { nickname: named }), ...rest, ...zone,
    ...(mission === undefined ? {} : { mission: { ...DEFAULT_MISSION_PREFS, ...current.mission, ...mission } }),
  }
  yield* kvSet('profile', next)
  return next
})

/** The Member as their Robots name them (ux-nwi1). */
export const robotOwner = (profile: MemberProfile): RobotOwner =>
  profile.nickname === undefined ? { name: profile.name } : { name: profile.name, nickname: profile.nickname }

/** The app reported its zone: it becomes the profile zone unless the person pinned one. */
const detectTimeZone = (zone: string) => Effect.gen(function* () {
  const current = yield* profile
  const adopt = current.timeZonePinned !== true
  if (current.detectedTimeZone === zone && (!adopt || current.timeZone === zone)) return current
  const next = { ...current, detectedTimeZone: zone, ...(adopt ? { timeZone: zone } : {}) }
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

// ------------------------------------------------------------------ Provider accounts (robot-dic7, v1.10 ticket 02)

/** One stored account of a Provider; the secret stays sealed until a request needs it. */
type AccountRow = {
  id: string; provider: ProviderId; label: string; kind: 'api-key' | 'oauth'; sealed: string; shared: number; expires: number | null
  status: AccountStatus; note: string | null; until: number | null; checked_at: number | null; notified: number; created_at: number; updated_at: number
}

/** Whether any account of this Provider is shared, as the Home indexes it. */
const publish = (provider: ProviderId) => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  const sql = yield* Sql
  const shared = (yield* sql.first<{ n: number }>('SELECT COUNT(*) AS n FROM account WHERE provider = ? AND shared = 1', provider))?.n ?? 0
  yield* platform.publishSharing((yield* profile).id, provider, shared > 0)
})

/**
 * Credentials and OpenCode Go keys stored before accounts existed become accounts once (pa-mdlk):
 * each credential one account, each pool key one account.
 */
const migrateAccounts = Effect.gen(function* () {
  if ((yield* kvGet<boolean>('accounts-migrated')) === true) return
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const old = yield* sql.all<{ provider: ProviderId; kind: 'api-key' | 'oauth'; sealed: string; shared: number; expires: number | null; updated_at: number }>('SELECT * FROM credential')
  for (const row of old) {
    if (row.provider === 'opencode-go') {
      const pool = JSON.parse(yield* platform.credentials.open(row.sealed)) as { keys: Array<{ id: string; key: string }> }
      for (const entry of pool.keys) yield* insertAccount('opencode-go', keyLabel(entry.key), 'api-key', yield* platform.credentials.seal(JSON.stringify({ key: entry.key })), row.shared === 1, null)
    } else {
      const label = row.kind === 'oauth' ? `${PROVIDER_LABELS[row.provider]} 1` : keyLabel((JSON.parse(yield* platform.credentials.open(row.sealed)) as { key?: string }).key ?? '')
      yield* insertAccount(row.provider, label, row.kind, row.sealed, row.shared === 1, row.expires)
    }
  }
  yield* sql.run('DELETE FROM credential')
  yield* kvSet('accounts-migrated', true)
})

const PROVIDER_LABELS: Record<ProviderId, string> = { deepseek: 'DeepSeek', openrouter: 'OpenRouter', 'workers-ai': 'Workers AI', openai: 'ChatGPT', anthropic: 'Claude', 'opencode-go': 'OpenCode Go' }

const keyLabel = (key: string) => `Key ••••${key.length > 8 ? key.slice(-4) : ''}`

const insertAccount = (provider: ProviderId, label: string, kind: 'api-key' | 'oauth', sealed: string, shared: boolean, expires: number | null) => Effect.gen(function* () {
  const sql = yield* Sql
  const id = `acc-${crypto.randomUUID()}`
  const now = Date.now()
  yield* sql.run(
    "INSERT INTO account (id, provider, label, kind, sealed, shared, expires, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?)",
    id, provider, label, kind, sealed, shared ? 1 : 0, expires, now, now,
  )
  return id
})

const accountView = (row: AccountRow, me: MemberProfile, signedInAs?: string): ProviderView => ({
  id: row.id, provider: row.provider, label: row.label, kind: row.kind, shared: row.shared === 1, connectedAt: row.created_at,
  ownerId: me.id, ownerName: me.name, status: row.status, note: row.note, until: row.until,
  ...(signedInAs === undefined ? {} : { signedInAs }),
})

/** The address inside a sealed OAuth token, when the Provider reported one. */
const tokenEmail = (sealed: string) => Effect.map(
  Effect.flatMap(MemberPlatform, (platform) => platform.credentials.open(sealed)),
  (text) => { const email = (JSON.parse(text) as { email?: unknown }).email; return typeof email === 'string' && email !== '' ? email : undefined },
)

/** The Member's accounts, oldest first; `sharedOnly` for another Member's view (pa-f281). The owner also sees whose address each subscription token carries. */
const accounts = (sharedOnly = false) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const me = yield* profile
  const rows = yield* sql.all<AccountRow>(`SELECT * FROM account ${sharedOnly ? 'WHERE shared = 1 ' : ''}ORDER BY created_at, rowid`)
  const views: ProviderView[] = []
  for (const row of rows) views.push(accountView(row, me, sharedOnly || row.kind !== 'oauth' ? undefined : yield* tokenEmail(row.sealed)))
  return views
})

/** Keys are checked for shape only; a wrong key shows up as a broken account at its first use. */
const addApiKey = (provider: ProviderId, raw: string, shared: boolean, label?: string) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const key = raw.trim().replace(/^Bearer\s+/i, '').replace(/,+$/, '')
  if (provider === 'opencode-go' ? !/^(?:sk-|oc_sk_)[A-Za-z0-9_-]+$/.test(key) : key.length < 8 || /\s/.test(key)) return yield* invalid(provider === 'opencode-go' ? 'Enter an OpenCode API key without a Bearer prefix or spaces' : 'that does not look like an API key')
  for (const row of yield* sql.all<{ sealed: string }>("SELECT sealed FROM account WHERE provider = ? AND kind = 'api-key'", provider)) {
    if ((JSON.parse(yield* platform.credentials.open(row.sealed)) as { key?: string }).key === key) return yield* invalid('This key is already saved')
  }
  const id = yield* insertAccount(provider, label?.trim() || keyLabel(key), 'api-key', yield* platform.credentials.seal(JSON.stringify({ key })), shared, null)
  yield* publish(provider)
  return id
})

const startOAuth = (provider: 'openai' | 'anthropic') => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  const start = yield* startFlow(platform.oauthClients, provider, Date.now())
  yield* kvSet(`oauth-flow:${provider}`, start.flow)
  return { url: start.url, ...(start.userCode === undefined ? {} : { userCode: start.userCode }) } as Omit<FlowStart, 'flow'>
})

/** A finished sign-in adds an account, or renews the account of the same address (pa-i3le). */
const finishOAuth = (provider: 'openai' | 'anthropic', pasted: string | undefined, shared: boolean) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  const flow = yield* kvGet<PendingFlow>(`oauth-flow:${provider}`)
  if (flow === undefined || flow.provider !== provider) return yield* invalid('start the sign-in first')
  if (Date.now() - flow.createdAt > 15 * 60_000) return yield* invalid('the sign-in expired; start again')
  const tokens = flow.provider === 'openai' ? yield* pollDevice(platform.oauthClients, flow) : yield* finishPasted(platform.oauthClients, flow, pasted ?? '')
  if (tokens === undefined) return false
  const sealed = yield* platform.credentials.seal(JSON.stringify(tokens))
  // The same address renews its account whatever the owner renamed it to: the match is the address inside the stored token.
  let same: { id: string } | undefined
  if (tokens.email !== undefined) {
    for (const row of yield* sql.all<{ id: string; label: string; sealed: string }>("SELECT id, label, sealed FROM account WHERE provider = ? AND kind = 'oauth'", provider)) {
      if (row.label === tokens.email || (yield* tokenEmail(row.sealed)) === tokens.email) { same = { id: row.id }; break }
    }
  }
  if (same !== undefined) {
    yield* sql.run("UPDATE account SET sealed = ?, expires = ?, status = 'ok', note = NULL, until = NULL, notified = 0, updated_at = ? WHERE id = ?", sealed, tokens.expires, Date.now(), same.id)
  } else {
    const count = (yield* sql.first<{ n: number }>('SELECT COUNT(*) AS n FROM account WHERE provider = ?', provider))?.n ?? 0
    yield* insertAccount(provider, tokens.email ?? `${PROVIDER_LABELS[provider]} ${count + 1}`, 'oauth', sealed, shared, tokens.expires)
  }
  yield* kvDelete(`oauth-flow:${provider}`)
  yield* publish(provider)
  return true
})

const updateAccount = (id: string, change: { label?: string; shared?: boolean }) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const row = yield* sql.first<AccountRow>('SELECT * FROM account WHERE id = ?', id)
  if (row === undefined) return yield* notFound('no such account')
  if (change.label !== undefined && change.label.trim() !== '') yield* sql.run('UPDATE account SET label = ?, updated_at = ? WHERE id = ?', change.label.trim().slice(0, 80), Date.now(), id)
  if (change.shared !== undefined) yield* sql.run('UPDATE account SET shared = ?, updated_at = ? WHERE id = ?', change.shared ? 1 : 0, Date.now(), id)
  yield* publish(row.provider)
})

const removeAccount = (id: string) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const row = yield* sql.first<{ provider: ProviderId }>('SELECT provider FROM account WHERE id = ?', id)
  if (row === undefined) return
  yield* sql.run('DELETE FROM account WHERE id = ?', id)
  yield* publish(row.provider)
})

/** Refresh shared by concurrent callers: the second waits for the first instead of spending the rotated token. */
const refreshOnce = (row: AccountRow, tokens: OAuthTokens): Effect.Effect<OAuthTokens, unknown, R> => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  const running = platform.refreshing.get(row.id)
  if (running !== undefined) return yield* promise(() => running)
  const services = yield* Effect.context<R>()
  const next = Effect.runPromise(Effect.provideContext(Effect.gen(function* () {
    const fresh = yield* refreshTokens(platform.oauthClients, row.provider as 'openai' | 'anthropic', tokens)
    const sql = yield* Sql
    yield* sql.run('UPDATE account SET sealed = ?, expires = ?, updated_at = ? WHERE id = ?', yield* platform.credentials.seal(JSON.stringify(fresh)), fresh.expires, Date.now(), row.id)
    return fresh
  }), services)).finally(() => platform.refreshing.delete(row.id))
  platform.refreshing.set(row.id, next)
  return yield* promise(() => next)
})

const openAccount = (row: AccountRow) => Effect.gen(function* () {
  const platform = yield* MemberPlatform
  const data = JSON.parse(yield* platform.credentials.open(row.sealed)) as { key?: string } & Partial<OAuthTokens>
  if (row.kind === 'api-key') return { kind: 'api-key', key: data.key ?? '', account: row.id } as ProviderCredential
  let tokens = data as OAuthTokens
  if ((row.expires ?? tokens.expires) <= Date.now()) tokens = yield* refreshOnce(row, tokens)
  return { kind: 'oauth', access: tokens.access, account: row.id, ...(tokens.accountId === undefined ? {} : { accountId: tokens.accountId }) } as ProviderCredential
})

/** One account's credential; a request for another Member's Robot (`forHome`) gets only a shared account. */
const accountCredential = (id: string, forHome: boolean) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const row = yield* sql.first<AccountRow>('SELECT * FROM account WHERE id = ?', id)
  if (row === undefined || (forHome && row.shared !== 1)) return null
  return yield* openAccount(row)
})

/** An account and its credential for a usage read or a check; a shared view sees only shared accounts. */
const openForProbe = (id: string, forHome: boolean) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const row = yield* sql.first<AccountRow>('SELECT * FROM account WHERE id = ?', id)
  if (row === undefined || (forHome && row.shared !== 1)) return yield* notFound('no such account')
  return { provider: row.provider, credential: yield* openAccount(row) }
})

/** "Check now" (pa-hq0v): the Provider's answer sets the account's state. */
const applyProbe = (id: string, probe: Probe) => Effect.gen(function* () {
  const sql = yield* Sql
  const now = Date.now()
  if (probe.kind === 'ok') yield* sql.run("UPDATE account SET status = 'ok', note = NULL, until = NULL, notified = 0, checked_at = ?, updated_at = ? WHERE id = ?", now, now, id)
  else if (probe.kind === 'limited') yield* sql.run("UPDATE account SET status = 'limited', note = ?, until = ?, checked_at = ?, updated_at = ? WHERE id = ?", probe.note, probe.until ?? now + 3_600_000, now, now, id)
  else if (probe.kind === 'broken') yield* sql.run("UPDATE account SET status = 'broken', note = ?, until = ?, checked_at = ?, updated_at = ? WHERE id = ?", probe.note, now + BROKEN_RETRY_MS, now, now, id)
  const me = yield* profile
  const row = yield* sql.first<AccountRow>('SELECT * FROM account WHERE id = ?', id)
  return row === undefined ? null : accountView(row, me)
})

/** Six hours before a broken account is tried again by a Robot (pa-bc78). */
export const BROKEN_RETRY_MS = 6 * 3_600_000

/**
 * A Robot found an account limited or broken, or working again (pa-gqff, pa-bc78). A broken account
 * tells its owner once per break; working again clears the state.
 */
const markAccount = (id: string, change: { status: AccountStatus; until: number | null; note: string | null }, robot: { id: string; name: string }) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const row = yield* sql.first<AccountRow>('SELECT * FROM account WHERE id = ?', id)
  if (row === undefined) return null
  const now = Date.now()
  if (change.status === 'ok') {
    if (row.status !== 'ok') yield* sql.run("UPDATE account SET status = 'ok', note = NULL, until = NULL, notified = 0, checked_at = ?, updated_at = ? WHERE id = ?", now, now, id)
    return row.label
  }
  const until = change.status === 'broken' ? now + BROKEN_RETRY_MS : change.until ?? now + 3_600_000
  yield* sql.run('UPDATE account SET status = ?, note = ?, until = ?, checked_at = ?, updated_at = ? WHERE id = ?', change.status, change.note, until, now, now, id)
  if (change.status === 'broken' && row.notified === 0) {
    yield* sql.run('UPDATE account SET notified = 1 WHERE id = ?', id)
    yield* notify({ robotId: robot.id, robotName: robot.name, kind: 'needs you', body: `Your ${PROVIDER_LABELS[row.provider]} account "${row.label}" stopped working${change.note === null ? '' : `: ${change.note}`}. Fix it under your name → Providers, then press Check now.` })
  }
  return row.label
})

/** The first account of a Provider (oldest first) a Robot may use. */
const credential = (provider: ProviderId, forHome: boolean) => Effect.gen(function* () {
  yield* migrateAccounts
  const sql = yield* Sql
  const row = yield* sql.first<AccountRow>(`SELECT * FROM account WHERE provider = ? ${forHome ? 'AND shared = 1 ' : ''}ORDER BY created_at, rowid LIMIT 1`, provider)
  return row === undefined ? null : yield* openAccount(row)
})

// ------------------------------------------------------------------ the robot list, per person (robot-mktj)

/** One Robot's row in this person's list; `groupId` absent: ungrouped (ux-wxbm). */
export interface ListPref {
  readonly pinned: boolean
  readonly hidden: boolean
  readonly markedUnread: boolean
  readonly seenAt: number | null
  readonly groupId?: string
}

type ListPrefRow = { robot_id: string; pinned: number; hidden: number; marked_unread: number; seen_at: number | null; group_id: string | null }

const listPref = (row: ListPrefRow): ListPref => ({
  pinned: row.pinned === 1, hidden: row.hidden === 1, markedUnread: row.marked_unread === 1, seenAt: row.seen_at,
  ...(row.group_id === null ? {} : { groupId: row.group_id }),
})

/**
 * The person's list settings for the Robots they reach now (`reach`). A Robot out of reach (deleted,
 * no longer shared, its owner gone) leaves its group here, so no group keeps a Robot that is gone (ux-lywk).
 */
const listPrefs = (reach: readonly string[]) => Effect.gen(function* () {
  const sql = yield* Sql
  const reachable = new Set(reach)
  const rows = yield* sql.all<ListPrefRow>('SELECT * FROM list_pref')
  for (const row of rows) {
    if (row.group_id !== null && !reachable.has(row.robot_id)) yield* sql.run('UPDATE list_pref SET group_id = NULL WHERE robot_id = ?', row.robot_id)
  }
  return Object.fromEntries(rows.filter((row) => reachable.has(row.robot_id)).map((row) => [row.robot_id, listPref(row)])) as Record<string, ListPref>
})

const setListPref = (robotId: string, change: ListPrefPatch) => Effect.gen(function* () {
  const sql = yield* Sql
  const { group } = change
  if (group?.kind === 'group') yield* groupRow(group.groupId)
  yield* sql.run('INSERT INTO list_pref (robot_id) VALUES (?) ON CONFLICT (robot_id) DO NOTHING', robotId)
  if (change.pinned !== undefined) yield* sql.run('UPDATE list_pref SET pinned = ? WHERE robot_id = ?', change.pinned ? 1 : 0, robotId)
  if (change.hidden !== undefined) yield* sql.run('UPDATE list_pref SET hidden = ? WHERE robot_id = ?', change.hidden ? 1 : 0, robotId)
  if (change.unread !== undefined) yield* sql.run('UPDATE list_pref SET marked_unread = ? WHERE robot_id = ?', change.unread ? 1 : 0, robotId)
  if (group !== undefined) yield* sql.run('UPDATE list_pref SET group_id = ? WHERE robot_id = ?', group.kind === 'group' ? group.groupId : null, robotId)
})

// ------------------------------------------------------------------ sidebar groups, the person's own (ux-wxbm, ux-o7po, ux-xbvi, ux-oltg)

type GroupRow = { id: string; name: string; collapsed: number; position: number }

const groupView = (row: GroupRow): RobotGroup => ({ id: row.id, name: row.name, collapsed: row.collapsed === 1 })

const groupRow = (id: string) => Effect.gen(function* () {
  const row = yield* (yield* Sql).first<GroupRow>('SELECT * FROM list_group WHERE id = ?', id)
  if (row === undefined) return yield* notFound('no such group')
  return row
})

/** The person's groups in their order. */
const groups = Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.all<GroupRow>('SELECT * FROM list_group ORDER BY position, rowid')).map(groupView)
})

/** A new group goes last, expanded. */
const createGroup = (name: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const id = crypto.randomUUID()
  const last = (yield* sql.first<{ at: number | null }>('SELECT MAX(position) AS at FROM list_group'))?.at ?? -1
  yield* sql.run('INSERT INTO list_group (id, name, collapsed, position) VALUES (?, ?, 0, ?)', id, name, last + 1)
  return groupView({ id, name, collapsed: 0, position: last + 1 })
})

const updateGroup = (id: string, patch: GroupPatch) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* groupRow(id)
  if (patch.name !== undefined) yield* sql.run('UPDATE list_group SET name = ? WHERE id = ?', patch.name, id)
  if (patch.collapsed !== undefined) yield* sql.run('UPDATE list_group SET collapsed = ? WHERE id = ?', patch.collapsed ? 1 : 0, id)
  return groupView(yield* groupRow(id))
})

/** The group goes; its Robots return to the ungrouped list (ux-o7po). */
const removeGroup = (id: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* groupRow(id)
  yield* sql.transaction(() => {
    sql.raw.exec('UPDATE list_pref SET group_id = NULL WHERE group_id = ?', id)
    sql.raw.exec('DELETE FROM list_group WHERE id = ?', id)
  })
})

/** The groups in a new order: every group exactly once. */
const orderGroups = (ids: readonly string[]) => Effect.gen(function* () {
  const sql = yield* Sql
  const known = new Set((yield* groups).map((group) => group.id))
  if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) return yield* invalid('give every group once, in the new order')
  yield* sql.transaction(() => ids.forEach((id, position) => sql.raw.exec('UPDATE list_group SET position = ? WHERE id = ?', position, id)))
  return yield* groups
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

const addUsage = (month: string, robotId: string, source: UsageSource, inputTokens: number, outputTokens: number, costUsd: number) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run(
    `INSERT INTO usage (month, robot_id, source, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (month, robot_id, source) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd`,
    month, robotId, source, inputTokens, outputTokens, costUsd,
  )
})

/** The Member's month across their Robots: totals, the cost by source, and each Robot's (ao-ef5t). */
const usage = (month: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const rows = (yield* sql.all<{ robot_id: string; source: UsageSource; input_tokens: number; output_tokens: number; cost_usd: number }>('SELECT robot_id, source, input_tokens, output_tokens, cost_usd FROM usage WHERE month = ?', month))
    .map((row) => ({ robotId: row.robot_id, source: row.source, inputTokens: row.input_tokens, outputTokens: row.output_tokens, costUsd: row.cost_usd }))
  const robots = [...new Set(rows.map((row) => row.robotId))]
  const breakdown = costBreakdown(rows)
  return {
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    costUsd: breakdown.total,
    breakdown,
    byRobot: robots.map((robotId) => {
      const own = rows.filter((row) => row.robotId === robotId)
      return { robotId, inputTokens: own.reduce((sum, row) => sum + row.inputTokens, 0), outputTokens: own.reduce((sum, row) => sum + row.outputTokens, 0), costUsd: costBreakdown(own).total, breakdown: costBreakdown(own) }
    }),
  }
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
const notify = (event: { robotId: string; robotName: string; kind: NotificationKind; body: string; hosts?: readonly string[] }) => push({
  kind: 'robot',
  title: event.kind === 'finished' ? event.robotName : `${event.robotName} ${event.kind === 'needs you' ? 'needs you' : 'is blocked'}`,
  body: event.body.slice(0, 400),
  url: `/#/r/${encodeURIComponent(event.robotId)}`,
  tag: `${event.robotId}-${event.kind}`,
  urgency: event.kind === 'finished' ? 'normal' : 'high',
}, event.hosts ?? [])

/** The Home reminds this Member of a Task's moment (mc-s3cc): a push of its own, no Robot woken; quiet hours apply. */
const remind = (task: { taskId: string; title: string; at: number }) => Effect.gen(function* () {
  const me = yield* profile
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: me.timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(task.at)
  return yield* push({ kind: 'reminder', title: task.title.slice(0, 120), body: `${task.at < Date.now() ? 'Was due' : 'Due'} ${clock}`, url: '/#/mission', tag: `task-${task.taskId}`, urgency: 'high' }, [])
})

/** Inside the Member's quiet hours a notification waits for their end (robot-bden); otherwise it goes to every device now. */
const push = (notification: PushNotification, hosts: readonly string[]) => Effect.gen(function* () {
  const until = yield* quietUntil(Date.now())
  if (until !== null) {
    const sql = yield* Sql
    const platform = yield* MemberPlatform
    yield* sql.run('INSERT INTO pending_notification (deliver_at, notification, hosts) VALUES (?, ?, ?)', until, JSON.stringify(notification), JSON.stringify(hosts))
    const alarm = yield* platform.getAlarm()
    if (alarm === null || alarm > until) yield* platform.setAlarm(until)
    return 'deferred' as const
  }
  yield* (yield* MemberPlatform).deliverNow(notification, hosts)
  return 'sent' as const
})

/** Quiet hours ended: deliver what waited, and arm for the next. */
/** The computers a deferred notification names, as stored; a row from before this column names none. */
const decodeHostIds = (stored: string): string[] => {
  const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(stored)
  return parsed._tag === 'Some' ? [...parsed.value] : []
}

const deliverDue = (now: number) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* MemberPlatform
  for (const row of yield* sql.all<{ id: number; notification: string; hosts: string }>('SELECT id, notification, hosts FROM pending_notification WHERE deliver_at <= ? ORDER BY id', now)) {
    yield* sql.run('DELETE FROM pending_notification WHERE id = ?', row.id)
    yield* platform.deliverNow(JSON.parse(row.notification) as PushNotification, decodeHostIds(row.hosts))
  }
  const next = (yield* sql.first<{ at: number | null }>('SELECT MIN(deliver_at) AS at FROM pending_notification'))?.at ?? null
  if (next !== null) yield* platform.setAlarm(next)
})

/** The Member's programs, as run by the Durable Object. */
export const MemberProgram = {
  profile, init, updateProfile, file, files, writeFile, accounts, addApiKey, startOAuth, finishOAuth, updateAccount, removeAccount, credential, accountCredential,
  listPrefs, setListPref, markSeen, groups, createGroup, updateGroup, removeGroup, orderGroups, setSecret, secret, takeSecret, secretNames, logins, addUsage, usage,
  addPushDevice, removePushDevice, pushDevices, notify, remind, deliver, deliverDue,
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
    if (!sql.exec<{ name: string }>('PRAGMA table_info(list_pref)').toArray().some((column) => column.name === 'group_id')) sql.exec('ALTER TABLE list_pref ADD COLUMN group_id TEXT')
    sql.exec('CREATE TABLE IF NOT EXISTS list_group (id TEXT PRIMARY KEY, name TEXT NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS secret (name TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS usage (month TEXT NOT NULL, robot_id TEXT NOT NULL, source TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (month, robot_id, source)) WITHOUT ROWID')
    // Usage by source (v1.14, ao-ef5t): rows from before carry no source; their cost is counted as the model's.
    if (!sql.exec<{ name: string }>('PRAGMA table_info(usage)').toArray().some((column) => column.name === 'source')) {
      sql.exec('CREATE TABLE usage_v14 (month TEXT NOT NULL, robot_id TEXT NOT NULL, source TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (month, robot_id, source)) WITHOUT ROWID')
      sql.exec("INSERT INTO usage_v14 SELECT month, robot_id, 'robot', input_tokens, output_tokens, cost_usd FROM usage")
      sql.exec('DROP TABLE usage')
      sql.exec('ALTER TABLE usage_v14 RENAME TO usage')
    }
    // The Computer became the Box (v1.15 ticket 06): its cost rows carry the new source.
    sql.exec("INSERT INTO usage (month, robot_id, source, input_tokens, output_tokens, cost_usd) SELECT month, robot_id, 'box', input_tokens, output_tokens, cost_usd FROM usage WHERE source = 'computer' ON CONFLICT (month, robot_id, source) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd")
    sql.exec("DELETE FROM usage WHERE source = 'computer'")
    sql.exec('CREATE TABLE IF NOT EXISTS push_device (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL)')
    // Shared Pages (v1.17 ticket 06): one row per open share link; the token is sealed, a share is found by its hash, Stop sharing deletes the row.
    sql.exec('CREATE TABLE IF NOT EXISTS shared_page (token_hash TEXT PRIMARY KEY, robot_id TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, sealed_token TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (robot_id, path))')
    sql.exec('CREATE TABLE IF NOT EXISTS pending_notification (id INTEGER PRIMARY KEY AUTOINCREMENT, deliver_at INTEGER NOT NULL, notification TEXT NOT NULL)')
    // The computers a deferred notification names (ob-6jr5); a row from before has none, so every computer shows it.
    if (!sql.exec<{ name: string }>('PRAGMA table_info(pending_notification)').toArray().some((column) => column.name === 'hosts')) sql.exec("ALTER TABLE pending_notification ADD COLUMN hosts TEXT NOT NULL DEFAULT '[]'")
    sql.exec(`CREATE TABLE IF NOT EXISTS credential (
      provider TEXT PRIMARY KEY, kind TEXT NOT NULL, sealed TEXT NOT NULL, shared INTEGER NOT NULL, expires INTEGER, updated_at INTEGER NOT NULL
    )`)
    sql.exec(`CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, sealed TEXT NOT NULL, shared INTEGER NOT NULL,
      expires INTEGER, status TEXT NOT NULL DEFAULT 'ok', note TEXT, until INTEGER, checked_at INTEGER, notified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
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
      deliverNow: (notification, hosts) => Effect.promise(async () => {
        try { this.hosts.notify({ title: notification.title, body: notification.body, url: notification.url, tag: notification.tag }, hosts) } catch (error) { console.warn('host notification failed', error) }
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
  async updateProfile(patch: ProfilePatch): Promise<MemberProfile> {
    const before = await this.run(profile)
    const after = await this.run(updateProfile(patch))
    await this.zoneMoved(before, after)
    await this.ownerRenamed(before, after)
    return after
  }
  /** The app opened and reported its zone (an IANA zone, already parsed). */
  async detectTimeZone(zone: string): Promise<MemberProfile> {
    const before = await this.run(profile)
    const after = await this.run(detectTimeZone(zone))
    await this.zoneMoved(before, after)
    return after
  }
  /** The name or the nickname changed: every Robot of this Member names its owner the new way (ux-nwi1). */
  private async ownerRenamed(before: MemberProfile, after: MemberProfile): Promise<void> {
    if (before.name === after.name && before.nickname === after.nickname) return
    await this.env.HOME.getByName(HOME_ID).ownerChanged(after.id, robotOwner(after)).catch((error: unknown) => console.warn('owner change not delivered', error))
  }
  /** The profile zone changed: every Robot of this Member follows it and is told (v1.11 ticket 08). */
  private async zoneMoved(before: MemberProfile, after: MemberProfile): Promise<void> {
    if (before.timeZone === after.timeZone) return
    await this.env.HOME.getByName(HOME_ID).timeZoneChanged(after.id, after.timeZone, before.timeZone).catch((error: unknown) => console.warn('time zone change not delivered', error))
  }
  file(name: MemberFileName): Promise<string> { return this.run(file(name)) }
  files(): Promise<Record<MemberFileName, string>> { return this.run(files) }
  /** A shared memory file changed: every Robot of this Member hears who changed it (pl-9n7w). */
  async writeFile(name: MemberFileName, content: string, by = 'your owner', exceptRobot?: string): Promise<void> {
    await this.run(writeFile(name, content))
    const memberId = (await this.run(profile)).id
    await this.env.HOME.getByName(HOME_ID).memoryChanged(memberId, name, by, exceptRobot ?? null).catch((error: unknown) => console.warn('memory change not delivered', error))
  }
  /** The Member's Provider accounts; `sharedOnly` for another Member's view. */
  accounts(sharedOnly = false): Promise<ProviderView[]> { return this.run(accounts(sharedOnly)) }
  addApiKey(provider: ProviderId, key: string, shared: boolean, label?: string): Promise<string> { return this.run(addApiKey(provider, key, shared, label)) }
  startOAuth(provider: 'openai' | 'anthropic'): Promise<Omit<FlowStart, 'flow'>> { return this.run(startOAuth(provider)) }
  finishOAuth(provider: 'openai' | 'anthropic', pasted: string | undefined, shared: boolean): Promise<boolean> { return this.run(finishOAuth(provider, pasted, shared)) }
  updateAccount(id: string, change: { label?: string; shared?: boolean }): Promise<void> { return this.run(updateAccount(id, change)) }
  removeAccount(id: string): Promise<void> { return this.run(removeAccount(id)) }
  credential(provider: ProviderId, forHome: boolean): Promise<ProviderCredential | null> { return this.run(credential(provider, forHome)) }
  accountCredential(id: string, forHome: boolean): Promise<ProviderCredential | null> { return this.run(accountCredential(id, forHome)) }
  /** Usage windows of a Claude or OpenCode Go account, cached a minute (pa-lmbl, pa-sps4, pa-7d50); none for others (pa-afb9). */
  private readonly usageCache = new Map<string, AccountUsage>()
  async accountUsage(id: string, forHome: boolean): Promise<AccountUsage> {
    const cached = this.usageCache.get(id)
    if (cached !== undefined && Date.now() - cached.checkedAt < 60_000) return cached
    const { provider, credential } = await this.run(openForProbe(id, forHome))
    if (provider !== 'anthropic' && provider !== 'opencode-go') return { windows: null, checkedAt: Date.now(), error: null }
    const probe = await probeAccount(provider, credential, this.connectorFetch())
    const usage: AccountUsage = {
      windows: probe.kind === 'ok' || probe.kind === 'limited' ? [...(probe.windows ?? [])] : null,
      checkedAt: Date.now(),
      error: probe.kind === 'broken' || probe.kind === 'unknown' ? `usage unavailable: ${probe.note}` : null,
    }
    this.usageCache.set(id, usage)
    return usage
  }
  async checkAccount(id: string): Promise<ProviderView | null> {
    const { provider, credential } = await this.run(openForProbe(id, false))
    this.usageCache.delete(id)
    return this.run(applyProbe(id, await probeAccount(provider, credential, this.connectorFetch())))
  }
  markAccount(id: string, change: { status: AccountStatus; until: number | null; note: string | null }, robot: { id: string; name: string }): Promise<string | null> { return this.run(markAccount(id, change, robot)) }
  /** List settings of the Robots in `reach`; Robots out of reach leave their group (ux-lywk). */
  listPrefs(reach: readonly string[]): Promise<Record<string, ListPref>> { return this.run(listPrefs(reach)) }
  setListPref(robotId: string, change: ListPrefPatch): Promise<void> { return this.run(setListPref(robotId, change)) }
  markSeen(robotId: string, at: number): Promise<void> { return this.run(markSeen(robotId, at)) }
  groups(): Promise<RobotGroup[]> { return this.run(groups) }
  createGroup(name: string): Promise<RobotGroup> { return this.run(createGroup(name)) }
  updateGroup(id: string, patch: GroupPatch): Promise<RobotGroup> { return this.run(updateGroup(id, patch)) }
  removeGroup(id: string): Promise<void> { return this.run(removeGroup(id)) }
  orderGroups(ids: readonly string[]): Promise<RobotGroup[]> { return this.run(orderGroups(ids)) }

  /** Reset everything (pl-062x): memory files back to templates, usage and list preferences gone; credentials, logins and devices stay. */
  // ---------------------------------------------------------------- shared Pages (v1.17 ticket 06)

  private shareVault(): VaultShape {
    return makeVault(this.env.DATA_KEY, 'shared-pages')
  }

  private async sharedView(row: SharedPageRow, origin: string): Promise<SharedPageView> {
    const token = await Effect.runPromise(this.shareVault().open(row.sealed_token))
    return { robotId: row.robot_id, path: row.path, title: row.title, url: origin + sharedPagePath(token), createdAt: row.created_at }
  }

  /** Share one Page of a Robot of this Member (dp-hf7v): the open link when there is one, else a new one. The owner's act only (dp-62di). */
  async sharePage(robotId: string, path: string, title: string, origin: string): Promise<SharedPageView> {
    const sql = this.ctx.storage.sql
    const open = sql.exec<SharedPageRow>('SELECT * FROM shared_page WHERE robot_id = ? AND path = ?', robotId, path).toArray()[0]
    if (open !== undefined) return this.sharedView(open, origin)
    const id = (await this.profile()).id
    const token = await mintShareToken(this.env.DATA_KEY, id)
    const sealed = await Effect.runPromise(this.shareVault().seal(token))
    sql.exec('INSERT INTO shared_page (token_hash, robot_id, path, title, sealed_token, created_at) VALUES (?, ?, ?, ?, ?, ?)', await shareTokenHash(token), robotId, path, title, sealed, Date.now())
    return this.sharePage(robotId, path, title, origin)
  }

  /** The open share of one Page, or null. */
  async sharedPage(robotId: string, path: string, origin: string): Promise<SharedPageView | null> {
    const row = this.ctx.storage.sql.exec<SharedPageRow>('SELECT * FROM shared_page WHERE robot_id = ? AND path = ?', robotId, path).toArray()[0]
    return row === undefined ? null : this.sharedView(row, origin)
  }

  /** Every shared Page of this Member, newest first (dp-zq16). */
  async sharedPages(origin: string): Promise<SharedPageView[]> {
    const rows = this.ctx.storage.sql.exec<SharedPageRow>('SELECT * FROM shared_page ORDER BY created_at DESC').toArray()
    return Promise.all(rows.map((row) => this.sharedView(row, origin)))
  }

  /** Stop sharing (dp-hf7v): the row goes, and the link answers not found from now on. */
  async stopSharing(robotId: string, path: string): Promise<boolean> {
    return this.ctx.storage.sql.exec('DELETE FROM shared_page WHERE robot_id = ? AND path = ?', robotId, path).rowsWritten > 0
  }

  /** The Page a share link opens, or null when it was revoked (dp-jl3d). */
  async sharedPageOf(token: string): Promise<{ readonly robotId: string; readonly path: string } | null> {
    const row = this.ctx.storage.sql.exec<SharedPageRow>('SELECT * FROM shared_page WHERE token_hash = ?', await shareTokenHash(token)).toArray()[0]
    return row === undefined ? null : { robotId: row.robot_id, path: row.path }
  }

  async resetData(): Promise<void> {
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM usage')
    sql.exec('DELETE FROM list_pref')
    sql.exec('DELETE FROM list_group')
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
  addUsage(month: string, robotId: string, source: UsageSource, inputTokens: number, outputTokens: number, costUsd: number): Promise<void> { return this.run(addUsage(month, robotId, source, inputTokens, outputTokens, costUsd)) }
  usage(month: string): Promise<{ inputTokens: number; outputTokens: number; costUsd: number; breakdown: CostBreakdown; byRobot: Array<{ robotId: string; inputTokens: number; outputTokens: number; costUsd: number; breakdown: CostBreakdown }> }> { return this.run(usage(month)) }
  addPushDevice(device: DeviceSubscription & { device?: string }): Promise<void> { return this.run(addPushDevice(device)) }
  removePushDevice(endpoint: string): Promise<void> { return this.run(removePushDevice(endpoint)) }
  pushDevices(): Promise<Array<{ endpoint: string; device: string; createdAt: number }>> { return this.run(pushDevices) }
  notify(event: { robotId: string; robotName: string; kind: NotificationKind; body: string; hosts?: readonly string[] }): Promise<'sent' | 'deferred'> { return this.run(notify(event)) }
  remind(task: { taskId: string; title: string; at: number }): Promise<'sent' | 'deferred'> { return this.run(remind(task)) }

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
    // Signing in again (ux-cbo3): a person connection for an account the Member already has takes the new
    // session and is connected again, keeping its id and so every Robot's grant on it.
    const again = actsAsPerson(input.kind) ? this.connectionsOf.list().find((known) => known.kind === input.kind && known.account === outcome.success.account) : undefined
    if (again !== undefined) {
      const renewed = await this.connectionsOf.update(again.id, {
        status: 'connected', statusNote: null, meta: outcome.success.meta, secrets: input.secrets,
        ...(input.label === null || input.label.trim() === '' ? {} : { label: input.label.trim() }),
      })
      if (renewed !== undefined) return renewed
    }
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

  async startGoogleConsent(origin: string, services: string[], shared: boolean, reconnect: string | null, external = false): Promise<string> {
    return this.google.start((await this.run(profile)).id, origin, services, shared, reconnect, external)
  }
  async finishGoogleConsent(origin: string, code: string, state: string): Promise<{ account: string; external: boolean }> {
    const { connection, external } = await this.google.finish(origin, code, state)
    return { account: connection.account, external }
  }

  connections(): OwnConnection[] { return this.connectionsOf.list() }
  discordUserIds(): string[] { return this.connectionsOf.discordUserIds() }
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

  // A Robot's calls on a Host answer with a HostCallReply: an expected failure crosses to the Robot as an encoded tagged value (deep review P16).
  hostRead(id: string, robotId: string, path: string) { return replyOf(this.hosts.run(id, robotId, 'files', (client, access) => client.Read({ path, access }), undefined, { action: 'read', detail: path })) }
  hostWrite(id: string, robotId: string, input: { path: string; text?: string; base64?: string }, reach: Reach = 'granted') { return replyOf(this.hosts.run(id, robotId, 'files', (client, access) => client.Write({ ...input, access }), undefined, { action: reach === 'escalated' ? 'write (escalated)' : 'write', detail: input.path }, reach)) }
  /** One piece of a copy, under the Host's file Grant; the copy as a whole is logged once (recordHostCopy). */
  hostCopySize(id: string, robotId: string, path: string) { return replyOf(this.hosts.run(id, robotId, 'files', (client, access) => client.CopyStat({ path, access }), 60_000)) }
  // The Member DO only coordinates a copy: the bytes go between the Host app and R2 (v1.16 ticket 06). A call carries one part, and has
  // that part's deadline (deep review P12); when it runs out, the app is told to stop and stops its requests and writes.
  hostUpload(id: string, robotId: string, input: { path: string; size: number; parts: readonly UploadPart[] }) { return replyOf(this.hosts.run(id, robotId, 'files', (client, access) => client.Upload({ ...input, access }), hostPartDeadlineMs(input.parts.reduce((sum, part) => sum + part.length, 0)))) }
  /** One window of a download, bytes `from` to `until`, into the part file of the copy `copy`; the Host app puts the file in place when the window reaches the end. */
  hostDownload(id: string, robotId: string, input: { copy: string; path: string; url: string; size: number; partBytes: number; from: number; until: number }, reach: Reach = 'granted') { return replyOf(this.hosts.run(id, robotId, 'files', (client, access) => client.Download({ ...input, access }), hostPartDeadlineMs(input.until - input.from), undefined, reach)) }
  recordHostCopy(id: string, robotId: string, detail: string, outcome: string): void { this.hosts.recordCopy({ hostId: id, robotId, detail, outcome }) }
  /**
   * A command under the shell grant's mode and roots, run by the app as a job (v1.16 ticket 03): the call waits up to `timeoutMs` and
   * answers with the result, or says the command goes on as a job, or starts one at once; with no answer (the connection dropped) the
   * app may hold it as a job (HostRunAnswer). `job` is the Robot's name for it.
   * An escalated `reach` is a call its owner approved to run without the sandbox, once (ob-ifak).
   */
  hostRun(id: string, robotId: string, input: { command: string; cwd?: string; timeoutMs?: number; background: boolean; job: string }, reach: Reach = 'granted'): Promise<HostCallReply<HostRunAnswer>> {
    const { job, ...payload } = input
    const wait = input.background ? 60_000 : Math.min(input.timeoutMs ?? 120_000, RUN_MAX_WAIT_SECONDS * 1000) + 10_000
    return replyOf(this.hosts.runCommand(id, robotId, job, (client, access) => client.Run({ ...payload, job: jobRef(robotId, job), access }), wait, { action: reach === 'escalated' ? 'run (escalated)' : 'run', detail: input.cwd === undefined ? input.command : `${input.command}  (in ${input.cwd})` }, reach))
  }
  hostJobList(id: string, robotId: string) { return replyOf(this.hosts.jobList(id, robotId)) }
  hostJobOutput(id: string, robotId: string, job: string, stream: 'out' | 'err', offset: number) { return replyOf(this.hosts.jobOutput(id, robotId, job, stream, offset)) }
  hostJobKill(id: string, robotId: string, job: string) { return replyOf(this.hosts.jobKill(id, robotId, job)) }
  /** List, search and delete under the files grant, done by the app in Node (v1.16 ticket 02); a delete is a write and obeys the mode and roots. */
  hostGlob(id: string, robotId: string, pattern: string) { return replyOf(this.hosts.run(id, robotId, 'files', (client, access) => client.Glob({ pattern, access }), 60_000, { action: 'glob', detail: pattern })) }
  hostGrep(id: string, robotId: string, input: { pattern: string; ignoreCase: boolean; glob?: string; path?: string }) { return replyOf(this.hosts.run(id, robotId, 'files', (client, access) => client.Grep({ ...input, access }), 60_000, { action: 'grep', detail: input.pattern })) }
  hostDelete(id: string, robotId: string, path: string, reach: Reach = 'granted') { return replyOf(this.hosts.run(id, robotId, 'files', (client, access) => client.Delete({ path, access }), 60_000, { action: reach === 'escalated' ? 'delete (escalated)' : 'delete', detail: path }, reach)) }
  hostActions(id: string): HostAction[] { return this.hosts.actions(id) }
  hostBrowserOpen(id: string, robotId: string, robotName: string): Promise<HostCallReply<string>> { return replyOf(this.hosts.openBrowser(id, robotId, robotName)) }
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
