/**
 * The Home (robot-q7rj): its Members, the registry of every Robot (owner, sharing,
 * last line, state), Home settings, and everything shared with the Home.
 * One per deployment, addressed by HOME_ID.
 */
import type { ConnectionView, HostView, LoginView, PluginView } from '@mr-robot/protocol'
import type { HostEntry } from '../member/hosts.ts'
import { metaOf, parseEntry, serializeEntry, type LoginEntry } from '../platform/logins.ts'
import { DurableObject } from 'cloudflare:workers'
import type {
  FleetState,
  Identity,
  MemberRole,
  MemberStatus,
  MemberView,
  ModelChoice,
  ModelOption,
  RobotStatus,
  AdminView,
  ProvidersView,
  ProviderView,
  RobotSummary,
  SettingsCatalog,
  Sharing,
  SkillView,
  BrowserBackend,
} from '@mr-robot/protocol'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { DurableRuntime, invalid, notFound, Sql, sqlLayer } from '../platform/durable.ts'
import { backendOptions } from '../browser/backends.ts'
import { TOOL_GROUPS } from '../agent/catalog.ts'
import { connectionView, HomePlugins } from './plugins.ts'
import { disabledToolGroups } from '../plugins/catalog.ts'
import type { PlainValue } from '../connectors/schema-form.ts'
import type { ConnectionChange, ConnectionMeta, OwnConnection } from '../member/connections.ts'
import { liveModels, type ListingAccess } from '../providers/live-catalog.ts'
import { fetchMetadata, type MetadataIndex } from '../providers/model-metadata.ts'
import { PROVIDER_IDS } from '../agent/providers.ts'
import { makeVault, type VaultShape } from '../platform/vault.ts'
import { fetchRepository, skillsInTree, type SkillRepository } from '../skills/library.ts'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'
import type { Env } from '../env.ts'

export const DEFAULT_MODEL: ModelChoice = { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }
export const MR_ROBOT_COLOR = '#5ec4b6'

/** The Home's model list until the admin edits it (robot-82r5); contextWindow caps each Robot's budget. */
/** Prices are the admin's to correct in the admin view; subscriptions are flat and count as 0. */
/** Which connected Provider a new Robot starts on when the Home default is not usable. */
const FALLBACK_ORDER = ['anthropic', 'openai', 'opencode-go', 'deepseek', 'openrouter', 'workers-ai']
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000
const AVATAR_COLORS = ['#f4a03a', '#6c63ff', '#8b5cf6', '#3b82f6', '#f97316', '#ef4444', '#10b981', '#ec4899']

export interface HomeSettings {
  readonly defaultModel: ModelChoice
  /** The browser backend new and unset Robots use (rb-ybt4). */
  readonly defaultBrowserBackend: BrowserBackend
  readonly robotSpendLimitUsd: number | null
  readonly memberSpendLimitUsd: number | null
}

export interface RegistryEntry {
  readonly id: string
  readonly ownerId: string
  readonly kind: 'mr-robot' | 'robot'
  readonly identity: Identity
  readonly sharing: Sharing
  readonly status: RobotStatus
  readonly fleetState: FleetState
  readonly lastLine: string
  readonly lastAt: number
}

export type SignIn =
  | { readonly ok: true; readonly member: MemberView; readonly created: boolean }
  | { readonly ok: false; readonly reason: 'not-invited' | 'removed' }

type MemberSql = { id: string; email: string; name: string; role: MemberRole; status: MemberStatus; created_at: number }
type RobotSql = {
  id: string; owner_id: string; kind: 'mr-robot' | 'robot'; identity: string; sharing: Sharing; status: RobotStatus
  fleet_state: FleetState; last_line: string; last_at: number
}

/** The Home's reach beyond its SQLite: the other Durable Objects, R2, Workers AI and the secret vault. */
export interface HomePlatformShape {
  readonly env: Env
  readonly secrets: VaultShape
  /** When each Provider's list was last tried, so a failing Provider is not asked on every request. */
  readonly catalogTries: Map<string, number>
}

export class HomePlatform extends Context.Service<HomePlatform, HomePlatformShape>()('mr-robot/HomePlatform') {}

type R = Sql | HomePlatform

/** An RPC to another Durable Object (or R2), awaited as an Effect; its failure is a defect here. */
const remote = <A>(call: (env: Env) => Promise<A>): Effect.Effect<A, never, HomePlatform> => Effect.gen(function* () {
  const platform = yield* HomePlatform
  return yield* Effect.promise(() => call(platform.env))
})

const setting = <T>(key: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<{ v: string }>('SELECT v FROM setting WHERE k = ?', key)
  return row === undefined ? undefined : (JSON.parse(row.v) as T)
})

const putSetting = (key: string, value: unknown) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('INSERT INTO setting (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value))
})

// ------------------------------------------------------------------ Members

const memberByEmail = (email: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<MemberSql>('SELECT * FROM member WHERE email = ?', email)
  return row === undefined ? undefined : memberFromSql(row)
})

const member = (id: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<MemberSql>('SELECT * FROM member WHERE id = ?', id)
  return row === undefined ? undefined : memberFromSql(row)
})

const members = Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.all<MemberSql>('SELECT * FROM member ORDER BY created_at')).map(memberFromSql)
})

/**
 * Sign a verified e-mail in (robot-7v5x). The first person becomes the admin; later
 * people need an invite; a removed Member stays out. A new Member gets Mr. Robot.
 */
const signIn = (email: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const normalized = email.trim().toLowerCase()
  const existing = yield* memberByEmail(normalized)
  if (existing?.status === 'active') return { ok: true, member: existing, created: false } as SignIn
  if (existing?.status === 'removed') return { ok: false, reason: 'removed' } as SignIn
  const first = ((yield* sql.first<{ n: number }>('SELECT COUNT(*) AS n FROM member'))?.n ?? 0) === 0
  if (existing === undefined && !first) return { ok: false, reason: 'not-invited' } as SignIn
  const joined: MemberView = existing === undefined
    ? { id: `m-${crypto.randomUUID()}`, email: normalized, name: nameFromEmail(normalized), role: 'admin', status: 'active' }
    : { ...existing, status: 'active' }
  yield* sql.run(
    `INSERT INTO member (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status`,
    joined.id, joined.email, joined.name, joined.role, joined.status, Date.now(),
  )
  yield* remote((env) => env.MEMBER.getByName(joined.id).init({ id: joined.id, email: joined.email, name: joined.name }))
  yield* bootstrapMrRobot(joined)
  return { ok: true, member: joined, created: true } as SignIn
})

/** Admin: invite an e-mail; the Member becomes active on first sign-in (robot-d2uv). */
const invite = (email: string, role: MemberRole = 'member') => Effect.gen(function* () {
  const sql = yield* Sql
  const normalized = email.trim().toLowerCase()
  const existing = yield* memberByEmail(normalized)
  if (existing !== undefined && existing.status !== 'removed') return existing
  const invited: MemberView = existing === undefined
    ? { id: `m-${crypto.randomUUID()}`, email: normalized, name: nameFromEmail(normalized), role, status: 'invited' }
    : { ...existing, role, status: 'invited' }
  yield* sql.run(
    `INSERT INTO member (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status, role = excluded.role`,
    invited.id, invited.email, invited.name, invited.role, invited.status, Date.now(),
  )
  return invited
})

/** Admin: remove a Member; their access ends and their Robots are paused (robot-d2uv). */
const remove = (memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run("UPDATE member SET status = 'removed' WHERE id = ?", memberId)
  const owned = yield* sql.all<{ id: string }>('SELECT id FROM robot WHERE owner_id = ?', memberId)
  yield* Effect.forEach(owned, ({ id }) => remote((env) => env.ROBOT.getByName(id).pause()), { concurrency: 'unbounded', discard: true })
  const viewed = yield* sql.all<{ id: string }>("SELECT id FROM robot WHERE status != 'deleted' AND (owner_id = ? OR sharing = 'home')", memberId)
  yield* Effect.forEach(viewed, ({ id }) => remote((env) => env.ROBOT.getByName(id).disconnectMember(memberId)), { concurrency: 'unbounded', discard: true })
})

const rename = (memberId: string, name: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('UPDATE member SET name = ? WHERE id = ?', name, memberId)
})

// ------------------------------------------------------------------ settings

