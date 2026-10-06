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
  AdminView,
  ProvidersView,
  ProviderView,
  RobotSummary,
  SettingsCatalog,
  Sharing,
  SkillView,
} from '@mr-robot/protocol'
import * as Effect from 'effect/Effect'
import { TOOL_GROUPS } from '../agent/catalog.ts'
import { liveModels, type ListingAccess } from '../providers/live-catalog.ts'
import { fetchMetadata, type MetadataIndex } from '../providers/model-metadata.ts'
import { PROVIDER_IDS } from '../agent/providers.ts'
import { makeVault } from '../platform/vault.ts'
import { fetchRepository, skillsInTree, type SkillRepository } from '../skills/library.ts'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'
import type { Env } from '../env.ts'

export const DEFAULT_MODEL: ModelChoice = { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }
export const MR_ROBOT_COLOR = '#5ec4b6'

/** The Home's model list until the admin edits it (robot-82r5); contextWindow caps each Robot's budget. */
/** Prices are the admin's to correct in the admin view; subscriptions are flat and count as 0. */
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000
const AVATAR_COLORS = ['#f4a03a', '#6c63ff', '#8b5cf6', '#3b82f6', '#f97316', '#ef4444', '#10b981', '#ec4899']

export interface HomeSettings {
  readonly defaultModel: ModelChoice
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
    sql.exec(`CREATE TABLE IF NOT EXISTS skill (
      name TEXT PRIMARY KEY, description TEXT NOT NULL, source TEXT NOT NULL, visibility TEXT NOT NULL,
      owner_id TEXT, updated_at INTEGER NOT NULL
    )`)
    sql.exec('CREATE TABLE IF NOT EXISTS model_catalog (provider TEXT PRIMARY KEY, models TEXT, fetched_at INTEGER, error TEXT)')
    sql.exec('CREATE TABLE IF NOT EXISTS shared_secret (name TEXT PRIMARY KEY, owner_id TEXT NOT NULL, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS shared_credential (provider TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY (provider, member_id)) WITHOUT ROWID')
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
    await this.bootstrapMrRobot(member)
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
    const viewed = this.sql.exec<{ id: string }>("SELECT id FROM robot WHERE status != 'deleted' AND (owner_id = ? OR sharing = 'home')", memberId).toArray()
    await Promise.all(viewed.map(({ id }) => this.env.ROBOT.getByName(id).disconnectMember(memberId)))
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

  /** Admin settings; a raised spend limit unblocks Robots stopped by the old one (robot-8gag). */
  async updateSettings(patch: Partial<HomeSettings> & { models?: readonly ModelOption[] }): Promise<HomeSettings> {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      this.sql.exec('INSERT INTO setting (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value))
    }
    if (patch.robotSpendLimitUsd !== undefined || patch.memberSpendLimitUsd !== undefined) {
      const blocked = this.sql.exec<{ id: string }>("SELECT id FROM robot WHERE status = 'blocked'").toArray()
      await Promise.all(blocked.map(({ id }) => this.env.ROBOT.getByName(id).recheckLimits()))
    }
    return this.settings()
  }

  /** Spend limits a Robot's Turns are held to. */
  async limitsFor(memberId: string): Promise<{ robotDefaultUsd: number | null; memberUsd: number | null; memberSpentUsd: number }> {
    const settings = this.settings()
    const usage = await this.env.MEMBER.getByName(memberId).usage(currentMonth())
    return { robotDefaultUsd: settings.robotSpendLimitUsd, memberUsd: settings.memberSpendLimitUsd, memberSpentUsd: usage.costUsd }
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
    if (entry.kind === 'robot' && reach(before) !== reach(entry)) await this.syncMrRobots()
  }

  /**
   * Create a Robot in setup (robot-btct): its Conversation opens with the kickoff Turn in
   * which it interviews its owner. Used by "New robot" and by Mr. Robot (robot-hk2s).
   */
  /** The model a new Robot of this Member starts on: the Home default if they can use it, else one they can. */
  async startingModel(memberId: string, wanted?: ModelChoice): Promise<ModelChoice> {
    const usable = await this.models(memberId)
    const pick = wanted ?? this.settings().defaultModel
    // Only a known Provider can be missing a connection; anything else (an admin's own entry) is kept.
    if (!(PROVIDER_IDS as readonly string[]).includes(pick.provider) || usable.some((option) => option.provider === pick.provider && option.model === pick.model)) return pick
    const fallback = usable.find((option) => option.provider === 'workers-ai') ?? usable[0]
    if (fallback === undefined) throw new Error('Connect a Provider first: open your name → Providers and add a key or a subscription.')
    return { provider: fallback.provider, model: fallback.model, effort: 'off' }
  }

