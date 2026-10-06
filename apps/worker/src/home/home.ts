/**
 * The Home (robot-q7rj): its Members, the registry of every Robot (owner, sharing,
 * last line, state), Home settings, and everything shared with the Home.
 * One per deployment, addressed by HOME_ID.
 */
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
  RobotSummary,
  SettingsCatalog,
  Sharing,
} from '@mr-robot/protocol'
import { TOOL_GROUPS } from '../agent/catalog.ts'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'
import type { Env } from '../env.ts'

export const DEFAULT_MODEL: ModelChoice = { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }
export const CHIEF_COLOR = '#5ec4b6'
const AVATAR_COLORS = ['#f4a03a', '#6c63ff', '#8b5cf6', '#3b82f6', '#f97316', '#ef4444', '#10b981', '#ec4899']

export interface HomeSettings {
  readonly defaultModel: ModelChoice
  readonly robotSpendLimitUsd: number | null
  readonly memberSpendLimitUsd: number | null
}

export interface RegistryEntry {
  readonly id: string
  readonly ownerId: string
  readonly kind: 'chief' | 'robot'
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
  id: string; owner_id: string; kind: 'chief' | 'robot'; identity: string; sharing: Sharing; status: RobotStatus
  fleet_state: FleetState; last_line: string; last_at: number
}