const settings = Effect.gen(function* () {
  return {
    defaultModel: (yield* setting<ModelChoice>('defaultModel')) ?? DEFAULT_MODEL,
    defaultBrowserBackend: (yield* setting<BrowserBackend>('defaultBrowserBackend')) ?? 'browser-run',
    robotSpendLimitUsd: (yield* setting<number | null>('robotSpendLimitUsd')) ?? null,
    memberSpendLimitUsd: (yield* setting<number | null>('memberSpendLimitUsd')) ?? null,
  } as HomeSettings
})

/** Admin settings; a raised spend limit unblocks Robots stopped by the old one (robot-8gag). */
const updateSettings = (patch: Partial<HomeSettings> & { models?: readonly ModelOption[] }) => Effect.gen(function* () {
  const sql = yield* Sql
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) yield* putSetting(key, value)
  }
  if (patch.robotSpendLimitUsd !== undefined || patch.memberSpendLimitUsd !== undefined) {
    const blocked = yield* sql.all<{ id: string }>("SELECT id FROM robot WHERE status = 'blocked'")
    yield* Effect.forEach(blocked, ({ id }) => remote((env) => env.ROBOT.getByName(id).recheckLimits()), { concurrency: 'unbounded', discard: true })
  }
  return yield* settings
})

/** Spend limits a Robot's Turns are held to. */
const limitsFor = (memberId: string) => Effect.gen(function* () {
  const current = yield* settings
  const usage = yield* remote((env) => env.MEMBER.getByName(memberId).usage(currentMonth()))
  return { robotDefaultUsd: current.robotSpendLimitUsd, memberUsd: current.memberSpendLimitUsd, memberSpentUsd: usage.costUsd }
})

// ------------------------------------------------------------------ Robot registry

const summary = (row: RobotSql) => Effect.gen(function* () {
  const entry = entryFromSql(row)
  return { ...entry, ownerName: (yield* member(entry.ownerId))?.name ?? '', unread: false } as RobotSummary
})

/** Robots a Member can reach: their own, and everything shared with the Home (robot-hpj1, robot-bld3). */
const reachable = (memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const rows = yield* sql.all<RobotSql>("SELECT * FROM robot WHERE status != 'deleted' AND (owner_id = ? OR sharing = 'home') ORDER BY last_at DESC", memberId)
  return yield* Effect.forEach(rows, summary)
})

/** Every Robot, for the admin fleet view. */
const fleet = Effect.gen(function* () {
  const sql = yield* Sql
  return yield* Effect.forEach(yield* sql.all<RobotSql>("SELECT * FROM robot WHERE status != 'deleted' ORDER BY last_at DESC"), summary)
})

const entry = (robotId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<RobotSql>('SELECT * FROM robot WHERE id = ?', robotId)
  return row === undefined ? undefined : entryFromSql(row)
})

/** Whether a Member may use a Robot: 'owner', 'shared', or null. */
const access = (memberId: string, robotId: string) => Effect.gen(function* () {
  const found = yield* entry(robotId)
  if (found === undefined || found.status === 'deleted') return null
  if (found.ownerId === memberId) return 'owner' as const
  if (found.sharing === 'home' && (yield* member(memberId))?.status === 'active') return 'shared' as const
  return null
})

/** Recipient Grants of every Mr. Robot: all Robots its Member can reach, except itself. */
const syncMrRobots = Effect.gen(function* () {
  const sql = yield* Sql
  const mrRobots = yield* sql.all<RobotSql>("SELECT * FROM robot WHERE kind = 'mr-robot' AND status != 'deleted'")
  yield* Effect.forEach(mrRobots, (mrRobot) => Effect.gen(function* () {
    const recipients = (yield* reachable(mrRobot.owner_id)).filter((robot) => robot.kind === 'robot').map((robot) => robot.id)
    yield* remote((env) => env.ROBOT.getByName(mrRobot.id).setRecipients(recipients))
  }), { concurrency: 'unbounded', discard: true })
})

/**
 * A Robot reports its registry row after anything visible changed. Sharing,
 * creation and deletion change who can reach it, so Mr. Robot's recipients follow (robot-70kf).
 */
const robotChanged = (changed: RegistryEntry) => Effect.gen(function* () {
  const sql = yield* Sql
  const before = yield* entry(changed.id)
  yield* sql.run(
    `INSERT INTO robot (id, owner_id, kind, identity, sharing, status, fleet_state, last_line, last_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET identity = excluded.identity, sharing = excluded.sharing, status = excluded.status,
       fleet_state = excluded.fleet_state, last_line = excluded.last_line, last_at = excluded.last_at`,
    changed.id, changed.ownerId, changed.kind, JSON.stringify(changed.identity), changed.sharing, changed.status,
    changed.fleetState, changed.lastLine, changed.lastAt,
  )
  const reach = (value: RegistryEntry | undefined) => value === undefined ? 'none' : `${value.sharing}:${value.status === 'deleted'}`
  if (changed.kind === 'robot' && reach(before) !== reach(changed)) yield* syncMrRobots
})

/** The model a new Robot of this Member starts on: the Home default if they can use it, else one they can. */
const startingModel = (memberId: string, wanted?: ModelChoice) => Effect.gen(function* () {
  const usable = yield* models(memberId)
  const pick = wanted ?? (yield* settings).defaultModel
  // Only a known Provider can be missing a connection; anything else (an admin's own entry) is kept.
  if (!(PROVIDER_IDS as readonly string[]).includes(pick.provider) || usable.some((option) => option.provider === pick.provider && option.model === pick.model)) return pick
  // A Provider the person connected themselves comes first; Workers AI is the fallback that is always there.
  const fallback = FALLBACK_ORDER.map((provider) => usable.find((option) => option.provider === provider)).find((option) => option !== undefined) ?? usable[0]
  if (fallback === undefined) return yield* invalid('Connect a Provider first: open your name → Providers and add a key or a subscription.')
  return { provider: fallback.provider, model: fallback.model, effort: 'off' } as ModelChoice
})

/**
 * Create a Robot in setup (robot-btct): its Conversation opens with the kickoff Turn in
 * which it interviews its owner. Used by "New robot" and by Mr. Robot (robot-hk2s).
 */
const createRobot = (ownerId: string, brief?: string, model?: ModelChoice) => Effect.gen(function* () {
  const owner = yield* member(ownerId)
  if (owner === undefined || owner.status !== 'active') return yield* notFound('unknown member')
  const id = `r-${crypto.randomUUID()}`
  const profile = yield* remote((env) => env.MEMBER.getByName(ownerId).profile())
  const starting = yield* startingModel(ownerId, model)
  yield* remote((env) => env.ROBOT.getByName(id).create({
    id,
    ownerId,
    ownerName: owner.name,
    kind: 'robot',
    identity: { name: 'New robot', title: '', description: '', avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]! },
    sharing: 'private',
    status: 'setup',
    model: starting,
    timeZone: profile.timeZone,
    spendLimitUsd: null,
    ...(brief === undefined || brief.trim() === '' ? {} : { brief }),
  }))
  const created = yield* entry(id)
  if (created === undefined) return yield* Effect.die(new Error('robot did not register'))
  return created
})

const bootstrapMrRobot = (owner: MemberView) => Effect.gen(function* () {
  const id = `mr-robot-${owner.id}`
  if ((yield* entry(id)) !== undefined) return
  // Mr. Robot exists from the first sign-in; with nothing connected his first Turn points to Providers.
  const model = yield* startingModel(owner.id).pipe(Effect.catch(() => Effect.map(settings, (current) => current.defaultModel)))
  yield* remote((env) => env.ROBOT.getByName(id).create({
    id,
    ownerId: owner.id,
    ownerName: owner.name,
    kind: 'mr-robot',
    identity: { name: 'Mr. Robot', title: '', description: `${owner.name}'s personal Robot: creates and coordinates the others.`, avatarColor: MR_ROBOT_COLOR },
    sharing: 'private',
    status: 'active',
    model,
    timeZone: 'Europe/Warsaw',
    spendLimitUsd: null,
  }))
  yield* syncMrRobots
})

// ------------------------------------------------------------------ deletion and reset (v1.3 ticket 06)

/** Remove a Robot everywhere: its DO and files, its registry row, and every recipient grant naming it. */
const destroyRobot = (robotId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* remote((env) => env.ROBOT.getByName(robotId).destroy())
  yield* sql.run('DELETE FROM robot WHERE id = ?', robotId)
  const others = yield* sql.all<{ id: string }>('SELECT id FROM robot')
  yield* Effect.forEach(others, (other) => remote((env) => env.ROBOT.getByName(other.id).dropRecipient(robotId)).pipe(Effect.catch(() => Effect.void)), { concurrency: 8, discard: true })
})

