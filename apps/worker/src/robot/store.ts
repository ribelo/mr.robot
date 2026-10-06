/**
 * The Robot DO's own tables. SQLite in a Durable Object is synchronous and
 * single-writer, so the store is a plain object with synchronous methods; the
 * session log lives beside it (agent/session-log.ts).
 */
import { SESSION_LOG_SCHEMA } from '../agent/session-log.ts'
import type {
  GrantKind,
  GrantSet,
  Identity,
  ModelChoice,
  NotificationSettings,
  ProposalKind,
  ProposalView,
  RewindView,
  RobotStatus,
  RoutineSchedule,
  Sender,
  Sharing,
} from '@mr-robot/protocol'

export interface RobotConfig {
  readonly id: string
  readonly ownerId: string
  readonly kind: 'mr-robot' | 'robot'
  readonly identity: Identity
  readonly sharing: Sharing
  readonly status: RobotStatus
  readonly blockedReason: string | null
  readonly model: ModelChoice
  readonly contextBudget: number
  readonly codeMode: boolean
  readonly compactionInstruction: string
  readonly notifications: NotificationSettings
  readonly spendLimitUsd: number | null
  readonly timeZone: string
  readonly liveSessionId: string
  /** Bumped on every settings or grant change; the agent composition is rebuilt when it moves. */
  readonly revision: number
  readonly createdAt: number
}

export type WakeupKind = 'member' | 'routine' | 'robot' | 'channel' | 'takeover' | 'platform'

export interface Wakeup {
  readonly id: number
  readonly kind: WakeupKind
  readonly sender: Sender
  readonly text: string
  /** Extra structured data the turn needs (attachments, robot request ids, channel reply route). */
  readonly payload: Record<string, unknown>
  readonly createdAt: number
}

export interface RoutineRow {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly schedule: RoutineSchedule
  readonly timeZone: string
  readonly nextRun: number | null
  readonly lastRun: number | null
  readonly createdAt: number
  readonly paused: boolean
}

export interface ProposalRow extends ProposalView {
  readonly createdAt: number
  readonly answeredAt: number | null
  /** Exact stored payload; the approved payload is applied, never prose. */
  readonly payload: Record<string, unknown>
}

export interface NoticeRow {
  readonly id: string
  readonly afterSeq: number
  readonly at: number
  readonly text: string
  readonly sessionId: string
}

const SCHEMA_VERSION = 2