export class Home extends DurableObject<Env> {
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
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql
  }

  // ---------------------------------------------------------------- Members

  /**
   * Sign a verified e-mail in (robot-7v5x). The first person becomes the admin; later
   * people need an invite; a removed Member stays out. A new Member gets Mr. Robot.
   */
  async signIn(email: string): Promise<SignIn> {
    const normalized = email.trim().toLowerCase()
    const existing = this.memberByEmail(normalized)
    if (existing?.status === 'active') return { ok: true, member: existing, created: false }
    if (existing?.status === 'removed') return { ok: false, reason: 'removed' }
    const first = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM member').one().n === 0
    if (existing === undefined && !first) return { ok: false, reason: 'not-invited' }
    const member: MemberView = existing === undefined
      ? { id: `m-${crypto.randomUUID()}`, email: normalized, name: nameFromEmail(normalized), role: 'admin', status: 'active' }
      : { ...existing, status: 'active' }
    this.sql.exec(
      `INSERT INTO member (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status`,
      member.id, member.email, member.name, member.role, member.status, Date.now(),
    )
    await this.env.MEMBER.getByName(member.id).init({ id: member.id, email: member.email, name: member.name })
    await this.bootstrapChief(member)
    return { ok: true, member, created: true }
  }

  member(id: string): MemberView | undefined {
    const row = this.sql.exec<MemberSql>('SELECT * FROM member WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : memberFromSql(row)
  }

  members(): MemberView[] {
    return this.sql.exec<MemberSql>('SELECT * FROM member ORDER BY created_at').toArray().map(memberFromSql)
  }

  /** Admin: invite an e-mail; the Member becomes active on first sign-in (robot-d2uv). */
  invite(email: string, role: MemberRole = 'member'): MemberView {
    const normalized = email.trim().toLowerCase()
    const existing = this.memberByEmail(normalized)
    if (existing !== undefined && existing.status !== 'removed') return existing
    const member: MemberView = existing === undefined
      ? { id: `m-${crypto.randomUUID()}`, email: normalized, name: nameFromEmail(normalized), role, status: 'invited' }
      : { ...existing, role, status: 'invited' }
    this.sql.exec(
      `INSERT INTO member (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, role = excluded.role`,
      member.id, member.email, member.name, member.role, member.status, Date.now(),
    )
    return member
  }

  /** Admin: remove a Member; their access ends and their Robots are paused (robot-d2uv). */
  async remove(memberId: string): Promise<void> {
    this.sql.exec("UPDATE member SET status = 'removed' WHERE id = ?", memberId)
    const owned = this.sql.exec<{ id: string }>('SELECT id FROM robot WHERE owner_id = ?', memberId).toArray()
    await Promise.all(owned.map(({ id }) => this.env.ROBOT.getByName(id).pause()))
  }

  rename(memberId: string, name: string): void {
    this.sql.exec('UPDATE member SET name = ? WHERE id = ?', name, memberId)
  }

  private memberByEmail(email: string): MemberView | undefined {
    const row = this.sql.exec<MemberSql>('SELECT * FROM member WHERE email = ?', email).toArray()[0]
    return row === undefined ? undefined : memberFromSql(row)
  }

  // ---------------------------------------------------------------- settings

  settings(): HomeSettings {
    return {
      defaultModel: this.setting('defaultModel') ?? DEFAULT_MODEL,
      robotSpendLimitUsd: this.setting<number | null>('robotSpendLimitUsd') ?? null,
      memberSpendLimitUsd: this.setting<number | null>('memberSpendLimitUsd') ?? null,
    }
  }

  updateSettings(patch: Partial<HomeSettings>): HomeSettings {
    for (const [key, value] of Object.entries(patch)) {
      this.sql.exec('INSERT INTO setting (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value))
    }
    return this.settings()
  }

  private setting<T>(key: string): T | undefined {
    const row = this.sql.exec<{ v: string }>('SELECT v FROM setting WHERE k = ?', key).toArray()[0]
    return row === undefined ? undefined : (JSON.parse(row.v) as T)
  }

  // ---------------------------------------------------------------- Robot registry

  /** Robots a Member can reach: their own, and everything shared with the Home (robot-hpj1, robot-bld3). */
  reachable(memberId: string): RobotSummary[] {
    const rows = this.sql.exec<RobotSql>(
      "SELECT * FROM robot WHERE status != 'deleted' AND (owner_id = ? OR sharing = 'home') ORDER BY last_at DESC",
      memberId,
    ).toArray()
    return rows.map((row) => this.summary(row))
  }

  /** Every Robot, for the admin fleet view. */
  fleet(): RobotSummary[] {
    return this.sql.exec<RobotSql>("SELECT * FROM robot WHERE status != 'deleted' ORDER BY last_at DESC").toArray().map((row) => this.summary(row))
  }

  entry(robotId: string): RegistryEntry | undefined {
    const row = this.sql.exec<RobotSql>('SELECT * FROM robot WHERE id = ?', robotId).toArray()[0]
    return row === undefined ? undefined : entryFromSql(row)
  }

  /** Whether a Member may use a Robot: 'owner', 'shared', or null. */
  access(memberId: string, robotId: string): 'owner' | 'shared' | null {
    const entry = this.entry(robotId)
    if (entry === undefined || entry.status === 'deleted') return null
    if (entry.ownerId === memberId) return 'owner'
    if (entry.sharing === 'home' && this.member(memberId)?.status === 'active') return 'shared'
    return null
  }

  /**
   * A Robot reports its registry row after anything visible changed. Sharing,
   * creation and deletion change who can reach it, so Mr. Robot's recipients follow (robot-70kf).
   */
  async robotChanged(entry: RegistryEntry): Promise<void> {
    const before = this.entry(entry.id)
    this.sql.exec(
      `INSERT INTO robot (id, owner_id, kind, identity, sharing, status, fleet_state, last_line, last_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET identity = excluded.identity, sharing = excluded.sharing, status = excluded.status,
         fleet_state = excluded.fleet_state, last_line = excluded.last_line, last_at = excluded.last_at`,
      entry.id, entry.ownerId, entry.kind, JSON.stringify(entry.identity), entry.sharing, entry.status,
      entry.fleetState, entry.lastLine, entry.lastAt,
    )
    const reach = (value: RegistryEntry | undefined) => value === undefined ? 'none' : `${value.sharing}:${value.status === 'deleted'}`
    if (entry.kind === 'robot' && reach(before) !== reach(entry)) await this.syncChiefs()
  }

  /**
   * Create a Robot in setup (robot-btct): its Conversation opens with the kickoff Turn in
   * which it interviews its owner. Used by "New robot" and by Mr. Robot (robot-hk2s).
   */
  async createRobot(ownerId: string, brief?: string): Promise<RegistryEntry> {
    const owner = this.member(ownerId)
    if (owner === undefined || owner.status !== 'active') throw new Error('unknown member')
    const id = `r-${crypto.randomUUID()}`
    const profile = await this.env.MEMBER.getByName(ownerId).profile()
    await this.env.ROBOT.getByName(id).create({
      id,
      ownerId,
      ownerName: owner.name,
      kind: 'robot',
      identity: { name: 'New robot', title: '', description: '', avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]! },
      sharing: 'private',
      status: 'setup',
      model: this.settings().defaultModel,
      timeZone: profile.timeZone,
      spendLimitUsd: null,
      ...(brief === undefined || brief.trim() === '' ? {} : { brief }),
    })
    const entry = this.entry(id)
    if (entry === undefined) throw new Error('robot did not register')
    return entry
  }

  /** Recipient Grants of every Mr. Robot: all Robots its Member can reach, except itself. */
  async syncChiefs(): Promise<void> {
    const chiefs = this.sql.exec<RobotSql>("SELECT * FROM robot WHERE kind = 'chief' AND status != 'deleted'").toArray()
    await Promise.all(chiefs.map((chief) => {
      const recipients = this.reachable(chief.owner_id).filter((robot) => robot.kind === 'robot').map((robot) => robot.id)
      return this.env.ROBOT.getByName(chief.id).setRecipients(recipients)
    }))
  }

  private async bootstrapChief(member: MemberView): Promise<void> {
    const id = `chief-${member.id}`
    if (this.entry(id) !== undefined) return
    const robot = this.env.ROBOT.getByName(id)
    await robot.create({
      id,
      ownerId: member.id,
      ownerName: member.name,
      kind: 'chief',
      identity: { name: 'Mr. Robot', title: 'Chief', description: `${member.name}'s chief Robot: creates and coordinates the others.`, avatarColor: CHIEF_COLOR },
      sharing: 'private',
      status: 'active',
      model: this.settings().defaultModel,
      timeZone: 'Europe/Warsaw',
      spendLimitUsd: null,
    })
    await this.syncChiefs()
  }

  private summary(row: RobotSql): RobotSummary {
    const entry = entryFromSql(row)
    return { ...entry, ownerName: this.member(entry.ownerId)?.name ?? '', unread: false }
  }

  // ---------------------------------------------------------------- settings catalog (robot-vqtw)

  /** What a Member can grant a Robot and which models it can run on. */
  async catalog(memberId: string, robotId: string): Promise<SettingsCatalog> {
    return {
      toolGroups: Object.entries(TOOL_GROUPS).filter(([name]) => name !== 'robots').map(([name, description]) => ({ name, description })),
      skills: await this.grantableSkills(memberId),
      robots: this.reachable(memberId).filter((robot) => robot.id !== robotId && robot.kind === 'robot').map((robot) => ({ id: robot.id, name: robot.identity.name })),
      secrets: await this.grantableSecrets(memberId),
      models: await this.models(memberId),
    }
  }

  /** Filled by the skill library (16), secrets (12) and providers (13) tickets. */
  protected async grantableSkills(_memberId: string): Promise<SettingsCatalog['skills']> {
    return []
  }

  protected async grantableSecrets(_memberId: string): Promise<SettingsCatalog['secrets']> {
    return []
  }

  async models(_memberId: string): Promise<ModelOption[]> {
    return [
      { provider: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek Flash', contextWindow: 1_000_000 },
      { provider: 'deepseek', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextWindow: 1_000_000 },
    ]
  }

  // ---------------------------------------------------------------- Providers

  async providerCredential(_memberId: string, _provider: ProviderId): Promise<ProviderCredential | null> {
    return null
  }
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