/** The typed name must match exactly (pl-kehf). */
const confirmed = (typed: string, name: string) => (typed.trim() === name.trim() ? Effect.void : invalid(`type "${name}" exactly to confirm`))

/** Delete a Robot of this Member (pl-3uoy); Mr. Robot cannot be deleted. */
const deleteRobot = (memberId: string, robotId: string, typed: string) => Effect.gen(function* () {
  const found = yield* entry(robotId)
  if (found === undefined || found.ownerId !== memberId) return yield* notFound('no such robot of yours')
  if (found.kind === 'mr-robot') return yield* invalid('Mr. Robot cannot be deleted; clear its history instead')
  yield* confirmed(typed, found.identity.name)
  yield* destroyRobot(robotId)
  yield* syncMrRobots
})

/** Clear a Robot's history (pl-05eu, pl-y228), memory too when asked. */
const clearRobot = (memberId: string, robotId: string, typed: string, memory: boolean) => Effect.gen(function* () {
  const found = yield* entry(robotId)
  if (found === undefined || found.ownerId !== memberId) return yield* notFound('no such robot of yours')
  yield* confirmed(typed, found.identity.name)
  yield* remote((env) => env.ROBOT.getByName(robotId).clearHistory(memory))
})

/**
 * Reset everything of this Member (pl-062x): every Robot (Mr. Robot is made again, fresh), their
 * memory files, usage and list preferences. Logins, providers, hosts, members and the skill library stay.
 */
const resetMember = (memberId: string, typed: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const who = yield* member(memberId)
  if (who === undefined) return yield* notFound('unknown member')
  yield* confirmed(typed, who.name)
  const own = yield* sql.all<{ id: string }>('SELECT id FROM robot WHERE owner_id = ?', memberId)
  yield* Effect.forEach(own, (robot) => destroyRobot(robot.id), { discard: true })
  yield* remote((env) => env.MEMBER.getByName(memberId).resetData())
  yield* bootstrapMrRobot(who)
  yield* syncMrRobots
})

// ------------------------------------------------------------------ admin view (robot-x26m, robot-1rap, robot-bvme)

type SkillSql = { name: string; description: string; source: 'git' | 'robot' | 'home'; visibility: 'home' | 'private'; owner_id: string | null; updated_at: number; edited?: number }
const skillFromSql = (row: SkillSql): SkillView => ({ name: row.name, description: row.description, source: row.source, visibility: row.visibility, ownerId: row.owner_id, updatedAt: row.updated_at, edited: row.edited === 1 })

const adminView = (adminId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const month = currentMonth()
  const current = yield* settings
  const rows = yield* Effect.forEach(yield* fleet, (row) => Effect.map(remote((env) => env.ROBOT.getByName(row.id).adminRow()), (admin) => (admin === null ? null : { summary: row, row: admin })), { concurrency: 'unbounded' })
  const live = rows.filter((value): value is NonNullable<typeof value> => value !== null)
  const everyone = yield* members
  const memberRows = yield* Effect.forEach(everyone, (person) => Effect.gen(function* () {
    const usage = person.status === 'invited' ? { inputTokens: 0, outputTokens: 0, costUsd: 0 } : yield* remote((env) => env.MEMBER.getByName(person.id).usage(month))
    return { ...person, usage: { month, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd, limitUsd: current.memberSpendLimitUsd } }
  }), { concurrency: 'unbounded' })
  const providers = (yield* Effect.forEach(everyone.filter((person) => person.status === 'active'), (person) =>
    Effect.map(remote((env) => env.MEMBER.getByName(person.id).providers()), (views) => views.map((view) => ({ provider: view.provider, ownerName: person.name, shared: view.shared }))), { concurrency: 'unbounded' })).flat()
  return {
    fleet: live.map(({ summary: row, row: admin }) => ({ ...row, fleetState: admin.fleetState, status: admin.status, grants: admin.grants, model: admin.model, usage: admin.usage })),
    routines: live.flatMap(({ summary: row, row: admin }) => admin.routines.map((routine) => ({ ...routine, robotName: row.identity.name, ownerName: row.ownerName })))
      .sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity)),
    members: memberRows,
    skills: (yield* sql.all<SkillSql>('SELECT * FROM skill ORDER BY name')).map(skillFromSql),
    skillRepository: yield* skillRepository,
    providers,
    modelLists: yield* catalogStatus,
    settings: { ...current, models: yield* models(adminId) },
    browserBackends: yield* browserBackends,
    vpnConfigured: (yield* setting<string>('vpn-config')) !== undefined,
    exaConfigured: (yield* setting<string>('exa-key')) !== undefined,
    proxyConfigured: (yield* setting<string>('proxy-config')) !== undefined,
    hosts: yield* allHosts,
  } as AdminView
})

// ------------------------------------------------------------------ settings catalog (robot-vqtw)

/** The Home's Proton VPN WireGuard configuration (rb-rb1x), sealed; never shown back or logged. */
const vpnConfig = Effect.gen(function* () {
  const platform = yield* HomePlatform
  const sealed = yield* setting<string>('vpn-config')
  return sealed === undefined ? null : yield* platform.secrets.open(sealed)
})

const setVpnConfig = (config: string | null) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* HomePlatform
  if (config === null || config.trim() === '') return yield* sql.run("DELETE FROM setting WHERE k = 'vpn-config'")
  if (!/\[Interface\][\s\S]*PrivateKey[\s\S]*\[Peer\][\s\S]*Endpoint/i.test(config)) return yield* invalid('This is not a WireGuard configuration: it needs [Interface] with PrivateKey and [Peer] with Endpoint.')
  yield* putSetting('vpn-config', yield* platform.secrets.seal(config.trim()))
})

/** The Home's Exa API key (rb-x8i3), sealed; never shown back. */
const exaKey = Effect.gen(function* () {
  const platform = yield* HomePlatform
  const sealed = yield* setting<string>('exa-key')
  return sealed === undefined ? null : yield* platform.secrets.open(sealed)
})

const setExaKey = (key: string | null) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* HomePlatform
  if (key === null || key.trim() === '') return yield* sql.run("DELETE FROM setting WHERE k = 'exa-key'")
  yield* putSetting('exa-key', yield* platform.secrets.seal(key.trim()))
})

/** The proxy address for "Container Chrome via proxy" (v1.2 ticket 05, hs-naw6), sealed. */
const proxyConfig = Effect.gen(function* () {
  const platform = yield* HomePlatform
  const sealed = yield* setting<string>('proxy-config')
  return sealed === undefined ? null : yield* platform.secrets.open(sealed)
})

const setProxyConfig = (url: string | null) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* HomePlatform
  if (url === null || url.trim() === '') return yield* sql.run("DELETE FROM setting WHERE k = 'proxy-config'")
  let parsed: URL
  try { parsed = new URL(url.trim()) } catch { return yield* invalid('a proxy address looks like http://user:password@host:port or socks5://user:password@host:port') }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || parsed.port === '') return yield* invalid('a proxy address looks like http://user:password@host:port or socks5://user:password@host:port')
  yield* putSetting('proxy-config', yield* platform.secrets.seal(url.trim()))
})

// ------------------------------------------------------------------ Hosts (v1.2): index, sharing, pairing

type HostSql = { id: string; owner_id: string; name: string; platform: string; sharing: 'private' | 'home'; online: number; last_seen: number | null; version: string | null; capabilities: string | null; users: string }

/** The Member DO reports each host; the Home keeps the index for sharing and the admin view. */
const hostChanged = (entry: HostEntry | { id: string; removed: true }) => Effect.gen(function* () {
  const sql = yield* Sql
  if ('removed' in entry) return yield* sql.run('DELETE FROM host WHERE id = ?', entry.id)
  yield* sql.run(
    `INSERT INTO host (id, owner_id, name, platform, sharing, online, last_seen, version, capabilities, users) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, platform = excluded.platform, sharing = excluded.sharing, online = excluded.online,
       last_seen = excluded.last_seen, version = excluded.version, capabilities = excluded.capabilities, users = excluded.users`,
    entry.id, entry.ownerId, entry.name, entry.platform, entry.sharing, entry.online ? 1 : 0, entry.lastSeen, entry.version,
    entry.capabilities === null ? null : JSON.stringify(entry.capabilities), JSON.stringify(entry.users),
  )
})