const MIGRATIONS: Record<number, readonly string[]> = {
  2: [
    'ALTER TABLE routine ADD COLUMN paused INTEGER NOT NULL DEFAULT 0',
    'CREATE TABLE routine_run (wakeup_id INTEGER PRIMARY KEY, routine_id TEXT NOT NULL, at INTEGER NOT NULL, outcome TEXT NOT NULL, summary TEXT NOT NULL)',
  ],
  1: [
    `CREATE TABLE robot (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
    `CREATE TABLE grant_item (kind TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (kind, name)) WITHOUT ROWID`,
    `CREATE TABLE proposal (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL,
      purpose TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, answered_at INTEGER
    )`,
    `CREATE TABLE routine (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, schedule TEXT NOT NULL,
      time_zone TEXT NOT NULL, next_run INTEGER, last_run INTEGER, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE wakeup (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL,
      payload TEXT NOT NULL, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE turn (k TEXT PRIMARY KEY, wakeup_id INTEGER NOT NULL, started_at INTEGER NOT NULL, session_id TEXT NOT NULL, start_seq INTEGER NOT NULL)`,
    `CREATE TABLE notice (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, after_seq INTEGER NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL)`,
    `CREATE TABLE usage (month TEXT PRIMARY KEY, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL)`,
    `CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
    `CREATE TABLE rewind (
      id TEXT PRIMARY KEY, at_seq INTEGER NOT NULL, archived_session_id TEXT NOT NULL,
      live_session_id TEXT NOT NULL, created_at INTEGER NOT NULL, undone_at INTEGER
    )`,
    `CREATE TABLE outbox (
      id TEXT PRIMARY KEY, recipient TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
      attempts INTEGER NOT NULL, next_attempt INTEGER NOT NULL, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE intake (key TEXT PRIMARY KEY, sender TEXT NOT NULL, received_at INTEGER NOT NULL)`,
    `CREATE TABLE reply_handle (id TEXT PRIMARY KEY, sender_robot TEXT NOT NULL, request_id TEXT NOT NULL, chain INTEGER NOT NULL, used_at INTEGER)`,
  ],
}

export class RobotStore {
  constructor(private readonly storage: DurableObjectStorage) {
    this.migrate()
    for (const statement of SESSION_LOG_SCHEMA) this.sql.exec(statement)
  }

  get sql(): SqlStorage {
    return this.storage.sql
  }

  transaction<T>(body: () => T): T {
    return this.storage.transactionSync(body)
  }

  private migrate(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    const current = this.sql.exec<{ version: number }>('SELECT version FROM schema_version').toArray()[0]?.version ?? 0
    if (current >= SCHEMA_VERSION) return
    this.transaction(() => {
      for (let version = current + 1; version <= SCHEMA_VERSION; version += 1) {
        for (const statement of MIGRATIONS[version] ?? []) this.sql.exec(statement)
      }
      this.sql.exec('DELETE FROM schema_version')
      this.sql.exec('INSERT INTO schema_version (version) VALUES (?)', SCHEMA_VERSION)
    })
  }

  // ------------------------------------------------------------ config

  config(): RobotConfig | undefined {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM robot WHERE k = 'config'").toArray()[0]
    return row === undefined ? undefined : (JSON.parse(row.v) as RobotConfig)
  }

  requireConfig(): RobotConfig {
    const config = this.config()
    if (config === undefined) throw new RobotNotFound()
    return config
  }

  saveConfig(config: RobotConfig): void {
    this.sql.exec("INSERT INTO robot (k, v) VALUES ('config', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(config))
  }

  updateConfig(change: (config: RobotConfig) => Partial<RobotConfig>, bump = true): RobotConfig {
    const config = this.requireConfig()
    const next = { ...config, ...change(config), revision: bump ? config.revision + 1 : config.revision }
    this.saveConfig(next)
    return next
  }

  // ------------------------------------------------------------ grants

  grants(): GrantSet {
    const rows = this.sql.exec<{ kind: GrantKind; name: string }>('SELECT kind, name FROM grant_item ORDER BY kind, name').toArray()
    const pick = (kind: GrantKind) => rows.filter((row) => row.kind === kind).map((row) => row.name)
    return { tools: pick('tool'), skills: pick('skill'), recipients: pick('recipient'), secrets: pick('secret') }
  }

  /** Replace the whole grant set exactly. */
  setGrants(grants: GrantSet): void {
    this.transaction(() => {
      this.sql.exec('DELETE FROM grant_item')
      const insert = (kind: GrantKind, names: readonly string[]) => {
        for (const name of new Set(names)) this.sql.exec('INSERT INTO grant_item (kind, name) VALUES (?, ?)', kind, name)
      }
      insert('tool', grants.tools)
      insert('skill', grants.skills)
      insert('recipient', grants.recipients)
      insert('secret', grants.secrets)
    })
  }

  hasGrant(kind: GrantKind, name: string): boolean {
    return this.sql.exec('SELECT 1 FROM grant_item WHERE kind = ? AND name = ?', kind, name).toArray().length > 0
  }

  // ------------------------------------------------------------ proposals

  proposals(status?: ProposalRow['status']): ProposalRow[] {
    const rows = status === undefined
      ? this.sql.exec<ProposalSql>('SELECT * FROM proposal ORDER BY created_at').toArray()
      : this.sql.exec<ProposalSql>('SELECT * FROM proposal WHERE status = ? ORDER BY created_at', status).toArray()
    return rows.map(proposalFromSql)
  }

  proposal(id: string): ProposalRow | undefined {
    const row = this.sql.exec<ProposalSql>('SELECT * FROM proposal WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : proposalFromSql(row)
  }

  /**
   * Store a proposal. An open proposal of the same kind (and, for files, the same file)
   * is superseded: its revision is carried forward so a stale answer fails the compare-and-swap.
   */
  propose(kind: ProposalKind, purpose: string, payload: Record<string, unknown>, now: number, sameAs?: (row: ProposalRow) => boolean): ProposalRow {
    return this.transaction(() => {
      const open = this.proposals('open').filter((row) => row.kind === kind && (sameAs?.(row) ?? true))
      const revision = Math.max(0, ...open.map((row) => row.revision)) + 1
      for (const row of open) this.sql.exec("UPDATE proposal SET status = 'superseded', answered_at = ? WHERE id = ?", now, row.id)
      const id = `p-${crypto.randomUUID()}`
      this.sql.exec(
        "INSERT INTO proposal (id, kind, revision, status, purpose, payload, created_at) VALUES (?, ?, ?, 'open', ?, ?, ?)",
        id, kind, revision, purpose, JSON.stringify(payload), now,
      )
      const stored = this.proposal(id)
      if (stored === undefined) throw new Error('proposal vanished after insert')
      return stored
    })
  }

  /**
   * Compare-and-swap answer: succeeds only for an open proposal at exactly this revision.
   * @returns the answered proposal, or undefined when the revision is stale or it is closed.
   */
  answerProposal(id: string, revision: number, approve: boolean, now: number): ProposalRow | undefined {
    const status = approve ? 'approved' : 'rejected'
    const cursor = this.sql.exec(
      "UPDATE proposal SET status = ?, answered_at = ? WHERE id = ? AND revision = ? AND status = 'open'",
      status, now, id, revision,
    )
    return cursor.rowsWritten === 1 ? this.proposal(id) : undefined
  }

  closeProposal(id: string, now: number): void {
    this.sql.exec("UPDATE proposal SET status = 'done', answered_at = ? WHERE id = ? AND status = 'open'", now, id)
  }

  // ------------------------------------------------------------ routines

  routines(): RoutineRow[] {
    return this.sql.exec<RoutineSql>('SELECT * FROM routine ORDER BY created_at').toArray().map(routineFromSql)
  }

  routine(id: string): RoutineRow | undefined {
    const row = this.sql.exec<RoutineSql>('SELECT * FROM routine WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : routineFromSql(row)
  }

  saveRoutine(routine: RoutineRow): void {
    this.sql.exec(
      `INSERT INTO routine (id, name, prompt, schedule, time_zone, next_run, last_run, created_at, paused) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, prompt = excluded.prompt, schedule = excluded.schedule,
         time_zone = excluded.time_zone, next_run = excluded.next_run, last_run = excluded.last_run, paused = excluded.paused`,
      routine.id, routine.name, routine.prompt, JSON.stringify(routine.schedule), routine.timeZone,
      routine.nextRun, routine.lastRun, routine.createdAt, routine.paused ? 1 : 0,
    )
  }

  addRoutineRun(routineId: string, wakeupId: number, at: number): void {
    this.sql.exec("INSERT OR REPLACE INTO routine_run (wakeup_id, routine_id, at, outcome, summary) VALUES (?, ?, ?, 'running', '')", wakeupId, routineId, at)
  }

  finishRoutineRun(wakeupId: number, outcome: 'done' | 'failed', summary: string): void {
    this.sql.exec('UPDATE routine_run SET outcome = ?, summary = ? WHERE wakeup_id = ?', outcome, summary, wakeupId)
  }

  routineRuns(routineId: string, limit = 10): Array<{ at: number; outcome: 'running' | 'done' | 'failed'; summary: string }> {
    return this.sql.exec<{ at: number; outcome: 'running' | 'done' | 'failed'; summary: string }>(
      'SELECT at, outcome, summary FROM routine_run WHERE routine_id = ? ORDER BY at DESC LIMIT ?', routineId, limit,
    ).toArray()
  }

  deleteRoutine(id: string): boolean {
    return this.sql.exec('DELETE FROM routine WHERE id = ?', id).rowsWritten > 0
  }

  // ------------------------------------------------------------ wake-ups and the active turn

  enqueue(kind: WakeupKind, sender: Sender, text: string, payload: Record<string, unknown>, now: number): number {
    this.sql.exec(
      'INSERT INTO wakeup (kind, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      kind, JSON.stringify(sender), text, JSON.stringify(payload), now,
    )
    return this.sql.exec<{ id: number }>('SELECT last_insert_rowid() AS id').one().id
  }

  nextWakeup(): Wakeup | undefined {
    const row = this.sql.exec<WakeupSql>('SELECT * FROM wakeup ORDER BY id LIMIT 1').toArray()[0]
    return row === undefined ? undefined : wakeupFromSql(row)
  }

  wakeup(id: number): Wakeup | undefined {
    const row = this.sql.exec<WakeupSql>('SELECT * FROM wakeup WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : wakeupFromSql(row)
  }

  pendingWakeups(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM wakeup').one().n
  }

  activeTurn(): { wakeupId: number; startedAt: number; sessionId: string; startSeq: number } | undefined {
    const row = this.sql.exec<{ wakeup_id: number; started_at: number; session_id: string; start_seq: number }>(
      "SELECT wakeup_id, started_at, session_id, start_seq FROM turn WHERE k = 'active'",
    ).toArray()[0]
    return row === undefined ? undefined : { wakeupId: row.wakeup_id, startedAt: row.started_at, sessionId: row.session_id, startSeq: row.start_seq }
  }

  beginTurn(wakeupId: number, sessionId: string, startSeq: number, now: number): void {
    this.sql.exec(
      "INSERT INTO turn (k, wakeup_id, started_at, session_id, start_seq) VALUES ('active', ?, ?, ?, ?)",
      wakeupId, now, sessionId, startSeq,
    )
  }

  /** The turn finished: drop it and its wake-up in one step. */
  endTurn(wakeupId: number): void {
    this.transaction(() => {
      this.sql.exec("DELETE FROM turn WHERE k = 'active'")
      this.sql.exec('DELETE FROM wakeup WHERE id = ?', wakeupId)
    })
  }

  // ------------------------------------------------------------ notices

  addNotice(sessionId: string, afterSeq: number, text: string, now: number): NoticeRow {
    const notice = { id: `n-${crypto.randomUUID()}`, sessionId, afterSeq, at: now, text }
    this.sql.exec('INSERT INTO notice (id, session_id, after_seq, at, text) VALUES (?, ?, ?, ?, ?)', notice.id, sessionId, afterSeq, now, text)
    return notice
  }

  notices(sessionId: string): NoticeRow[] {
    return this.sql.exec<{ id: string; session_id: string; after_seq: number; at: number; text: string }>(
      'SELECT * FROM notice WHERE session_id = ? ORDER BY after_seq, at', sessionId,
    ).toArray().map((row) => ({ id: row.id, sessionId: row.session_id, afterSeq: row.after_seq, at: row.at, text: row.text }))
  }

  // ------------------------------------------------------------ rewinds (robot-0q6a, robot-8v1t)

  rewinds(): RewindView[] {
    return this.sql.exec<{ id: string; at_seq: number; archived_session_id: string; live_session_id: string; created_at: number; undone_at: number | null }>(
      'SELECT * FROM rewind ORDER BY created_at',
    ).toArray().map((row) => ({
      id: row.id,
      atSeq: row.at_seq,
      archivedSessionId: row.archived_session_id,
      liveSessionId: row.live_session_id,
      at: row.created_at,
      undone: row.undone_at !== null,
    }))
  }

  addRewind(rewind: Omit<RewindView, 'undone'>): void {
    this.sql.exec(
      'INSERT INTO rewind (id, at_seq, archived_session_id, live_session_id, created_at) VALUES (?, ?, ?, ?, ?)',
      rewind.id, rewind.atSeq, rewind.archivedSessionId, rewind.liveSessionId, rewind.at,
    )
  }

  markRewindUndone(id: string, now: number): void {
    this.sql.exec('UPDATE rewind SET undone_at = ? WHERE id = ?', now, id)
  }

  // ------------------------------------------------------------ usage (robot-6jqh)

  addUsage(month: string, inputTokens: number, outputTokens: number, costUsd: number): void {
    this.sql.exec(
      `INSERT INTO usage (month, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?)
       ON CONFLICT (month) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd`,
      month, inputTokens, outputTokens, costUsd,
    )
  }

  usage(month: string): { inputTokens: number; outputTokens: number; costUsd: number } {
    const row = this.sql.exec<{ input_tokens: number; output_tokens: number; cost_usd: number }>('SELECT * FROM usage WHERE month = ?', month).toArray()[0]
    return { inputTokens: row?.input_tokens ?? 0, outputTokens: row?.output_tokens ?? 0, costUsd: row?.cost_usd ?? 0 }
  }

  // ------------------------------------------------------------ small values

  get<T>(key: string): T | undefined {
    const row = this.sql.exec<{ v: string }>('SELECT v FROM kv WHERE k = ?', key).toArray()[0]
    return row === undefined ? undefined : (JSON.parse(row.v) as T)
  }

  set(key: string, value: unknown): void {
    this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value))
  }

  delete(key: string): void {
    this.sql.exec('DELETE FROM kv WHERE k = ?', key)
  }
}

export class RobotNotFound extends Error {
  constructor() {
    super('robot does not exist')
    this.name = 'RobotNotFound'
  }
}

type ProposalSql = {
  id: string
  kind: ProposalKind
  revision: number
  status: ProposalRow['status']
  purpose: string
  payload: string
  created_at: number
  answered_at: number | null
}

function proposalFromSql(row: ProposalSql): ProposalRow {
  const payload = JSON.parse(row.payload) as Record<string, unknown>
  return {
    id: row.id,
    kind: row.kind,
    revision: row.revision,
    status: row.status,
    purpose: row.purpose,
    payload,
    grants: (payload['grants'] as GrantSet | undefined) ?? null,
    file: (payload['file'] as ProposalView['file'] | undefined) ?? null,
    skill: (payload['skill'] as ProposalView['skill'] | undefined) ?? null,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  }
}

type RoutineSql = {
  id: string
  name: string
  prompt: string
  schedule: string
  time_zone: string
  next_run: number | null
  last_run: number | null
  created_at: number
  paused: number
}

function routineFromSql(row: RoutineSql): RoutineRow {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    schedule: JSON.parse(row.schedule) as RoutineSchedule,
    timeZone: row.time_zone,
    nextRun: row.next_run,
    lastRun: row.last_run,
    createdAt: row.created_at,
    paused: row.paused === 1,
  }
}

type WakeupSql = {
  id: number
  kind: WakeupKind
  sender: string
  text: string
  payload: string
  created_at: number
}

function wakeupFromSql(row: WakeupSql): Wakeup {
  return {
    id: row.id,
    kind: row.kind,
    sender: JSON.parse(row.sender) as Sender,
    text: row.text,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
  }
}