  async createRobot(ownerId: string, brief?: string, model?: ModelChoice): Promise<RegistryEntry> {
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
      model: await this.startingModel(ownerId, model),
      timeZone: profile.timeZone,
      spendLimitUsd: null,
      ...(brief === undefined || brief.trim() === '' ? {} : { brief }),
    })
    const entry = this.entry(id)
    if (entry === undefined) throw new Error('robot did not register')
    return entry
  }

  /** Recipient Grants of every Mr. Robot: all Robots its Member can reach, except itself. */
  async syncMrRobots(): Promise<void> {
    const mrRobots = this.sql.exec<RobotSql>("SELECT * FROM robot WHERE kind = 'mr-robot' AND status != 'deleted'").toArray()
    await Promise.all(mrRobots.map((mrRobot) => {
      const recipients = this.reachable(mrRobot.owner_id).filter((robot) => robot.kind === 'robot').map((robot) => robot.id)
      return this.env.ROBOT.getByName(mrRobot.id).setRecipients(recipients)
    }))
  }

  private async bootstrapMrRobot(member: MemberView): Promise<void> {
    const id = `mr-robot-${member.id}`
    if (this.entry(id) !== undefined) return
    const robot = this.env.ROBOT.getByName(id)
    await robot.create({
      id,
      ownerId: member.id,
      ownerName: member.name,
      kind: 'mr-robot',
      identity: { name: 'Mr. Robot', title: '', description: `${member.name}'s personal Robot: creates and coordinates the others.`, avatarColor: MR_ROBOT_COLOR },
      sharing: 'private',
      status: 'active',
      // Mr. Robot exists from the first sign-in; with nothing connected his first Turn points to Providers.
      model: await this.startingModel(member.id).catch(() => this.settings().defaultModel),
      timeZone: 'Europe/Warsaw',
      spendLimitUsd: null,
    })
    await this.syncMrRobots()
  }

  private summary(row: RobotSql): RobotSummary {
    const entry = entryFromSql(row)
    return { ...entry, ownerName: this.member(entry.ownerId)?.name ?? '', unread: false }
  }

  // ---------------------------------------------------------------- admin view (robot-x26m, robot-1rap, robot-bvme)

  async adminView(adminId: string): Promise<AdminView> {
    const month = currentMonth()
    const fleet = await Promise.all(this.fleet().map(async (summary) => {
      const row = await this.env.ROBOT.getByName(summary.id).adminRow()
      return row === null ? null : { summary, row }
    }))
    const live = fleet.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    const members = await Promise.all(this.members().map(async (member) => {
      const usage = member.status === 'invited' ? { inputTokens: 0, outputTokens: 0, costUsd: 0 } : await this.env.MEMBER.getByName(member.id).usage(month)
      return { ...member, usage: { month, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd, limitUsd: this.settings().memberSpendLimitUsd } }
    }))
    const providers = (await Promise.all(this.members().filter((member) => member.status === 'active').map(async (member) =>
      (await this.env.MEMBER.getByName(member.id).providers()).map((view) => ({ provider: view.provider, ownerName: member.name, shared: view.shared }))))).flat()
    return {
      fleet: live.map(({ summary, row }) => ({ ...summary, fleetState: row.fleetState, status: row.status, grants: row.grants, model: row.model, usage: row.usage })),
      routines: live.flatMap(({ summary, row }) => row.routines.map((routine) => ({ ...routine, robotName: summary.identity.name, ownerName: summary.ownerName })))
        .sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity)),
      members,
      skills: this.sql.exec<{ name: string; description: string; source: 'git' | 'robot'; visibility: 'home' | 'private'; owner_id: string | null; updated_at: number }>('SELECT * FROM skill ORDER BY name').toArray()
        .map((row) => ({ name: row.name, description: row.description, source: row.source, visibility: row.visibility, ownerId: row.owner_id, updatedAt: row.updated_at })),
      skillRepository: await this.skillRepository(),
      providers,
      modelLists: this.catalogStatus(),
      settings: { ...this.settings(), models: await this.models(adminId) },
    }
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
      unavailableModels: await this.unavailableModels(memberId),
    }
  }

  protected async grantableSkills(memberId: string): Promise<SettingsCatalog['skills']> {
    return this.skills(memberId).map(({ name, description }) => ({ name, description }))
  }

  // ---------------------------------------------------------------- the skill library (robot-7qpi, robot-qjvu, robot-lszy, robot-jqfw)

  /** Skills a Member can see: every Home skill, and private skills of their own Robots. */
  skills(memberId: string): SkillView[] {
    return this.sql.exec<{ name: string; description: string; source: 'git' | 'robot'; visibility: 'home' | 'private'; owner_id: string | null; updated_at: number }>(
      "SELECT * FROM skill WHERE visibility = 'home' OR owner_id = ? ORDER BY name", memberId,
    ).toArray().map((row) => ({ name: row.name, description: row.description, source: row.source, visibility: row.visibility, ownerId: row.owner_id, updatedAt: row.updated_at }))
  }

  /** Which of these names a Robot of this owner may load. */
  loadableSkills(memberId: string, names: readonly string[]): SkillView[] {
    return this.skills(memberId).filter((skill) => names.includes(skill.name))
  }

  async skillRepository(): Promise<SkillRepository | null> {
    return this.setting<SkillRepository>('skillRepository') ?? null
  }

  async setSkillRepository(repository: SkillRepository, token: string | undefined): Promise<void> {
    this.sql.exec("INSERT INTO setting (k, v) VALUES ('skillRepository', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(repository))
    if (token !== undefined) {
      const sealed = await Effect.runPromise(this.secretVault().seal(token))
      this.sql.exec("INSERT INTO setting (k, v) VALUES ('skillRepositoryToken', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(sealed))
    }
  }

  /** Pull the configured repository; its skills replace the previous Git skills (robot-qjvu). */
  async syncSkills(): Promise<{ synced: string[] }> {
    const repository = await this.skillRepository()
    if (repository === null) throw new Error('set the skills repository first')
    const sealed = this.setting<string>('skillRepositoryToken')
    const token = sealed === undefined ? null : await Effect.runPromise(this.secretVault().open(sealed))
    const files = await Effect.runPromise(fetchRepository(repository, token))
    const skills = skillsInTree(files, repository.path)
    const previous = this.sql.exec<{ name: string }>("SELECT name FROM skill WHERE source = 'git'").toArray().map((row) => row.name)
    for (const skill of skills) {
      await this.storeSkillFiles(skill.name, skill.files)
      this.upsertSkill(skill.name, skill.description, 'git', 'home', null)
    }
    for (const gone of previous.filter((name) => !skills.some((skill) => skill.name === name))) {
      this.sql.exec("DELETE FROM skill WHERE name = ? AND source = 'git'", gone)
    }
    return { synced: skills.map((skill) => skill.name) }
  }

  /** An approved Robot proposal enters the library (robot-jqfw). */
  async publishSkill(ownerId: string, name: string, description: string, content: string, visibility: 'home' | 'private'): Promise<void> {
    const existing = this.sql.exec<{ source: string; owner_id: string | null }>('SELECT source, owner_id FROM skill WHERE name = ?', name).toArray()[0]
    if (existing !== undefined && (existing.source === 'git' || existing.owner_id !== ownerId)) throw new Error(`a skill named "${name}" already exists`)
    await this.storeSkillFiles(name, [{ path: 'SKILL.md', body: new TextEncoder().encode(content) }])
    this.upsertSkill(name, description, 'robot', visibility, ownerId)
  }

  async skillContent(memberId: string, name: string, path = 'SKILL.md'): Promise<string | null> {
    if (!this.skills(memberId).some((skill) => skill.name === name)) return null
    const object = await this.env.FILES.get(`skills/${name}/${path.replace(/\.\.\//g, '')}`)
    return object === null ? null : object.text()
  }

  private async storeSkillFiles(name: string, files: ReadonlyArray<{ path: string; body: Uint8Array }>): Promise<void> {
    const existing = await this.env.FILES.list({ prefix: `skills/${name}/` })
    if (existing.objects.length > 0) await this.env.FILES.delete(existing.objects.map((object) => object.key))
    await Promise.all(files.map((file) => this.env.FILES.put(`skills/${name}/${file.path}`, file.body)))
  }

  private upsertSkill(name: string, description: string, source: 'git' | 'robot', visibility: 'home' | 'private', ownerId: string | null): void {
    this.sql.exec(
      `INSERT INTO skill (name, description, source, visibility, owner_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET description = excluded.description, source = excluded.source,
         visibility = excluded.visibility, owner_id = excluded.owner_id, updated_at = excluded.updated_at`,
      name, description, source, visibility, ownerId, Date.now(),
    )
  }

  protected async grantableSecrets(memberId: string): Promise<SettingsCatalog['secrets']> {
    const own = (await this.env.MEMBER.getByName(memberId).secretNames()).map(({ name }) => ({ name, scope: 'member' as const }))
    const shared = this.sharedSecrets().filter(({ name }) => !own.some((secret) => secret.name === name)).map(({ name }) => ({ name, scope: 'home' as const }))
    return [...own, ...shared]
  }

  // ---------------------------------------------------------------- secrets (robot-vplt, robot-0bde)

  private secretVault() {
    return makeVault(this.env.DATA_KEY, 'secrets')
  }

  sharedSecrets(): Array<{ name: string; ownerId: string; updatedAt: number }> {
    return this.sql.exec<{ name: string; owner_id: string; updated_at: number }>('SELECT name, owner_id, updated_at FROM shared_secret ORDER BY name').toArray()
      .map((row) => ({ name: row.name, ownerId: row.owner_id, updatedAt: row.updated_at }))
  }

  /**
   * Store a secret: private ones stay in the Member DO, Home-shared ones live here. Changing
   * the scope moves the value; a shared secret is changed only by the Member who shared it.
   */
  async putSecret(memberId: string, name: string, value: string | undefined, shared: boolean): Promise<void> {
    const existing = this.sql.exec<{ owner_id: string }>('SELECT owner_id FROM shared_secret WHERE name = ?', name).toArray()[0]
    if (existing !== undefined && existing.owner_id !== memberId) throw new Error(`"${name}" is shared by another Member`)
    const member = this.env.MEMBER.getByName(memberId)
    if (shared) {
      const plaintext = value ?? (await member.takeSecret(name)) ?? (existing === undefined ? null : await this.sharedSecret(name))
      if (plaintext === null) throw new Error(`no secret "${name}"`)
      await member.takeSecret(name)
      const sealed = await Effect.runPromise(this.secretVault().seal(plaintext))
      this.sql.exec(
        'INSERT INTO shared_secret (name, owner_id, sealed, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at',
        name, memberId, sealed, Date.now(),
      )
      return
    }
    const plaintext = value ?? (existing === undefined ? await member.secret(name) : await this.sharedSecret(name))
    if (plaintext === null) throw new Error(`no secret "${name}"`)
    await member.setSecret(name, plaintext)
    if (existing !== undefined) this.sql.exec('DELETE FROM shared_secret WHERE name = ?', name)
  }

  async deleteSecret(memberId: string, name: string): Promise<void> {
    this.sql.exec('DELETE FROM shared_secret WHERE name = ? AND owner_id = ?', name, memberId)
    await this.env.MEMBER.getByName(memberId).takeSecret(name)
  }

  private async sharedSecret(name: string): Promise<string | null> {
    const row = this.sql.exec<{ sealed: string }>('SELECT sealed FROM shared_secret WHERE name = ?', name).toArray()[0]
    return row === undefined ? null : Effect.runPromise(this.secretVault().open(row.sealed))
  }

  /** The value a Robot's secret_get receives: its owner's private secret, else the Home's. */
  async resolveSecret(memberId: string, name: string): Promise<string | null> {
    return (await this.env.MEMBER.getByName(memberId).secret(name)) ?? this.sharedSecret(name)
  }

  async secretsView(memberId: string): Promise<Array<{ name: string; scope: 'member' | 'home'; mine: boolean; updatedAt: number }>> {
    const own = (await this.env.MEMBER.getByName(memberId).secretNames()).map((secret) => ({ ...secret, scope: 'member' as const, mine: true }))
    const shared = this.sharedSecrets().map((secret) => ({ name: secret.name, updatedAt: secret.updatedAt, scope: 'home' as const, mine: secret.ownerId === memberId }))
    return [...own, ...shared]
  }

  /** Models a Member's Robots can run on: the Home's model list, for Providers they can use. */
  /** Providers this Member's Robots can run on: Workers AI, their own credentials, Home-shared ones. */
  async usableProviders(memberId: string): Promise<Set<string>> {
    const usable = new Set<string>(['workers-ai'])
    for (const provider of (await this.env.MEMBER.getByName(memberId).providers()).map((view) => view.provider)) usable.add(provider)
    for (const row of this.sql.exec<{ provider: string }>('SELECT DISTINCT provider FROM shared_credential').toArray()) usable.add(row.provider)
    return usable
  }

  /** The models a Member can choose: the live lists of the Providers they can use (refreshed daily). */
  async models(memberId: string): Promise<ModelOption[]> {
    const usable = await this.usableProviders(memberId)
    await Promise.all([...usable].filter((provider) => (PROVIDER_IDS as readonly string[]).includes(provider)).map((provider) => this.ensureCatalog(provider, memberId)))
    return this.modelList().filter((option) => usable.has(option.provider))
  }

  // ---------------------------------------------------------------- live model lists (robot-82r5)

  /** When each Provider's list was last tried, so a failing Provider is not asked on every request. */
  private readonly catalogTries = new Map<string, number>()

  private catalogRow(provider: string): { models: ModelOption[] | null; fetchedAt: number | null; error: string | null } | undefined {
    const row = this.sql.exec<{ models: string | null; fetched_at: number | null; error: string | null }>('SELECT models, fetched_at, error FROM model_catalog WHERE provider = ?', provider).toArray()[0]
    return row === undefined ? undefined : { models: row.models === null ? null : JSON.parse(row.models) as ModelOption[], fetchedAt: row.fetched_at, error: row.error }
  }

  private async ensureCatalog(provider: string, memberId: string): Promise<void> {
    const row = this.catalogRow(provider)
    if (row?.models != null && row.fetchedAt !== null && Date.now() - row.fetchedAt < CATALOG_TTL_MS) return
    if (row?.error != null && Date.now() - (this.catalogTries.get(provider) ?? 0) < 60_000) return
    await this.refreshCatalog(provider, memberId)
  }

  /** Fetch one Provider's live list with a credential this Member can use; a failure keeps the last list. */
  async refreshCatalog(provider: string, memberId: string): Promise<{ provider: string; count: number; error: string | null }> {
    this.catalogTries.set(provider, Date.now())
    try {
      const access = await this.listingAccess(provider, memberId)
      const models = await liveModels(provider, access, () => this.metadata())
      this.sql.exec(
        'INSERT INTO model_catalog (provider, models, fetched_at, error) VALUES (?, ?, ?, NULL) ON CONFLICT (provider) DO UPDATE SET models = excluded.models, fetched_at = excluded.fetched_at, error = NULL',
        provider, JSON.stringify(models), Date.now(),
      )
      return { provider, count: models.length, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.sql.exec('INSERT INTO model_catalog (provider, error) VALUES (?, ?) ON CONFLICT (provider) DO UPDATE SET error = excluded.error', provider, message)
      return { provider, count: this.catalogRow(provider)?.models?.length ?? 0, error: message }
    }
  }

  private async listingAccess(provider: string, memberId: string): Promise<ListingAccess> {
    if (provider === 'workers-ai') return this.env.AI === undefined ? {} : { ai: this.env.AI }
    if (provider === 'openrouter') return {}
    if (provider === 'opencode-go') {
      const owner = await this.opencodePoolOwner(memberId)
      if (owner === null) throw new Error('no OpenCode Go key')
      const pool = await this.env.MEMBER.getByName(owner.ownerId).opencodeCandidates(null, owner.forHome)
      const key = pool.keys[0]?.key
      if (key === undefined) throw new Error('no OpenCode Go key')
      return { key }
    }
    const credential = await this.providerCredential(memberId, provider as ProviderId)
    if (credential === null) throw new Error(`no ${provider} credential`)
    return credential.kind === 'api-key' ? { key: credential.key } : { oauth: { access: credential.access, ...(credential.accountId === undefined ? {} : { accountId: credential.accountId }) } }
  }

  /** models.dev metadata, refreshed daily; a failed refresh keeps the last copy (or none). */
  private async metadata(): Promise<MetadataIndex> {
    const stored = this.setting<{ data: MetadataIndex; fetchedAt: number }>('model-metadata')
    if (stored !== undefined && Date.now() - stored.fetchedAt < CATALOG_TTL_MS) return stored.data
    try {
      const data = await fetchMetadata()
      this.sql.exec("INSERT INTO setting (k, v) VALUES ('model-metadata', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify({ data, fetchedAt: Date.now() }))
      return data
    } catch (error) {
      console.warn('models.dev metadata unavailable', error)
      return stored?.data ?? {}
    }
  }

  /** Each Provider's list status, for the admin view. */
  catalogStatus(): Array<{ provider: string; count: number; fetchedAt: number | null; error: string | null }> {
    return this.sql.exec<{ provider: string; models: string | null; fetched_at: number | null; error: string | null }>('SELECT * FROM model_catalog ORDER BY provider').toArray()
      .map((row) => ({ provider: row.provider, count: row.models === null ? 0 : (JSON.parse(row.models) as unknown[]).length, fetchedAt: row.fetched_at, error: row.error }))
  }

  /** Refresh every Provider this Member can use (the admin's "Refresh models"). */
  async refreshCatalogs(memberId: string): Promise<Array<{ provider: string; count: number; error: string | null }>> {
    const usable = [...(await this.usableProviders(memberId))].filter((provider) => (PROVIDER_IDS as readonly string[]).includes(provider))
    return Promise.all(usable.map((provider) => this.refreshCatalog(provider, memberId)))
  }

  async unavailableModels(memberId: string): Promise<ModelOption[]> {
    const usable = await this.models(memberId)
    return this.modelList().filter((option) => !usable.some((entry) => entry.provider === option.provider && entry.model === option.model))
  }

  /**
   * Every known model: each Provider's last live list (nothing for a Provider never listed
   * successfully), with the admin's entries on top: an entry for a listed model overrides
   * its label and price, any other entry adds a model.
   */
  modelList(): ModelOption[] {
    const stored = this.setting<ModelOption[]>('models') ?? []
    const same = (a: ModelOption, b: ModelOption) => a.provider === b.provider && a.model === b.model
    const live = PROVIDER_IDS.flatMap((provider) => this.catalogRow(provider)?.models ?? [])
    return [
      ...live.map((model) => stored.find((entry) => same(entry, model)) ?? model),
      ...stored.filter((entry) => !live.some((model) => same(entry, model))),
    ]
  }

  // ---------------------------------------------------------------- Providers (robot-dic7)

  credentialShared(memberId: string, provider: ProviderId, shared: boolean): void {
    if (shared) this.sql.exec('INSERT INTO shared_credential (provider, member_id) VALUES (?, ?) ON CONFLICT DO NOTHING', provider, memberId)
    else this.sql.exec('DELETE FROM shared_credential WHERE provider = ? AND member_id = ?', provider, memberId)
  }

  /** The credential a Member's Robot uses: the Member's own, else one shared with the Home. */
  async providerCredential(memberId: string, provider: ProviderId): Promise<ProviderCredential | null> {
    const own = await this.env.MEMBER.getByName(memberId).credential(provider, false)
    if (own !== null) return own
    const sharers = this.sql.exec<{ member_id: string }>('SELECT member_id FROM shared_credential WHERE provider = ? AND member_id != ?', provider, memberId).toArray()
    for (const { member_id } of sharers) {
      if (this.member(member_id)?.status !== 'active') continue
      const shared = await this.env.MEMBER.getByName(member_id).credential(provider, true)
      if (shared !== null) return shared
    }
    return null
  }

  /** Whose OpenCode Go pool a Member's Robots use: their own, else the first one shared with the Home. */
  async opencodePoolOwner(memberId: string): Promise<{ ownerId: string; forHome: boolean } | null> {
    const own = await this.env.MEMBER.getByName(memberId).opencodeKeys()
    if (own.keys.length > 0) return { ownerId: memberId, forHome: false }
    const sharer = this.sql.exec<{ member_id: string }>("SELECT member_id FROM shared_credential WHERE provider = 'opencode-go' AND member_id != ?", memberId).toArray()
      .find(({ member_id }) => this.member(member_id)?.status === 'active')
    return sharer === undefined ? null : { ownerId: sharer.member_id, forHome: true }
  }

  async providersView(memberId: string): Promise<ProvidersView> {
    const mine = await this.env.MEMBER.getByName(memberId).providers()
    const others = this.sql.exec<{ provider: ProviderId; member_id: string }>('SELECT provider, member_id FROM shared_credential WHERE member_id != ?', memberId).toArray()
    const shared: ProviderView[] = others.flatMap(({ provider, member_id }) => {
      const member = this.member(member_id)
      return member === undefined || member.status !== 'active' ? [] : [{ provider, kind: provider === 'openai' || provider === 'anthropic' ? 'oauth' as const : 'api-key' as const, shared: true, connectedAt: 0, ownerId: member.id, ownerName: member.name }]
    })
    return { mine, shared, models: await this.models(memberId), defaultModel: this.settings().defaultModel }
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