const hostViews = (rows: readonly HostSql[], memberId: string | null) => Effect.gen(function* () {
  const sql = yield* Sql
  const names = new Map((yield* sql.all<{ id: string; name: string }>('SELECT id, name FROM member')).map((row) => [row.id, row.name]))
  return rows.map((row): HostView => ({
    id: row.id, name: row.name, platform: row.platform, ownerId: row.owner_id, ownerName: names.get(row.owner_id) ?? 'someone', sharing: row.sharing,
    online: row.online === 1, lastSeen: row.last_seen, version: row.version, capabilities: row.capabilities === null ? null : JSON.parse(row.capabilities),
    mine: row.owner_id === memberId, users: JSON.parse(row.users) as string[],
  }))
})

/** Hosts a Member's robots can reach: their own, and those shared with the Home (hs-0eka). */
const hostsFor = (memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  return yield* hostViews(yield* sql.all<HostSql>("SELECT * FROM host WHERE owner_id = ? OR sharing = 'home' ORDER BY name", memberId), memberId)
})

const allHosts = Effect.gen(function* () {
  const sql = yield* Sql
  return yield* hostViews(yield* sql.all<HostSql>('SELECT * FROM host ORDER BY name'), null)
})

const hostOwner = (id: string) => Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.first<{ owner_id: string }>('SELECT owner_id FROM host WHERE id = ?', id))?.owner_id ?? null
})

/** Device pairing (hs-hend): the app gets a code, the Member approves it signed in, the app picks up its token. */
const startPairing = (name: string, platform: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const code = [...crypto.getRandomValues(new Uint8Array(5))].map((byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32]).join('') + '-' + [...crypto.getRandomValues(new Uint8Array(4))].map((byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32]).join('')
  yield* sql.run("DELETE FROM host_pairing WHERE created_at < ?", Date.now() - 15 * 60_000)
  yield* sql.run('INSERT INTO host_pairing (code, name, platform, created_at) VALUES (?, ?, ?, ?)', code, name.trim().slice(0, 80) || 'Host', platform.slice(0, 40), Date.now())
  return { code }
})

const pairingView = (code: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<{ name: string; platform: string; host_id: string | null; created_at: number }>('SELECT name, platform, host_id, created_at FROM host_pairing WHERE code = ?', code)
  if (row === undefined || row.created_at < Date.now() - 15 * 60_000) return yield* notFound('this pairing code is unknown or expired; start pairing again in the app')
  return { name: row.name, platform: row.platform, approved: row.host_id !== null }
})

const approvePairing = (code: string, memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const pending = yield* pairingView(code)
  if (pending.approved) return yield* invalid('this computer is already paired')
  const paired = yield* remote((env) => env.MEMBER.getByName(memberId).pairHost(pending.name, pending.platform))
  yield* sql.run('UPDATE host_pairing SET host_id = ?, token = ?, member_id = ? WHERE code = ?', paired.hostId, paired.token, memberId, code)
  return { hostId: paired.hostId, name: pending.name }
})

/** The app's poll: the token is handed over once, then the pairing is forgotten. */
const pollPairing = (code: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<{ host_id: string | null; token: string | null; created_at: number }>('SELECT host_id, token, created_at FROM host_pairing WHERE code = ?', code)
  if (row === undefined || row.created_at < Date.now() - 15 * 60_000) return { status: 'expired' as const }
  if (row.host_id === null || row.token === null) return { status: 'pending' as const }
  yield* sql.run('DELETE FROM host_pairing WHERE code = ?', code)
  return { status: 'paired' as const, hostId: row.host_id, token: row.token }
})

/** Browser backends this Home can run, with the host browsers this Member reaches. */
const browserBackendsFor = (memberId: string | null) => Effect.gen(function* () {
  const platform = yield* HomePlatform
  const hosts = memberId === null ? [] : yield* hostsFor(memberId)
  return backendOptions(platform.env, { vpn: (yield* setting<string>('vpn-config')) !== undefined, proxy: (yield* setting<string>('proxy-config')) !== undefined }, hosts)
})

const browserBackends = browserBackendsFor(null)

const sharedSecrets = Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* HomePlatform
  const rows = yield* sql.all<{ name: string; owner_id: string; sealed: string; updated_at: number }>('SELECT name, owner_id, sealed, updated_at FROM shared_secret ORDER BY name')
  return yield* Effect.forEach(rows, (row) => Effect.map(platform.secrets.open(row.sealed), (text) => ({ name: row.name, ownerId: row.owner_id, updatedAt: row.updated_at, ...metaOf(parseEntry(text)) })))
})

const grantableSecrets = (memberId: string) => Effect.gen(function* () {
  const own = (yield* remote((env) => env.MEMBER.getByName(memberId).logins())).map(({ name, username, websites }) => ({ name, scope: 'member' as const, username, websites }))
  const shared = (yield* sharedSecrets).filter(({ name }) => !own.some((secret) => secret.name === name)).map(({ name, username, websites }) => ({ name, scope: 'home' as const, username, websites }))
  return [...own, ...shared] as SettingsCatalog['secrets']
})

/** What a Member can grant a Robot and which models it can run on. */
const catalog = (memberId: string, robotId: string) => Effect.gen(function* () {
  return {
    toolGroups: yield* Effect.map(setting<string>('exa-key'), (key) => Object.entries(TOOL_GROUPS).filter(([name]) => name !== 'robots').map(([name, description]) => ({ name, description: name.startsWith('exa') && key === undefined ? `${description} Needs the Home's Exa API key: the Home admin adds it under Admin → Exa.` : description }))),
    skills: (yield* skills(memberId)).map(({ name, description }) => ({ name, description })),
    robots: (yield* reachable(memberId)).filter((robot) => robot.id !== robotId && robot.kind === 'robot').map((robot) => ({ id: robot.id, name: robot.identity.name })),
    secrets: yield* grantableSecrets(memberId),
    models: yield* models(memberId),
    unavailableModels: yield* unavailableModels(memberId),
    browserBackends: yield* browserBackendsFor(memberId),
    hosts: yield* hostsFor(memberId),
    defaultBrowserBackend: (yield* settings).defaultBrowserBackend,
  } as SettingsCatalog
})

// ------------------------------------------------------------------ the skill library (robot-7qpi, robot-qjvu, robot-lszy, robot-jqfw)

/** Skills a Member can see: every Home skill, and private skills of their own Robots. */
const skills = (memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.all<SkillSql>("SELECT * FROM skill WHERE visibility = 'home' OR owner_id = ? ORDER BY name", memberId)).map(skillFromSql)
})

/** Which of these names a Robot of this owner may load. */
const loadableSkills = (memberId: string, names: readonly string[]) => Effect.map(skills(memberId), (all) => all.filter((skill) => names.includes(skill.name)))

const skillRepository = Effect.map(setting<SkillRepository>('skillRepository'), (value) => value ?? null)

const setSkillRepository = (repository: SkillRepository, token: string | undefined) => Effect.gen(function* () {
  const platform = yield* HomePlatform
  yield* putSetting('skillRepository', repository)
  if (token !== undefined) yield* putSetting('skillRepositoryToken', yield* platform.secrets.seal(token))
})

const storeSkillFiles = (name: string, files: ReadonlyArray<{ path: string; body: Uint8Array }>) => remote(async (env) => {
  const existing = await env.FILES.list({ prefix: `skills/${name}/` })
  if (existing.objects.length > 0) await env.FILES.delete(existing.objects.map((object) => object.key))
  await Promise.all(files.map((file) => env.FILES.put(`skills/${name}/${file.path}`, file.body)))
})

const upsertSkill = (name: string, description: string, source: 'git' | 'robot' | 'home', visibility: 'home' | 'private', ownerId: string | null) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run(
    `INSERT INTO skill (name, description, source, visibility, owner_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET description = excluded.description, source = excluded.source,
       visibility = excluded.visibility, owner_id = excluded.owner_id, updated_at = excluded.updated_at`,
    name, description, source, visibility, ownerId, Date.now(),
  )
})

/** Pull the configured repository; its skills replace the previous Git skills (robot-qjvu). */
const syncSkills = Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* HomePlatform
  const repository = yield* skillRepository
  if (repository === null) return yield* invalid('set the skills repository first')
  const sealed = yield* setting<string>('skillRepositoryToken')
  const token = sealed === undefined ? null : yield* platform.secrets.open(sealed)
  const files = yield* fetchRepository(repository, token).pipe(Effect.mapError((error) => invalid(error.message)))
  const found = skillsInTree(files, repository.path)
  const previous = (yield* sql.all<{ name: string }>("SELECT name FROM skill WHERE source = 'git'")).map((row) => row.name)
  // A skill edited here is never overwritten or removed by a sync (rb-t937).
  const edited = new Set((yield* sql.all<{ name: string }>('SELECT name FROM skill WHERE edited = 1')).map((row) => row.name))
  for (const skill of found) {
    if (edited.has(skill.name)) continue
    yield* storeSkillFiles(skill.name, skill.files)
    yield* upsertSkill(skill.name, skill.description, 'git', 'home', null)
  }
  for (const gone of previous.filter((name) => !found.some((skill) => skill.name === name) && !edited.has(name))) {
    yield* sql.run("DELETE FROM skill WHERE name = ? AND source = 'git'", gone)
  }
  return { synced: found.map((skill) => skill.name) }
})

/** An approved Robot proposal enters the library (robot-jqfw). */
const publishSkill = (ownerId: string, name: string, description: string, content: string, visibility: 'home' | 'private') => Effect.gen(function* () {
  const sql = yield* Sql
  const existing = yield* sql.first<{ source: string; owner_id: string | null }>('SELECT source, owner_id FROM skill WHERE name = ?', name)
  if (existing !== undefined && (existing.source === 'git' || existing.owner_id !== ownerId)) return yield* invalid(`a skill named "${name}" already exists`)
  yield* storeSkillFiles(name, [{ path: 'SKILL.md', body: new TextEncoder().encode(content) }])
  yield* upsertSkill(name, description, 'robot', visibility, ownerId)
})

/** Write a global skill from the UI or Mr. Robot (rb-5ku3, rb-axxy); an imported one becomes "edited". */
const saveSkill = (name: string, description: string, content: string, by: string | null) => Effect.gen(function* () {
  const sql = yield* Sql
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return yield* invalid('a skill name is lowercase letters, digits and dashes')
  const existing = yield* sql.first<{ source: string; visibility: string; owner_id: string | null }>('SELECT source, visibility, owner_id FROM skill WHERE name = ?', name)
  yield* storeSkillFiles(name, [{ path: 'SKILL.md', body: new TextEncoder().encode(content) }])
  if (existing === undefined) {
    yield* upsertSkill(name, description, 'home', 'home', by)
  } else {
    yield* sql.run('UPDATE skill SET description = ?, edited = CASE WHEN source = \'git\' THEN 1 ELSE edited END, updated_at = ? WHERE name = ?', description, Date.now(), name)
  }
})

const deleteSkill = (name: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('DELETE FROM skill WHERE name = ?', name)
  yield* remote(async (env) => {
    const existing = await env.FILES.list({ prefix: `skills/${name}/` })
    if (existing.objects.length > 0) await env.FILES.delete(existing.objects.map((object) => object.key))
  })
})

const skillContent = (memberId: string, name: string, path = 'SKILL.md') => Effect.gen(function* () {
  if (!(yield* skills(memberId)).some((skill) => skill.name === name)) return null
  return yield* remote(async (env) => {
    const object = await env.FILES.get(`skills/${name}/${path.replace(/\.\.\//g, '')}`)
    return object === null ? null : object.text()
  })
})

// ------------------------------------------------------------------ secrets (robot-vplt, robot-0bde)

const sharedSecret = (name: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* HomePlatform
  const row = yield* sql.first<{ sealed: string }>('SELECT sealed FROM shared_secret WHERE name = ?', name)
  return row === undefined ? null : yield* platform.secrets.open(row.sealed)
})

/** An entry the Member may change: their private one, or a Home one they shared. */
const ownLogin = (memberId: string, name: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const shared = yield* sql.first<{ owner_id: string }>('SELECT owner_id FROM shared_secret WHERE name = ?', name)
  if (shared !== undefined && shared.owner_id !== memberId) return yield* invalid(`"${name}" is shared by another Member`)
  const text = shared !== undefined ? yield* sharedSecret(name) : yield* remote((env) => env.MEMBER.getByName(memberId).secret(name))
  return { entry: text === null ? null : parseEntry(text), shared: shared !== undefined }
})

/**
 * Store a login entry (rb-4dxe): private ones stay in the Member DO, Home ones live here (rb-ob2g).
 * Changing the scope moves the entry; fields left out keep their value (the password is not resent).
 */
const putLogin = (memberId: string, name: string, patch: Partial<LoginEntry>, shared: boolean) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* HomePlatform
  const current = yield* ownLogin(memberId, name)
  const base = current.entry ?? { username: '', password: '', websites: [], notes: '', allowRead: false }
  const entry: LoginEntry = { ...base, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
  if (entry.password === '') return yield* invalid('a login needs a password')
  const holder = () => platform.env.MEMBER.getByName(memberId)
  const text = serializeEntry(entry)
  if (shared) {
    yield* Effect.promise(() => holder().takeSecret(name))
    const sealed = yield* platform.secrets.seal(text)
    yield* sql.run('INSERT INTO shared_secret (name, owner_id, sealed, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at', name, memberId, sealed, Date.now())
    return
  }
  yield* Effect.promise(() => holder().setSecret(name, text))
  if (current.shared) yield* sql.run('DELETE FROM shared_secret WHERE name = ?', name)
})

const deleteSecret = (memberId: string, name: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('DELETE FROM shared_secret WHERE name = ? AND owner_id = ?', name, memberId)
  yield* remote((env) => env.MEMBER.getByName(memberId).takeSecret(name))
})

/** The entry a Robot of this owner uses: the owner's private one, else the Home's. */
const resolveLogin = (memberId: string, name: string) => Effect.gen(function* () {
  const text = (yield* remote((env) => env.MEMBER.getByName(memberId).secret(name))) ?? (yield* sharedSecret(name))
  return text === null ? null : parseEntry(text)
})

/** The password, for masking what a Robot shows. */
const resolveSecret = (memberId: string, name: string) => Effect.map(resolveLogin(memberId, name), (entry) => entry?.password ?? null)

/** Reveal (rb-4dxe): only the Member's own entries. */
const revealLogin = (memberId: string, name: string) => Effect.gen(function* () {
  const current = yield* ownLogin(memberId, name)
  if (current.entry === null) return yield* notFound(`no login "${name}"`)
  return current.entry.password
})

/** The Logins section: own and Home entries, and which of the Member's Robots hold each (rb-4dxe, rb-2myk). */
const secretsView = (memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const own = (yield* remote((env) => env.MEMBER.getByName(memberId).logins())).map((secret) => ({ ...secret, scope: 'member' as const, mine: true }))
  const shared = (yield* sharedSecrets).map(({ ownerId, ...secret }) => ({ ...secret, scope: 'home' as const, mine: ownerId === memberId }))
  const robots = yield* sql.all<{ id: string; name: string }>("SELECT id, json_extract(identity, '$.name') AS name FROM robot WHERE owner_id = ? AND status != 'deleted'", memberId)
  const grants = yield* Effect.forEach(robots, (robot) => Effect.map(remote((env) => env.ROBOT.getByName(robot.id).grants()), (granted) => ({ name: robot.name, secrets: granted.secrets })).pipe(Effect.orElseSucceed(() => ({ name: robot.name, secrets: [] as readonly string[] }))), { concurrency: 8 })
  return [...own, ...shared].map((entry) => ({ ...entry, robots: grants.filter((robot) => robot.secrets.includes(entry.name)).map((robot) => robot.name) }))
})

// ------------------------------------------------------------------ live model lists (robot-82r5, robot-d994)

/** Providers this Member's Robots can run on: Workers AI, their own credentials, Home-shared ones. */
const usableProviders = (memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const usable = new Set<string>(['workers-ai'])
  for (const view of yield* remote((env) => env.MEMBER.getByName(memberId).providers())) usable.add(view.provider)
  for (const row of yield* sql.all<{ provider: string }>('SELECT DISTINCT provider FROM shared_credential')) usable.add(row.provider)
  return usable
})

const catalogRow = (provider: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<{ models: string | null; fetched_at: number | null; error: string | null }>('SELECT models, fetched_at, error FROM model_catalog WHERE provider = ?', provider)
  return row === undefined ? undefined : { models: row.models === null ? null : JSON.parse(row.models) as ModelOption[], fetchedAt: row.fetched_at, error: row.error }
})

/** models.dev metadata, refreshed daily; a failed refresh keeps the last copy (or none). */
const metadata = Effect.gen(function* () {
  const stored = yield* setting<{ data: MetadataIndex; fetchedAt: number }>('model-metadata')
  if (stored !== undefined && Date.now() - stored.fetchedAt < CATALOG_TTL_MS) return stored.data
  const fresh = yield* Effect.tryPromise(() => fetchMetadata()).pipe(Effect.option)
  if (fresh._tag === 'None') {
    console.warn('models.dev metadata unavailable')
    return stored?.data ?? {}
  }
  yield* putSetting('model-metadata', { data: fresh.value, fetchedAt: Date.now() })
  return fresh.value
})

/** The credential a Member's Robot uses: the Member's own, else one shared with the Home. */
const providerCredential = (memberId: string, provider: ProviderId) => Effect.gen(function* () {
  const sql = yield* Sql
  const own = (yield* remote((env) => env.MEMBER.getByName(memberId).credential(provider, false) as Promise<ProviderCredential | null>))
  if (own !== null) return own
  const sharers = yield* sql.all<{ member_id: string }>('SELECT member_id FROM shared_credential WHERE provider = ? AND member_id != ?', provider, memberId)
  for (const { member_id } of sharers) {
    if ((yield* member(member_id))?.status !== 'active') continue
    const shared = yield* remote((env) => env.MEMBER.getByName(member_id).credential(provider, true) as Promise<ProviderCredential | null>)
    if (shared !== null) return shared
  }
  return null as ProviderCredential | null
})

/** Whose OpenCode Go pool a Member's Robots use: their own, else the first one shared with the Home. */
const opencodePoolOwner = (memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const own = yield* remote((env) => env.MEMBER.getByName(memberId).opencodeKeys())
  if (own.keys.length > 0) return { ownerId: memberId, forHome: false }
  for (const { member_id } of yield* sql.all<{ member_id: string }>("SELECT member_id FROM shared_credential WHERE provider = 'opencode-go' AND member_id != ?", memberId)) {
    if ((yield* member(member_id))?.status === 'active') return { ownerId: member_id, forHome: true }
  }
  return null as { ownerId: string; forHome: boolean } | null
})

const listingAccess = (provider: string, memberId: string) => Effect.gen(function* () {
  const platform = yield* HomePlatform
  if (provider === 'workers-ai') return (platform.env.AI === undefined ? {} : { ai: platform.env.AI }) as ListingAccess
  if (provider === 'openrouter') return {} as ListingAccess
  if (provider === 'opencode-go') {
    const owner = yield* opencodePoolOwner(memberId)
    if (owner === null) return yield* invalid('no OpenCode Go key')
    const pool = yield* remote((env) => env.MEMBER.getByName(owner.ownerId).opencodeCandidates(null, owner.forHome))
    const key = pool.keys[0]?.key
    if (key === undefined) return yield* invalid('no OpenCode Go key')
    return { key } as ListingAccess
  }
  const credential = yield* providerCredential(memberId, provider as ProviderId)
  if (credential === null) return yield* invalid(`no ${provider} credential`)
  return (credential.kind === 'api-key' ? { key: credential.key } : { oauth: { access: credential.access, ...(credential.accountId === undefined ? {} : { accountId: credential.accountId }) } }) as ListingAccess
})

/** Fetch one Provider's live list with a credential this Member can use; a failure keeps the last list. */
const refreshCatalog = (provider: string, memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const platform = yield* HomePlatform
  const services = yield* Effect.context<R>()
  platform.catalogTries.set(provider, Date.now())
  const fetched = yield* listingAccess(provider, memberId).pipe(
    Effect.flatMap((listing) => Effect.tryPromise(() => liveModels(provider, listing, () => Effect.runPromise(Effect.provideContext(metadata, services))))),
    Effect.result,
  )
  if (fetched._tag === 'Success') {
    yield* sql.run('INSERT INTO model_catalog (provider, models, fetched_at, error) VALUES (?, ?, ?, NULL) ON CONFLICT (provider) DO UPDATE SET models = excluded.models, fetched_at = excluded.fetched_at, error = NULL', provider, JSON.stringify(fetched.success), Date.now())
    return { provider, count: fetched.success.length, error: null as string | null }
  }
  const failure = fetched.failure as { message?: string; error?: unknown }
  const message = failure.message ?? String(failure.error ?? failure)
  yield* sql.run('INSERT INTO model_catalog (provider, error) VALUES (?, ?) ON CONFLICT (provider) DO UPDATE SET error = excluded.error', provider, message)
  return { provider, count: (yield* catalogRow(provider))?.models?.length ?? 0, error: message as string | null }
})

const ensureCatalog = (provider: string, memberId: string) => Effect.gen(function* () {
  const platform = yield* HomePlatform
  const row = yield* catalogRow(provider)
  if (row?.models != null && row.fetchedAt !== null && Date.now() - row.fetchedAt < CATALOG_TTL_MS) return
  if (row?.error != null && Date.now() - (platform.catalogTries.get(provider) ?? 0) < 60_000) return
  yield* refreshCatalog(provider, memberId)
})

/**
 * Every known model: each Provider's last live list (nothing for a Provider never listed
 * successfully), with the admin's entries on top: an entry for a listed model overrides
 * its label and price, any other entry adds a model.
 */
const modelList = Effect.gen(function* () {
  const stored = (yield* setting<ModelOption[]>('models')) ?? []
  const same = (a: ModelOption, b: ModelOption) => a.provider === b.provider && a.model === b.model
  const live = (yield* Effect.forEach(PROVIDER_IDS, (provider) => Effect.map(catalogRow(provider), (row) => row?.models ?? []))).flat()
  return [
    ...live.map((model) => stored.find((entry) => same(entry, model)) ?? model),
    ...stored.filter((entry) => !live.some((model) => same(entry, model))),
  ]
})

/** The models a Member can choose: the live lists of the Providers they can use (refreshed daily). */
const models = (memberId: string): Effect.Effect<ModelOption[], never, R> => Effect.gen(function* () {
  const usable = yield* usableProviders(memberId)
  yield* Effect.forEach([...usable].filter((provider) => (PROVIDER_IDS as readonly string[]).includes(provider)), (provider) => ensureCatalog(provider, memberId), { concurrency: 'unbounded', discard: true })
  return (yield* modelList).filter((option) => usable.has(option.provider))
})

const unavailableModels = (memberId: string) => Effect.gen(function* () {
  const usable = yield* models(memberId)
  return (yield* modelList).filter((option) => !usable.some((entry) => entry.provider === option.provider && entry.model === option.model))
})

/** Each Provider's list status, for the admin view. */
const catalogStatus = Effect.gen(function* () {
  const sql = yield* Sql
  return (yield* sql.all<{ provider: string; models: string | null; fetched_at: number | null; error: string | null }>('SELECT * FROM model_catalog ORDER BY provider'))
    .map((row) => ({ provider: row.provider, count: row.models === null ? 0 : (JSON.parse(row.models) as unknown[]).length, fetchedAt: row.fetched_at, error: row.error }))
})

/** Refresh every Provider this Member can use (the admin's "Refresh models"). */
const refreshCatalogs = (memberId: string) => Effect.gen(function* () {
  const usable = [...(yield* usableProviders(memberId))].filter((provider) => (PROVIDER_IDS as readonly string[]).includes(provider))
  return yield* Effect.forEach(usable, (provider) => refreshCatalog(provider, memberId), { concurrency: 'unbounded' })
})

// ------------------------------------------------------------------ Providers (robot-dic7)

const credentialShared = (memberId: string, provider: ProviderId, shared: boolean) => Effect.gen(function* () {
  const sql = yield* Sql
  if (shared) yield* sql.run('INSERT INTO shared_credential (provider, member_id) VALUES (?, ?) ON CONFLICT DO NOTHING', provider, memberId)
  else yield* sql.run('DELETE FROM shared_credential WHERE provider = ? AND member_id = ?', provider, memberId)
})

const providersView = (memberId: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const mine = yield* remote((env) => env.MEMBER.getByName(memberId).providers())
  const others = yield* sql.all<{ provider: ProviderId; member_id: string }>('SELECT provider, member_id FROM shared_credential WHERE member_id != ?', memberId)
  const shared: ProviderView[] = []
  for (const { provider, member_id } of others) {
    const sharer = yield* member(member_id)
    if (sharer === undefined || sharer.status !== 'active') continue
    shared.push({ provider, kind: provider === 'openai' || provider === 'anthropic' ? 'oauth' : 'api-key', shared: true, connectedAt: 0, ownerId: sharer.id, ownerName: sharer.name })
  }
  return { mine, shared, models: yield* models(memberId), defaultModel: (yield* settings).defaultModel } as ProvidersView
})

/** Failures the caller should see stay typed; anything else (vault, network) is a defect, i.e. a 500. */
const orDie = <A, E, X>(effect: Effect.Effect<A, E, X>) => effect.pipe(Effect.catch((error: unknown) => (error !== null && typeof error === 'object' && '_tag' in error && ['NotFound', 'Invalid', 'Conflict'].includes((error as { _tag: string })._tag) ? Effect.fail(error as never) : Effect.die(error)))) as Effect.Effect<A, never, X>

/** The Durable Object: tables, the platform layer, and one RPC method per program. */
export class Home extends DurableObject<Env> {
  private readonly runtime: DurableRuntime<R>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const sql = ctx.storage.sql
    sql.exec(`CREATE TABLE IF NOT EXISTS member (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL
    )`)
    sql.exec(`CREATE TABLE IF NOT EXISTS robot (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, identity TEXT NOT NULL,
      sharing TEXT NOT NULL, status TEXT NOT NULL, fleet_state TEXT NOT NULL,
      last_line TEXT NOT NULL, last_at INTEGER NOT NULL
    )`)
    sql.exec('CREATE TABLE IF NOT EXISTS setting (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
    sql.exec(`CREATE TABLE IF NOT EXISTS skill (
      name TEXT PRIMARY KEY, description TEXT NOT NULL, source TEXT NOT NULL, visibility TEXT NOT NULL,
      owner_id TEXT, updated_at INTEGER NOT NULL
    )`)
    try { sql.exec('ALTER TABLE skill ADD COLUMN edited INTEGER NOT NULL DEFAULT 0') } catch { /* added before */ }
    sql.exec('CREATE TABLE IF NOT EXISTS model_catalog (provider TEXT PRIMARY KEY, models TEXT, fetched_at INTEGER, error TEXT)')
    sql.exec('CREATE TABLE IF NOT EXISTS shared_secret (name TEXT PRIMARY KEY, owner_id TEXT NOT NULL, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    sql.exec(`CREATE TABLE IF NOT EXISTS host (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL, sharing TEXT NOT NULL, online INTEGER NOT NULL,
      last_seen INTEGER, version TEXT, capabilities TEXT, users TEXT NOT NULL DEFAULT '[]'
    )`)
    sql.exec('CREATE TABLE IF NOT EXISTS host_pairing (code TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, created_at INTEGER NOT NULL, host_id TEXT, token TEXT, member_id TEXT)')
    sql.exec('CREATE TABLE IF NOT EXISTS shared_credential (provider TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY (provider, member_id)) WITHOUT ROWID')
    // v1.1 (rb-a70a): the library starts empty with no sync source; the source set before and its skills go, once.
    if (sql.exec<{ v: string }>("SELECT v FROM setting WHERE k = 'skills-reset-v1.1'").toArray().length === 0) {
      const imported = sql.exec<{ name: string }>("SELECT name FROM skill WHERE source = 'git'").toArray().map((row) => row.name)
      sql.exec("DELETE FROM skill WHERE source = 'git'")
      sql.exec("DELETE FROM setting WHERE k IN ('skillRepository', 'skillRepositoryToken')")
      sql.exec("INSERT INTO setting (k, v) VALUES ('skills-reset-v1.1', '1')")
      if (imported.length > 0) ctx.waitUntil(Promise.all(imported.map(async (name) => {
        const objects = await env.FILES.list({ prefix: `skills/${name}/` })
        if (objects.objects.length > 0) await env.FILES.delete(objects.objects.map((object) => object.key))
      })))
    }
    this.runtime = new DurableRuntime(Layer.mergeAll(sqlLayer(ctx.storage), Layer.succeed(HomePlatform)({ env, secrets: makeVault(env.DATA_KEY, 'secrets'), catalogTries: new Map() })))
  }

  private run<A, E>(program: Effect.Effect<A, E, R>): Promise<A> {
    return this.runtime.run(orDie(program))
  }

  signIn(email: string): Promise<SignIn> { return this.run(signIn(email)) }
  member(id: string): Promise<MemberView | undefined> { return this.run(member(id)) }
  members(): Promise<MemberView[]> { return this.run(members) }
  invite(email: string, role: MemberRole = 'member'): Promise<MemberView> { return this.run(invite(email, role)) }
  remove(memberId: string): Promise<void> { return this.run(remove(memberId)) }
  rename(memberId: string, name: string): Promise<void> { return this.run(rename(memberId, name)) }
  settings(): Promise<HomeSettings> { return this.run(settings) }
  updateSettings(patch: Partial<HomeSettings> & { models?: readonly ModelOption[] }): Promise<HomeSettings> { return this.run(updateSettings(patch)) }
  limitsFor(memberId: string): Promise<{ robotDefaultUsd: number | null; memberUsd: number | null; memberSpentUsd: number }> { return this.run(limitsFor(memberId)) }
  reachable(memberId: string): Promise<RobotSummary[]> { return this.run(reachable(memberId)) }
  fleet(): Promise<RobotSummary[]> { return this.run(fleet) }
  entry(robotId: string): Promise<RegistryEntry | undefined> { return this.run(entry(robotId)) }
  access(memberId: string, robotId: string): Promise<'owner' | 'shared' | null> { return this.run(access(memberId, robotId)) }
  robotChanged(changed: RegistryEntry): Promise<void> { return this.run(robotChanged(changed)) }
  deleteRobot(memberId: string, robotId: string, typed: string): Promise<void> { return this.run(deleteRobot(memberId, robotId, typed)) }
  clearRobot(memberId: string, robotId: string, typed: string, memory: boolean): Promise<void> { return this.run(clearRobot(memberId, robotId, typed, memory)) }
  resetMember(memberId: string, typed: string): Promise<void> { return this.run(resetMember(memberId, typed)) }
  startingModel(memberId: string, wanted?: ModelChoice): Promise<ModelChoice> { return this.run(startingModel(memberId, wanted)) }
  createRobot(ownerId: string, brief?: string, model?: ModelChoice): Promise<RegistryEntry> { return this.run(createRobot(ownerId, brief, model)) }
  syncMrRobots(): Promise<void> { return this.run(syncMrRobots) }
  adminView(adminId: string): Promise<AdminView> { return this.run(adminView(adminId)) }
  /** What a Member can grant: tool groups of plugins that are on, and their usable connections (v1.5). */
  async catalog(memberId: string, robotId: string): Promise<SettingsCatalog> {
    const base = await this.run(catalog(memberId, robotId))
    const off = disabledToolGroups(this.pluginsOf.enabled())
    const enabled = this.pluginsOf.enabled()
    const connections = (await this.connectionsFor(memberId)).filter((connection) => enabled[connection.kind] !== false)
    return { ...base, toolGroups: base.toolGroups.filter((group) => !off.has(group.name)), connections }
  }
  skills(memberId: string): Promise<SkillView[]> { return this.run(skills(memberId)) }
  loadableSkills(memberId: string, names: readonly string[]): Promise<SkillView[]> { return this.run(loadableSkills(memberId, names)) }
  skillRepository(): Promise<SkillRepository | null> { return this.run(skillRepository) }
  setSkillRepository(repository: SkillRepository, token: string | undefined): Promise<void> { return this.run(setSkillRepository(repository, token)) }
  syncSkills(): Promise<{ synced: string[] }> { return this.run(syncSkills) }
  publishSkill(ownerId: string, name: string, description: string, content: string, visibility: 'home' | 'private'): Promise<void> { return this.run(publishSkill(ownerId, name, description, content, visibility)) }
  skillContent(memberId: string, name: string, path = 'SKILL.md'): Promise<string | null> { return this.run(skillContent(memberId, name, path)) }
  saveSkill(name: string, description: string, content: string, by: string | null): Promise<void> { return this.run(saveSkill(name, description, content, by)) }
  deleteSkill(name: string): Promise<void> { return this.run(deleteSkill(name)) }
  sharedSecrets(): Promise<Array<{ name: string; ownerId: string; updatedAt: number }>> { return this.run(sharedSecrets) }
  putLogin(memberId: string, name: string, patch: Partial<LoginEntry>, shared: boolean): Promise<void> { return this.run(putLogin(memberId, name, patch, shared)) }
  resolveLogin(memberId: string, name: string): Promise<LoginEntry | null> { return this.run(resolveLogin(memberId, name)) }
  revealLogin(memberId: string, name: string): Promise<string> { return this.run(revealLogin(memberId, name)) }
  deleteSecret(memberId: string, name: string): Promise<void> { return this.run(deleteSecret(memberId, name)) }
  resolveSecret(memberId: string, name: string): Promise<string | null> { return this.run(resolveSecret(memberId, name)) }
  secretsView(memberId: string): Promise<LoginView[]> { return this.run(secretsView(memberId)) as Promise<LoginView[]> }
  usableProviders(memberId: string): Promise<Set<string>> { return this.run(usableProviders(memberId)) }
  models(memberId: string): Promise<ModelOption[]> { return this.run(models(memberId)) }
  refreshCatalog(provider: string, memberId: string): Promise<{ provider: string; count: number; error: string | null }> { return this.run(refreshCatalog(provider, memberId)) }
  catalogStatus(): Promise<Array<{ provider: string; count: number; fetchedAt: number | null; error: string | null }>> { return this.run(catalogStatus) }
  refreshCatalogs(memberId: string): Promise<Array<{ provider: string; count: number; error: string | null }>> { return this.run(refreshCatalogs(memberId)) }
  unavailableModels(memberId: string): Promise<ModelOption[]> { return this.run(unavailableModels(memberId)) }
  modelList(): Promise<ModelOption[]> { return this.run(modelList) }
  vpnConfig(): Promise<string | null> { return this.run(vpnConfig) }
  /** The Exa plugin's key (its detail page), or the key saved before plugins had settings. */
  async exaKey(): Promise<string | null> { return (await this.pluginsOf.settings('exa')).secrets['apiKey'] ?? await this.run(exaKey) }

  /** HOME.md: shared household facts for every Robot of the Home (pl-yqno). */
  async homeMemory(): Promise<string> {
    return this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM setting WHERE k = 'home-md'").toArray().map((row) => JSON.parse(row.v) as string)[0] ?? ''
  }

  async setHomeMemory(content: string, by: string, exceptRobot: string | null): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO setting (k, v) VALUES ('home-md', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(content))
    await this.memoryChanged(null, 'HOME.md', by, exceptRobot)
  }

  /** Tell the Robots that read a shared memory file that it changed: one Member's, or every Robot for HOME.md. */
  async memoryChanged(memberId: string | null, path: string, by: string, exceptRobot: string | null): Promise<void> {
    const robots = this.ctx.storage.sql.exec<{ id: string; owner_id: string }>('SELECT id, owner_id FROM robot').toArray()
    await Promise.all(robots.filter((robot) => (memberId === null || robot.owner_id === memberId) && robot.id !== exceptRobot)
      .map((robot) => this.env.ROBOT.getByName(robot.id).memoryChanged(path, by).catch(() => undefined)))
  }
  proxyConfig(): Promise<string | null> { return this.run(proxyConfig) }
  setProxyConfig(url: string | null): Promise<void> { return this.run(setProxyConfig(url)) }
  hostChanged(entry: HostEntry | { id: string; removed: true }): Promise<void> { return this.run(hostChanged(entry)) }
  hostsFor(memberId: string): Promise<HostView[]> { return this.run(hostsFor(memberId)) }
  hostOwner(id: string): Promise<string | null> { return this.run(hostOwner(id)) }
  startPairing(name: string, platform: string): Promise<{ code: string }> { return this.run(startPairing(name, platform)) }
  pairingView(code: string): Promise<{ name: string; platform: string; approved: boolean }> { return this.run(pairingView(code)) }
  approvePairing(code: string, memberId: string): Promise<{ hostId: string; name: string }> { return this.run(approvePairing(code, memberId)) }
  pollPairing(code: string): Promise<{ status: 'expired' | 'pending' } | { status: 'paired'; hostId: string; token: string }> { return this.run(pollPairing(code)) }
  async setExaKey(key: string | null): Promise<void> {
    await this.run(setExaKey(key))
    await this.pluginsOf.setSecret('exa', 'apiKey', key === null || key.trim() === '' ? null : key.trim())
  }
  setVpnConfig(config: string | null): Promise<void> { return this.run(setVpnConfig(config)) }
  credentialShared(memberId: string, provider: ProviderId, shared: boolean): Promise<void> { return this.run(credentialShared(memberId, provider, shared)) }
  providerCredential(memberId: string, provider: ProviderId): Promise<ProviderCredential | null> { return this.run(providerCredential(memberId, provider)) }
  opencodePoolOwner(memberId: string): Promise<{ ownerId: string; forHome: boolean } | null> { return this.run(opencodePoolOwner(memberId)) }
  providersView(memberId: string): Promise<ProvidersView> { return this.run(providersView(memberId)) }

  // ---------------------------------------------------------------- Plugins and connections (v1.5)

  private pluginsStore: HomePlugins | undefined
  private get pluginsOf(): HomePlugins {
    this.pluginsStore ??= new HomePlugins(this.ctx.storage.sql, makeVault(this.env.DATA_KEY, 'plugins'))
    return this.pluginsStore
  }

  private memberName(id: string): string {
    return this.ctx.storage.sql.exec<{ name: string }>('SELECT name FROM member WHERE id = ?', id).toArray()[0]?.name ?? 'someone'
  }

  private isAdmin(id: string): boolean {
    return this.ctx.storage.sql.exec<{ role: string }>('SELECT role FROM member WHERE id = ?', id).toArray()[0]?.role === 'admin'
  }

  plugins(memberId: string): PluginView[] { return this.pluginsOf.list(this.isAdmin(memberId)) }
  pluginsEnabled(): Record<string, boolean> { return this.pluginsOf.enabled() }
  setPluginEnabled(name: string, enabled: boolean): void { this.pluginsOf.setEnabled(name, enabled) }
  async setPluginConfig(name: string, input: Record<string, unknown>): Promise<PluginView> {
    const view = await this.pluginsOf.setConfig(name, input)
    // The Exa key also lives where the admin view and the catalog look (rb-x8i3).
    if (name === 'exa') {
      const key = (await this.pluginsOf.settings('exa')).secrets['apiKey']
      if (key !== undefined) await this.run(setExaKey(key))
    }
    return view
  }
  /** A plugin's settings with secrets, for the platform only (Google's OAuth client). */
  pluginSettings(name: string): Promise<{ values: Record<string, PlainValue>; secrets: Record<string, string> }> { return this.pluginsOf.settings(name) }

  connectionShared(ownerId: string, connection: OwnConnection, shared: boolean): void { this.pluginsOf.connectionShared(ownerId, connection, shared) }

  /** A Member's own connections and the ones others share with the Home (cn-qs78). */
  async connectionsFor(memberId: string): Promise<ConnectionView[]> {
    const own = (await this.env.MEMBER.getByName(memberId).connections()).map((connection) => connectionView(connection, memberId, this.memberName(memberId), memberId))
    const shared = this.pluginsOf.sharedBy(memberId).map(({ ownerId, connection }) => connectionView(connection, ownerId, this.memberName(ownerId), memberId))
    return [...own, ...shared]
  }

  /** Who owns a connection the Member may use: the Member, or another Member who shared it; null otherwise. */
  private async usableOwner(memberId: string, id: string): Promise<string | null> {
    if ((await this.env.MEMBER.getByName(memberId).connection(id)) !== undefined) return memberId
    return this.pluginsOf.sharedOwner(id)
  }

  /** Secrets and state of a connection for one call by one of the Member's Robots; never cached. */
  async useConnection(memberId: string, id: string): Promise<{ connection: ConnectionView; secrets: Record<string, string>; meta: ConnectionMeta } | null> {
    const owner = await this.usableOwner(memberId, id)
    if (owner === null) return null
    const use = await this.env.MEMBER.getByName(owner).useConnection(id)
    return use === undefined ? null : { ...use, connection: connectionView(use.connection, owner, this.memberName(owner), memberId) }
  }

  /** A connector call found the credentials refused, or refreshed them: the owner's row changes. */
  async updateUsedConnection(memberId: string, id: string, change: ConnectionChange): Promise<void> {
    const owner = await this.usableOwner(memberId, id)
    if (owner !== null) await this.env.MEMBER.getByName(owner).updateConnection(id, change)
  }
}

export function currentMonth(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7)
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local.split(/[._-]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ') || email
}

function memberFromSql(row: MemberSql): MemberView {
  return { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status }
}

function entryFromSql(row: RobotSql): RegistryEntry {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    identity: JSON.parse(row.identity) as Identity,
    sharing: row.sharing,
    status: row.status,
    fleetState: row.fleet_state,
    lastLine: row.last_line,
    lastAt: row.last_at,
  }
}