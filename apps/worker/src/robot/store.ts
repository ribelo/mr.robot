/**
 * The Robot DO's own tables. SQLite in a Durable Object is synchronous and
 * single-writer, so the store is a plain object with synchronous methods; the
 * session log lives beside it (agent/session-log.ts).
 */
import { EXPLICIT_TOOL_GROUPS, TOOL_GROUP_NAMES } from '../agent/catalog.ts'
import { SESSION_LOG_SCHEMA } from '../agent/session-log.ts'
import { ConversationIndex } from '../agent/conversation-search.ts'
import * as Schema from 'effect/Schema'
import { HOST_FACETS, hostFacetKey, splitHostFacet, StoredPlace } from '../places/host-facet.ts'
import { HOST_ACCESS, HOST_DIRECTORY, mrRobotHostLevel, robotDirectoryName, unsharedMrRobotDirectory } from './host-access.ts'
import { JobId } from '../places/job-id.ts'
import { dropEmptyRoutines, legacyWakeup } from './routine-export.ts'
import { mrRobotIdOf } from './delivery.ts'
import { isRemovedBrowserBackend } from '../browser/removed-backends.ts'
import { legacyRobotSpendLimit } from '../platform/spend-limit-migration.ts'
import { costBreakdown, type CostBreakdown, type UsageSource } from '@mr-robot/protocol'
import { emptyGrants, GRANT_FIELDS, grantLevel, isGrantLevel, overlayGrants, parseGrantSet, robotIdentity, usableLevel, type StoredIdentity } from '@mr-robot/protocol'
import type {
  GrantKind,
  GrantLevel,
  GrantLevels,
  GrantSet,
  HelpAsk,
  Identity,
  ChainEntry, ModelChoice,
  NotificationSettings,
  ProposalKind,
  ProposalView,
  ThreadAsk,
  ToolCallAsk,
  QuestionAsk,
  CredentialAsk,
  ReviewView,
  RewindView,
  RobotStatus,
  RobotSpendLimit,
  ThreadEvent,
  ThreadView,
  BrowserBackend,
  Sender,
  Sharing,
  TaskAction,
  WakeupKind,
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
  /** The model chain (v1.10); absent in Robots made before it: one entry on `model`. */
  readonly chain?: readonly ChainEntry[]
  readonly contextBudget: number
  readonly codeMode: boolean
  /** Absent in Robots created before the setting existed: off. */
  readonly wakeOnScreenNotifications?: boolean
  /** Absent or null: the Home default backend. */
  readonly browserBackend?: BrowserBackend | null
  /** The Discord channel this Robot talks in (cn-y1ac); absent or null: none. */
  readonly discordChannel?: string | null
  /** Also send the Robot's unasked messages to its Discord channel (cn-y1ac); absent: yes. */
  readonly discordProactive?: boolean
  /** The secret in this Robot's webhook address (v1.6 ticket 07); created on first use. */
  readonly webhookKey?: string
  readonly compactionInstruction: string
  /** The idle plugins (v1.14); absent on Robots made before them: the default of their kind (idle.ts). */
  readonly cacheWarming?: boolean
  readonly idleCompaction?: boolean
  readonly idleCompactionFloorTokens?: number
  /** Auto review (v1.14 ticket 08): off when absent; the reviewer route, or null for the Home default. */
  readonly autoReview?: boolean
  readonly reviewer?: ModelChoice | null
  /** v1.16 (ob-5nvd): Tasks wait for, or fail on, an offline Host the Robot holds a facet on; off when absent. */
  readonly requiresHosts?: boolean
  readonly notifications: NotificationSettings
  /** The Robot's own monthly spend limit, or the Home's (ux-q8ve). */
  readonly spendLimit: RobotSpendLimit
  /** The owner's profile zone, kept current by the Member's fan-out (Robot.timeZoneChanged); never set by hand. */
  readonly timeZone: string
  readonly liveSessionId: string
  /** Bumped on every settings or grant change; the agent composition is rebuilt when it moves. */
  readonly revision: number
  readonly createdAt: number
}

export type { WakeupKind }

/** How a Wake-up reaches the Robot (v1.14): at the next step of a running Turn, or in a Turn of its own. */
export type Delivery = 'steer' | 'followup'

export interface Wakeup {
  readonly id: number
  readonly kind: WakeupKind
  readonly sender: Sender
  readonly delivery: Delivery
  readonly text: string
  /** Extra structured data the turn needs (attachments, robot request ids, channel reply route). */
  readonly payload: Record<string, unknown>
  readonly createdAt: number
}

/** The Turn running now: its Wake-up, where it starts in the log, and the Task it works on with that Task's attempt. */
export interface ActiveTurn {
  readonly wakeupId: number
  readonly startedAt: number
  readonly sessionId: string
  readonly startSeq: number
  readonly task: { readonly id: string; readonly title: string; readonly attemptId: number } | null
}

/** One command that goes on by itself, on the Box or on a Host (v1.15 ticket 07, gb-lnph; v1.16 ticket 01). */
export interface JobRow {
  readonly id: JobId
  /** Where it runs: "box" or "host:<id>". */
  readonly place: StoredPlace
  /** The Host's name when it started; null for the Box. */
  readonly placeName: string | null
  readonly command: string
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly exitCode: number | null
  readonly status: 'running' | 'completed' | 'killed' | 'lost'
  /** How much of each stream the Robot has read (job_output). */
  readonly outOffset: number
  readonly errOffset: number
  /** Still the foreground wait of a run: its end does not wake the Robot, which is waiting for it. */
  readonly foreground: boolean
  /** The Workspace path of the whole output once the job ended. */
  readonly spill: string | null
}

type JobSql = { id: string; place: string; place_name: string | null; command: string; started_at: number; finished_at: number | null; exit_code: number | null; status: JobRow['status']; out_offset: number; err_offset: number; foreground: number; spill: string | null }

function jobFromSql(row: JobSql): JobRow {
  return { id: Schema.decodeUnknownSync(JobId)(row.id), place: Schema.decodeUnknownSync(StoredPlace)(row.place), placeName: row.place_name, command: row.command, startedAt: row.started_at, finishedAt: row.finished_at, exitCode: row.exit_code, status: row.status, outOffset: row.out_offset, errOffset: row.err_offset, foreground: row.foreground === 1, spill: row.spill }
}

export interface ProposalRow extends ProposalView {
  readonly createdAt: number
  readonly answeredAt: number | null
  /** Exact stored payload; the approved payload is applied, never prose. */
  readonly payload: Record<string, unknown>
}

/** A notice the chat shows as a Task card (mc-c1aa): someone other than this Robot changed one of its Tasks. */
export interface TaskCard {
  readonly kind: 'task'
  readonly action: TaskAction
  readonly taskId: string
  readonly title: string
  /** Who changed it. */
  readonly by: string
}

/** A Routine card stored before v1.13; read as a Task card (mc-c2bb). */
export interface StoredRoutineCard {
  readonly kind: 'routine'
  readonly action: 'created' | 'updated' | 'deleted' | 'paused' | 'resumed'
  readonly name: string
  readonly by: string
}

/** A notice the chat shows as a Thread card (ch-iy16). */
export interface ThreadCard {
  readonly kind: 'thread'
  readonly threadId: string
  readonly event: ThreadEvent
}

export type NoticeCard = TaskCard | ThreadCard | StoredRoutineCard

/** This chief's copy of a Thread: the state the Home last told it, and the messages since the owner last let it go on (ch-408z). */
export interface ThreadCopy {
  readonly view: ThreadView
  readonly windowCount: number
}

export interface NoticeRow {
  readonly id: string
  readonly afterSeq: number
  readonly at: number
  readonly text: string
  readonly sessionId: string
  readonly card?: NoticeCard
}

const SCHEMA_VERSION = 22

/** One step of a migration: a statement, or a change SQL cannot say. */
type MigrationStep = string | ((sql: SqlStorage) => void)

/** The config's spend limit as a typed value (v1.12, ux-ommv): null is the Home's, 0 is no limit. */
function typedSpendLimit(sql: SqlStorage): void {
  const row = sql.exec<{ v: string }>("SELECT v FROM robot WHERE k = 'config'").toArray()[0]
  if (row === undefined) return
  const { spendLimitUsd, ...config } = JSON.parse(row.v) as Record<string, unknown>
  if ('spendLimit' in config) return
  sql.exec("UPDATE robot SET v = ? WHERE k = 'config'", JSON.stringify({ ...config, spendLimit: legacyRobotSpendLimit(spendLimitUsd) }))
}

/** The Grants every ordinary Robot is created with (v1.15 ticket 04, gb-qmnc): to message its owner's Mr. Robot, its chief. Removable like any other. */
export function chiefGrants(ownerId: string): GrantSet {
  return { ...emptyGrants, tools: { messaging: 'allow' }, recipients: { [mrRobotIdOf(ownerId)]: 'allow' } }
}

/** A Robot that exists gets them once; a row it already has stays as it is. Mr. Robot is the chief and needs none. */
function giveChiefRecipient(sql: SqlStorage): void {
  const row = sql.exec<{ v: string }>("SELECT v FROM robot WHERE k = 'config'").toArray()[0]
  if (row === undefined) return
  const config = JSON.parse(row.v) as { readonly kind?: string; readonly ownerId?: string }
  if (config.kind !== 'robot' || config.ownerId === undefined) return
  sql.exec("INSERT OR IGNORE INTO grant_item (kind, name, level) VALUES ('recipient', ?, 'allow')", mrRobotIdOf(config.ownerId))
  sql.exec("INSERT OR IGNORE INTO grant_item (kind, name, level) VALUES ('tool', 'messaging', 'allow')")
}

/**
 * What the Robot stored under the name Computer, under the name Box (v1.15 ticket 06, gb-ao8m). Idempotent: a store
 * that never had the old names has nothing to move. The Workspace folder is moved by the Robot itself (robot.ts).
 */
function renameComputerToBox(sql: SqlStorage): void {
  sql.exec("UPDATE OR REPLACE grant_item SET name = 'box' WHERE kind = 'tool' AND name = 'computer'")
  const has = (table: string) => sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table).toArray().length > 0
  if (has('computer_usage')) {
    sql.exec('CREATE TABLE IF NOT EXISTS box_usage (month TEXT PRIMARY KEY, ms INTEGER NOT NULL, cost_usd REAL NOT NULL) WITHOUT ROWID')
    sql.exec('INSERT INTO box_usage (month, ms, cost_usd) SELECT month, ms, cost_usd FROM computer_usage WHERE true ON CONFLICT (month) DO UPDATE SET ms = ms + excluded.ms, cost_usd = cost_usd + excluded.cost_usd')
    sql.exec('DROP TABLE computer_usage')
  }
  sql.exec("INSERT INTO usage (month, source, input_tokens, output_tokens, cost_usd) SELECT month, 'box', input_tokens, output_tokens, cost_usd FROM usage WHERE source = 'computer' ON CONFLICT (month, source) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd")
  sql.exec("DELETE FROM usage WHERE source = 'computer'")
  sql.exec("INSERT OR REPLACE INTO kv (k, v) SELECT 'box', v FROM kv WHERE k = 'computer'")
  sql.exec("DELETE FROM kv WHERE k = 'computer'")
  // An open Ask that names the grant or the tools (a proposal, a stored call waiting for its answer).
  const renamed = (value: unknown): unknown => {
    if (typeof value === 'string') return value === 'computer_run' || value === 'computer_read' || value === 'computer_write' ? value.replace('computer', 'box') : value
    if (Array.isArray(value)) return value.map(renamed)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key === 'computer' && typeof inner === 'string' && ['allow', 'ask', 'deny'].includes(inner) ? 'box' : key, renamed(inner)]))
    }
    return value
  }
  for (const row of sql.exec<{ id: string; payload: string }>("SELECT id, payload FROM proposal WHERE payload LIKE '%computer%'").toArray()) {
    sql.exec('UPDATE proposal SET payload = ? WHERE id = ?', JSON.stringify(renamed(JSON.parse(row.payload))), row.id)
  }
}

/**
 * A Robot on a removed browser backend follows the Home default (v1.16 ticket 08, ob-l24v), which is Browser Rendering after the
 * Home's own migration. A session left open on the removed backend is forgotten: nothing runs there any more. Usage rows keep their
 * backend names as history (ob-0c3o).
 */
function moveOffRemovedBrowsers(sql: SqlStorage): void {
  const row = sql.exec<{ v: string }>("SELECT v FROM robot WHERE k = 'config'").toArray()[0]
  if (row !== undefined) {
    const config = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(row.v)
    if (isRemovedBrowserBackend(config['browserBackend'])) sql.exec("UPDATE robot SET v = ? WHERE k = 'config'", JSON.stringify({ ...config, browserBackend: null }))
  }
  const session = sql.exec<{ v: string }>("SELECT v FROM kv WHERE k = 'browser-session'").toArray()[0]
  if (session !== undefined && isRemovedBrowserBackend(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(session.v)['backend'])) sql.exec("DELETE FROM kv WHERE k = 'browser-session'")
}

/** Mr. Robot's directory on the Hosts was every Member's Mr. Robot's (deep review P8): he gets one of his own. */
function unshareMrRobotDirectory(sql: SqlStorage): void {
  const config = sql.exec<{ v: string }>("SELECT v FROM robot WHERE k = 'config'").toArray()[0]
  const kept = sql.exec<{ v: string }>('SELECT v FROM kv WHERE k = ?', HOST_DIRECTORY).toArray()[0]
  if (config === undefined || kept === undefined) return
  const { id, kind } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ id: Schema.String, kind: Schema.optional(Schema.String) })))(config.v)
  if (kind !== 'mr-robot') return
  const directory = unsharedMrRobotDirectory(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.String))(kept.v), id)
  sql.exec('UPDATE kv SET v = ? WHERE k = ?', JSON.stringify(directory), HOST_DIRECTORY)
}

/** Add the columns a table lacks (a store opened again at an older version keeps the ones it has). */
function addColumns(sql: SqlStorage, table: string, columns: readonly string[]): void {
  const present = new Set(sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray().map((column) => column.name))
  for (const column of columns) if (!present.has(column.split(' ')[0]!)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`)
}

const MIGRATIONS: Record<number, readonly MigrationStep[]> = {
  // Every Member's Mr. Robot had one directory on a shared Host (deep review P8): his own from now on.
  22: [unshareMrRobotDirectory],
  // Two browsers (v1.16 ticket 08, ob-l24v): a Robot on Container Chrome follows the Home default.
  20: [moveOffRemovedBrowsers],
  // Jobs run in a place, the Box or a Host (v1.16 ticket 01, ob-rc3b): the Box's job table keeps its rows and learns where they ran.
  21: [
    (sql) => {
      const has = (table: string) => sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table).toArray().length > 0
      // A store opened again at an older version has both tables: the one step 19 just made is empty, the renamed one is the Robot's.
      if (has('box_job') && has('job')) sql.exec('DROP TABLE box_job')
      else if (has('box_job')) sql.exec('ALTER TABLE box_job RENAME TO job')
    },
    (sql) => addColumns(sql, 'job', ["place TEXT NOT NULL DEFAULT 'box'", 'place_name TEXT']),
  ],
  // The Box's jobs (v1.15 ticket 07, gb-lnph): commands that go on by themselves, with the offsets of what the Robot has read.
  19: ["CREATE TABLE IF NOT EXISTS box_job (id TEXT PRIMARY KEY, command TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, exit_code INTEGER, status TEXT NOT NULL, out_offset INTEGER NOT NULL DEFAULT 0, err_offset INTEGER NOT NULL DEFAULT 0, foreground INTEGER NOT NULL DEFAULT 1, spill TEXT) WITHOUT ROWID"],
  // Every Robot can ask its chief (v1.15 ticket 04, gb-qmnc): the recipient Grant to its owner's Mr. Robot and the messaging group, given once to the Robots that exist.
  18: [giveChiefRecipient],
  // The Computer became the Box (v1.15 ticket 06, gb-ao8m): its grant, its running time, its cost rows, its state and its open Asks.
  17: [renameComputerToBox],
  // The Box's running time per month (v1.14 ticket 10, ao-54j2); the computer's until v1.15.
  16: ['CREATE TABLE IF NOT EXISTS box_usage (month TEXT PRIMARY KEY, ms INTEGER NOT NULL, cost_usd REAL NOT NULL) WITHOUT ROWID'],
  // Subagents (v1.14 ticket 06): a grant item carries a payload (the subagents grant's model list); the child sessions.
  15: [
    (sql) => addColumns(sql, 'grant_item', ['payload TEXT']),
    `CREATE TABLE IF NOT EXISTS subagent (
      id TEXT PRIMARY KEY, parent_session TEXT NOT NULL, parent_seq INTEGER NOT NULL, label TEXT NOT NULL, mode TEXT NOT NULL,
      task TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL, status TEXT NOT NULL,
      report TEXT, started_at INTEGER NOT NULL, finished_at INTEGER, accounted_seq INTEGER NOT NULL DEFAULT 0
    )`,
  ],
  // Usage by source (v1.14, ao-zbld): each month's model cost apart from browser and services, which were added into it.
  14: [
    'CREATE TABLE usage_v14 (month TEXT NOT NULL, source TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (month, source)) WITHOUT ROWID',
    `INSERT INTO usage_v14 (month, source, input_tokens, output_tokens, cost_usd)
      SELECT month, 'robot', input_tokens, output_tokens, MAX(0, cost_usd
        - COALESCE((SELECT SUM(cost_usd) FROM browser_usage b WHERE b.month = usage.month), 0)
        - COALESCE((SELECT SUM(cost_usd) FROM service_usage s WHERE s.month = usage.month), 0)) FROM usage`,
    "INSERT INTO usage_v14 (month, source, input_tokens, output_tokens, cost_usd) SELECT month, 'browser', 0, 0, SUM(cost_usd) FROM browser_usage GROUP BY month",
    "INSERT INTO usage_v14 (month, source, input_tokens, output_tokens, cost_usd) SELECT month, 'services', 0, 0, SUM(cost_usd) FROM service_usage GROUP BY month",
    'DROP TABLE usage',
    'ALTER TABLE usage_v14 RENAME TO usage',
  ],
  // How a Wake-up reaches the Robot (v1.14, ao-9570): a steer reaches a running Turn, a follow-up waits for its own.
  13: [(sql) => addColumns(sql, 'wakeup', ["delivery TEXT NOT NULL DEFAULT 'followup'"])],
  // Routines are Tasks at the Home (v1.13 ticket 05): a Robot without any has no Routine tables; the Home takes the others' and drops them.
  12: [dropEmptyRoutines],
  // The routines tool group became tasks (v1.13, mc-r1aa): the same Grant, by its new name.
  11: ["UPDATE OR REPLACE grant_item SET name = 'tasks' WHERE kind = 'tool' AND name = 'routines'"],
  // The Task a Turn works on and its attempt at the Home (v1.13, mc-w3cc).
  10: [(sql) => addColumns(sql, 'turn', ['task_id TEXT', 'task_title TEXT', 'attempt_id INTEGER'])],
  // Typed spend limits (v1.12, ux-ommv).
  9: [typedSpendLimit],
  // Grant levels (v1.11, sk-xj5q): every row stored so far was a grant, so it becomes allow.
  8: ["ALTER TABLE grant_item ADD COLUMN level TEXT NOT NULL DEFAULT 'allow'"],
  // This chief's copy of each Thread (v1.9).
  7: ['CREATE TABLE thread (id TEXT PRIMARY KEY, view TEXT NOT NULL, window_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)'],
  // Run records with a finish time and the 20-run window (cd-3t0p); a Routine card in the chat (cd-n9pi).
  6: [
    `CREATE TABLE routine_run_v6 (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wakeup_id INTEGER, routine_id TEXT NOT NULL,
      started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT NOT NULL, first_line TEXT NOT NULL
    )`,
    `INSERT INTO routine_run_v6 (wakeup_id, routine_id, started_at, finished_at, outcome, first_line)
      SELECT wakeup_id, routine_id, at, CASE WHEN outcome = 'running' THEN NULL ELSE at END, CASE outcome WHEN 'done' THEN 'ok' ELSE outcome END, summary FROM routine_run ORDER BY at`,
    'DROP TABLE routine_run',
    'ALTER TABLE routine_run_v6 RENAME TO routine_run',
    'CREATE INDEX routine_run_by_routine ON routine_run (routine_id, started_at)',
    'ALTER TABLE notice ADD COLUMN card TEXT',
  ],
  // Paid services per month (Exa, rb-pb26).
  5: ['CREATE TABLE service_usage (month TEXT NOT NULL, service TEXT NOT NULL, calls INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (month, service)) WITHOUT ROWID'],
  // Browser time per backend (rb-y50l).
  4: ['CREATE TABLE browser_usage (month TEXT NOT NULL, backend TEXT NOT NULL, ms INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (month, backend)) WITHOUT ROWID'],
  // The DSH schedule record each Routine now is (robot-c8hq) and the session that made it.
  3: ['ALTER TABLE routine ADD COLUMN record TEXT', 'ALTER TABLE routine ADD COLUMN session_id TEXT'],
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
  /** Full-text search over the live Conversation (cd-ggem). */
  search!: ConversationIndex

  constructor(private readonly storage: DurableObjectStorage) {
    this.prepare()
  }

  /** Create the tables; also after a deletion wiped the storage, so the same object can be created again. */
  prepare(): void {
    this.migrate()
    for (const statement of SESSION_LOG_SCHEMA) this.sql.exec(statement)
    this.search = new ConversationIndex(this.sql, true, (sessionId) => this.voiceFrom(sessionId))
  }

  /**
   * From which event of a session only what the Robot said is a reply (v1.15 ticket 01, gb-psyl). Before it the Robot had no
   * say, and its assistant text was the reply. Zero for a session that was never without say.
   */
  voiceFrom(sessionId: string): number {
    return this.get<number>(`voice-from:${sessionId}`) ?? 0
  }

  setVoiceFrom(sessionId: string, seq: number): void {
    this.set(`voice-from:${sessionId}`, seq)
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
        for (const step of MIGRATIONS[version] ?? []) {
          if (typeof step === 'string') this.sql.exec(step)
          else step(this.sql)
        }
      }
      this.sql.exec('DELETE FROM schema_version')
      this.sql.exec('INSERT INTO schema_version (version) VALUES (?)', SCHEMA_VERSION)
    })
  }

  // ------------------------------------------------------------ config

  config(): RobotConfig | undefined {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM robot WHERE k = 'config'").toArray()[0]
    if (row === undefined) return undefined
    // A config stored before avatar seeds existed has none: the Robot's id is its seed (ux-4fgy).
    const stored = JSON.parse(row.v) as Omit<RobotConfig, 'identity'> & { readonly identity: StoredIdentity }
    return { ...stored, identity: robotIdentity(stored.identity, stored.id, stored.kind) }
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

  /** The stored rows: every item this Robot was given a level for. */
  grants(): GrantSet {
    const rows = this.sql.exec<{ kind: GrantKind; name: string; level: string }>('SELECT kind, name, level FROM grant_item ORDER BY kind, name').toArray()
    const pick = (kind: GrantKind): GrantLevels => Object.fromEntries(rows.filter((row) => row.kind === kind).map((row) => [row.name, isGrantLevel(row.level) ? row.level : 'deny']))
    return { tools: pick('tool'), skills: pick('skill'), recipients: pick('recipient'), secrets: pick('secret'), hosts: pick('host'), connections: pick('connection') }
  }

  /**
   * Replace the stored rows (sk-746n). An ordinary Robot keeps allow and ask rows: an item without a row
   * is at deny. Mr. Robot keeps his recipients and otherwise only the items his owner lowered (ask or
   * deny): everything he reaches is at allow without a row, so allow is never pinned (sk-br7y, sk-8llz).
   */
  setGrants(grants: GrantSet): void {
    const mrRobot = this.config()?.kind === 'mr-robot'
    // Mr. Robot holds a group he reaches without a row, except the groups everyone holds only when granted (ao-zzga).
    // His files and shell on a Host start at ask (ob-2k5x), so there it is a raise to allow that needs a row, and ask needs none.
    const kept = (kind: GrantKind, name: string, level: GrantLevel) => mrRobot && kind === 'host' ? level !== mrRobotHostLevel(name) : mrRobot && kind !== 'recipient' && !(kind === 'tool' && EXPLICIT_TOOL_GROUPS.includes(name)) ? level !== 'allow' : usableLevel(level)
    // A payload (the subagents grant's model list) stays with its item through any change of level.
    const payloads = this.sql.exec<{ kind: GrantKind; name: string; payload: string }>('SELECT kind, name, payload FROM grant_item WHERE payload IS NOT NULL').toArray()
    this.transaction(() => {
      this.sql.exec('DELETE FROM grant_item')
      for (const [kind, field] of Object.entries(GRANT_FIELDS) as Array<[GrantKind, keyof GrantSet]>) {
        for (const [given, level] of Object.entries(grants[field])) {
          // A proposal made before v1.13 names the group by its old name (mc-r1aa); one made before v1.15 calls the Box the computer.
          const name = kind === 'tool' && given === 'routines' ? 'tasks' : kind === 'tool' && given === 'computer' ? 'box' : given
          if (kept(kind, name, level)) this.sql.exec('INSERT INTO grant_item (kind, name, level) VALUES (?, ?, ?)', kind, name, level)
        }
      }
      for (const row of payloads) {
        this.sql.exec("INSERT INTO grant_item (kind, name, level, payload) VALUES (?, ?, 'deny', ?) ON CONFLICT (kind, name) DO UPDATE SET payload = excluded.payload", row.kind, row.name, row.payload)
      }
      this.pruneHostAccess()
    })
  }

  /**
   * The level of one Host facet as the owner set it, else what the Robot starts at: Mr. Robot's files and shell at ask and his browser at
   * allow (ob-2k5x); any other Robot at deny. It does not depend on what the Robot reaches now, so a Host can ask it at any time.
   */
  hostLevel(facet: string): GrantLevel {
    const stored = this.grants().hosts[facet]
    if (stored !== undefined) return stored
    return this.config()?.kind === 'mr-robot' ? mrRobotHostLevel(facet) : 'deny'
  }

  /**
   * The name of this Robot's directory under mr-robot/ on its owner's Hosts: chosen when first needed (a Host call, or write roots to check
   * against it) and kept, so that a rename does not lose its files there.
   */
  hostDirectory(): string {
    const kept = this.get<string>(HOST_DIRECTORY)
    if (kept !== undefined) return kept
    const config = this.requireConfig()
    const chosen = robotDirectoryName(config.identity.name, config.id)
    this.set(HOST_DIRECTORY, chosen)
    return chosen
  }

  /** The mode and roots of a Host facet that is no longer usable are forgotten: they would come back with the next grant. */
  pruneHostAccess(): void {
    const access = this.get<Readonly<Record<string, unknown>>>(HOST_ACCESS)
    if (access === undefined) return
    const kept = Object.entries(access).filter(([facet]) => usableLevel(this.hostLevel(facet)))
    if (kept.length !== Object.keys(access).length) this.set(HOST_ACCESS, Object.fromEntries(kept))
  }

  /** The Hosts this Robot keeps a grant row or a mode and roots for, reachable now or not. */
  keptHostIds(): string[] {
    const rows = this.sql.exec<{ name: string }>("SELECT name FROM grant_item WHERE kind = 'host'").toArray().map((row) => row.name)
    const facets = [...rows, ...Object.keys(this.get<Readonly<Record<string, unknown>>>(HOST_ACCESS) ?? {})]
    return [...new Set(facets.flatMap((facet) => splitHostFacet(facet)?.hostId ?? []))]
  }

  /**
   * Forget unpaired Hosts: their grant rows and their modes and roots. A Host that is only out of reach (no longer shared) keeps both, so
   * that it comes back with the access its owner set, not the wider default (deep review P13).
   */
  forgetUnpairedHosts(hostIds: readonly string[]): void {
    if (hostIds.length === 0) return
    const gone = (facet: string) => hostIds.includes(splitHostFacet(facet)?.hostId ?? '')
    this.transaction(() => {
      for (const row of this.sql.exec<{ name: string }>("SELECT name FROM grant_item WHERE kind = 'host'").toArray()) {
        if (gone(row.name)) this.sql.exec("DELETE FROM grant_item WHERE kind = 'host' AND name = ?", row.name)
      }
      const access = this.get<Readonly<Record<string, unknown>>>(HOST_ACCESS)
      if (access !== undefined && Object.keys(access).some(gone)) this.set(HOST_ACCESS, Object.fromEntries(Object.entries(access).filter(([facet]) => !gone(facet))))
    })
  }

  /** The payload of one grant item, parsed; undefined when it has none. */
  grantPayload<T>(kind: GrantKind, name: string): T | undefined {
    const row = this.sql.exec<{ payload: string | null }>('SELECT payload FROM grant_item WHERE kind = ? AND name = ?', kind, name).toArray()[0]
    return row?.payload == null ? undefined : (JSON.parse(row.payload) as T)
  }

  /** Set the payload of one grant item; an item without a row gets one at deny, so the payload waits for the grant. */
  setGrantPayload(kind: GrantKind, name: string, payload: unknown): void {
    this.sql.exec("INSERT INTO grant_item (kind, name, level, payload) VALUES (?, ?, 'deny', ?) ON CONFLICT (kind, name) DO UPDATE SET payload = excluded.payload", kind, name, JSON.stringify(payload))
  }

  /** What Mr. Robot can reach without grants: every login and skill its owner can (rb-b0rs). Kept in memory, refreshed each Turn. */
  private reach: { readonly secrets: readonly string[]; readonly skills: readonly string[]; readonly hosts?: readonly string[]; readonly connections?: readonly string[] } = { secrets: [], skills: [] }

  setReach(reach: { readonly secrets: readonly string[]; readonly skills: readonly string[]; readonly hosts?: readonly string[]; readonly connections?: readonly string[] }): void {
    this.reach = reach
  }

  /**
   * The levels that apply (sk-br7y): an ordinary Robot's stored rows; for Mr. Robot every tool group
   * (also of a plugin added later) and everything his owner reaches at allow (his files and shell on a Host at ask), under the rows his
   * owner stored to change an item. Recipients are stored rows for both.
   */
  effectiveGrants(): GrantSet {
    const stored = this.grants()
    if (this.config()?.kind !== 'mr-robot') return stored
    const allow = (names: readonly string[]): GrantLevels => Object.fromEntries(names.map((name) => [name, 'allow' as const]))
    const reached: GrantSet = {
      tools: allow(TOOL_GROUP_NAMES.filter((name) => !EXPLICIT_TOOL_GROUPS.includes(name))),
      skills: allow(this.reach.skills),
      recipients: {},
      secrets: allow(this.reach.secrets),
      hosts: Object.fromEntries((this.reach.hosts ?? []).flatMap((id) => HOST_FACETS.map((facet) => hostFacetKey(id, facet))).map((facet) => [facet, mrRobotHostLevel(facet)])),
      // Mr. Robot reaches every connection his owner can use, writing included (cn-xezx).
      connections: allow((this.reach.connections ?? []).flatMap((id) => [id, `${id}:write`])),
    }
    return overlayGrants(reached, stored)
  }

  /**
   * The level of one grant item for this Robot: the single answer to "may it use X, and how" (sk-746n).
   * Registration, call-time checks and the ask-per-call wrapper read levels through this.
   */
  levelOf(kind: GrantKind, name: string): GrantLevel {
    return grantLevel(this.effectiveGrants(), kind, name)
  }

  /** Whether the Robot may use an item: allow, or ask (each call asks the owner). */
  mayUse(kind: GrantKind, name: string): boolean {
    return usableLevel(this.levelOf(kind, name))
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
  answerProposal(id: string, revision: number, approve: boolean, now: number, decision?: { approved: readonly string[]; rejected: readonly string[] }, scope?: string, note?: string): ProposalRow | undefined {
    const status = approve ? 'approved' : 'rejected'
    // A review's decision is kept beside the stored payload, which itself stays as proposed.
    const cursor = decision === undefined
      ? this.sql.exec("UPDATE proposal SET status = ?, answered_at = ? WHERE id = ? AND revision = ? AND status = 'open'", status, now, id, revision)
      : this.sql.exec("UPDATE proposal SET status = ?, answered_at = ?, payload = json_set(payload, '$.decision', json(?)) WHERE id = ? AND revision = ? AND status = 'open'", status, now, JSON.stringify(decision), id, revision)
    if (cursor.rowsWritten !== 1) return undefined
    // A Thread invitation's scope is stored with the answer, as the owner edited it (ch-vrl7).
    if (scope !== undefined) this.sql.exec("UPDATE proposal SET payload = json_set(payload, '$.scope', ?) WHERE id = ?", scope, id)
    // A tool-call Ask keeps the owner's text with the answer (sk-ed7r).
    if (note !== undefined) this.sql.exec("UPDATE proposal SET payload = json_set(payload, '$.note', ?) WHERE id = ?", note, id)
    return this.proposal(id)
  }

  /**
   * Close a help Ask with an answer. The first answer wins: it succeeds only for an open help Ask.
   * @returns the closed Ask, or undefined when there is none or it is already closed.
   */
  answerHelp(id: string, by: 'owner' | 'mr-robot', text: string, now: number): ProposalRow | undefined {
    const open = this.proposal(id)
    if (open === undefined || open.kind !== 'help' || open.status !== 'open') return undefined
    this.sql.exec("UPDATE proposal SET status = 'done', answered_at = ?, payload = json_set(payload, '$.answer', json(?)) WHERE id = ?", now, JSON.stringify({ by, text }), id)
    return this.proposal(id)
  }

  /**
   * The owner's later answer on a help Ask Mr. Robot closed (sk-q86i): kept beside his answer, once.
   * @returns the Ask, or undefined when it is not a help Ask answered by Mr. Robot without an override yet.
   */
  overrideHelp(id: string, text: string, now: number): ProposalRow | undefined {
    const closed = this.proposal(id)
    if (closed === undefined || closed.kind !== 'help' || closed.help?.answeredBy !== 'mr-robot' || closed.help.override !== null) return undefined
    this.sql.exec("UPDATE proposal SET payload = json_set(payload, '$.override', json(?)) WHERE id = ?", JSON.stringify({ text, at: now }), id)
    return this.proposal(id)
  }

  /**
   * Close a question Ask with the owner's answer (or a dismissal, which is a rejection). Compare-and-swap on the revision.
   * @returns the closed Ask, or undefined when it is not an open question at this revision.
   */
  answerQuestion(id: string, revision: number, answer: NonNullable<QuestionAsk['answer']>, now: number): ProposalRow | undefined {
    const status = answer.kind === 'dismissed' ? 'rejected' : 'approved'
    const cursor = this.sql.exec("UPDATE proposal SET status = ?, answered_at = ?, payload = json_set(payload, '$.questionAnswer', json(?)) WHERE id = ? AND kind = 'question' AND revision = ? AND status = 'open'", status, now, JSON.stringify(answer), id, revision)
    return cursor.rowsWritten === 1 ? this.proposal(id) : undefined
  }

  /** Dismiss the open questions that asked to go when the owner moved on; their rows, for the message that carries the news. */
  dismissOnMoveOn(now: number): ProposalRow[] {
    const open = this.proposals('open').filter((row) => row.kind === 'question' && row.question?.dismissOnMoveOn === true)
    return open.flatMap((row) => this.answerQuestion(row.id, row.revision, { kind: 'dismissed', reason: 'moved-on' }, now) ?? [])
  }

  /** Close a credential Ask: saved (the entry's name) or declined. */
  answerCredential(id: string, revision: number, result: { readonly entry: string } | { readonly declined: true }, now: number): ProposalRow | undefined {
    const outcome = 'entry' in result ? { status: 'approved', patch: { credentialEntry: result.entry } } : { status: 'rejected', patch: { credentialDeclined: true } }
    const cursor = this.sql.exec(
      "UPDATE proposal SET status = ?, answered_at = ?, payload = json_patch(payload, json(?)) WHERE id = ? AND kind = 'credential' AND revision = ? AND status = 'open'",
      outcome.status, now, JSON.stringify(outcome.patch), id, revision,
    )
    return cursor.rowsWritten === 1 ? this.proposal(id) : undefined
  }

  // ------------------------------------------------------------ Jobs (v1.15 ticket 07, v1.16 ticket 01)

  addJob(id: JobId, place: StoredPlace, placeName: string | null, command: string, now: number): void {
    this.sql.exec("INSERT INTO job (id, place, place_name, command, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')", id, place, place === 'box' ? null : placeName, command, now)
  }

  job(id: JobId): JobRow | undefined {
    const row = this.sql.exec<JobSql>('SELECT * FROM job WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : jobFromSql(row)
  }

  /** The newest jobs first; the table keeps the last 50 finished ones. */
  jobs(): JobRow[] {
    return this.sql.exec<JobSql>('SELECT * FROM job ORDER BY started_at DESC, id').toArray().map(jobFromSql)
  }

  /** The jobs running now, of one place or of every place. */
  runningJobs(place?: StoredPlace): JobRow[] {
    const rows = place === undefined
      ? this.sql.exec<JobSql>("SELECT * FROM job WHERE status = 'running' ORDER BY started_at").toArray()
      : this.sql.exec<JobSql>("SELECT * FROM job WHERE status = 'running' AND place = ? ORDER BY started_at", place).toArray()
    return rows.map(jobFromSql)
  }

  /** Close a running job; false when it was closed already (one close per job). */
  closeJob(id: JobId, status: 'completed' | 'killed' | 'lost', exitCode: number | null, now: number, spill: string | null): boolean {
    const cursor = this.sql.exec("UPDATE job SET status = ?, exit_code = ?, finished_at = ?, spill = ? WHERE id = ? AND status = 'running'", status, exitCode, now, spill, id)
    if (cursor.rowsWritten !== 1) return false
    this.sql.exec("DELETE FROM job WHERE status <> 'running' AND id NOT IN (SELECT id FROM job WHERE status <> 'running' ORDER BY started_at DESC LIMIT 50)")
    return true
  }

  /** The job went on past the foreground wait or was started in the background: its end wakes the Robot. */
  promoteJob(id: JobId): void {
    this.sql.exec('UPDATE job SET foreground = 0 WHERE id = ?', id)
  }

  setJobOffsets(id: JobId, outOffset: number, errOffset: number): void {
    this.sql.exec('UPDATE job SET out_offset = ?, err_offset = ? WHERE id = ?', outOffset, errOffset, id)
  }

  closeProposal(id: string, now: number): void {
    this.sql.exec("UPDATE proposal SET status = 'done', answered_at = ? WHERE id = ? AND status = 'open'", now, id)
  }

  // ------------------------------------------------------------ Threads (v1.9)

  threads(): ThreadCopy[] {
    return this.sql.exec<{ view: string; window_count: number }>('SELECT view, window_count FROM thread ORDER BY created_at DESC').toArray()
      .map((row) => ({ view: JSON.parse(row.view) as ThreadView, windowCount: row.window_count }))
      .sort((a, b) => b.view.lastActivityAt - a.view.lastActivityAt)
  }

  thread(id: string): ThreadCopy | undefined {
    const row = this.sql.exec<{ view: string; window_count: number }>('SELECT view, window_count FROM thread WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : { view: JSON.parse(row.view) as ThreadView, windowCount: row.window_count }
  }

  /** Take the state the Home sent; the message count only grows, and the pause window is this chief's own. */
  saveThread(view: ThreadView, now: number): ThreadCopy {
    const known = this.thread(view.id)
    const next: ThreadView = known === undefined ? view : { ...view, messageCount: Math.max(view.messageCount, known.view.messageCount) }
    this.sql.exec(
      'INSERT INTO thread (id, view, window_count, created_at) VALUES (?, ?, 0, ?) ON CONFLICT (id) DO UPDATE SET view = excluded.view',
      view.id, JSON.stringify(next), now,
    )
    return this.thread(view.id)!
  }

  /** A message went out or came in: both count towards the pause. */
  threadMessage(id: string, now: number): ThreadCopy | undefined {
    const known = this.thread(id)
    if (known === undefined) return undefined
    const view: ThreadView = { ...known.view, messageCount: known.view.messageCount + 1, lastActivityAt: now }
    this.sql.exec('UPDATE thread SET view = ?, window_count = window_count + 1 WHERE id = ?', JSON.stringify(view), id)
    return this.thread(id)
  }

  resetThreadWindow(id: string): void {
    this.sql.exec('UPDATE thread SET window_count = 0 WHERE id = ?', id)
  }

  // ------------------------------------------------------------ wake-ups and the active turn

  enqueue(kind: WakeupKind, sender: Sender, text: string, payload: Record<string, unknown>, now: number, delivery: Delivery = 'followup'): number {
    this.sql.exec(
      'INSERT INTO wakeup (kind, sender, text, payload, created_at, delivery) VALUES (?, ?, ?, ?, ?, ?)',
      kind, JSON.stringify(sender), text, JSON.stringify(payload), now, delivery,
    )
    return this.sql.exec<{ id: number }>('SELECT last_insert_rowid() AS id').one().id
  }

  /**
   * The Wake-up that starts the next Turn: the oldest, except that a hand-back after a Takeover goes first, so
   * steers queued during the wait reach the Turn that resumes the work (ao-zk5r).
   */
  nextWakeup(): Wakeup | undefined {
    const row = this.sql.exec<WakeupSql>("SELECT * FROM wakeup ORDER BY kind = 'takeover' DESC, id LIMIT 1").toArray()[0]
    return row === undefined ? undefined : wakeupFromSql(row)
  }

  /** Every queued Wake-up, oldest first. */
  queuedWakeups(): Wakeup[] {
    return this.sql.exec<WakeupSql>('SELECT * FROM wakeup ORDER BY id').toArray().map(wakeupFromSql)
  }

  /** Queued Wake-ups that became part of a running Turn (a steer handed over, follow-ups joined) leave the queue. */
  consumeWakeups(ids: readonly number[]): void {
    for (const id of ids) this.sql.exec('DELETE FROM wakeup WHERE id = ?', id)
  }

  wakeup(id: number): Wakeup | undefined {
    const row = this.sql.exec<WakeupSql>('SELECT * FROM wakeup WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : wakeupFromSql(row)
  }

  /** Whether a Wake-up of this Task is queued or its Turn is running. */
  taskQueued(taskId: string): boolean {
    return this.sql.exec("SELECT 1 FROM wakeup WHERE kind = 'task' AND json_extract(payload, '$.taskId') = ?", taskId).toArray().length > 0
  }

  pendingWakeups(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM wakeup').one().n
  }

  activeTurn(): ActiveTurn | undefined {
    const row = this.sql.exec<{ wakeup_id: number; started_at: number; session_id: string; start_seq: number; task_id: string | null; task_title: string | null; attempt_id: number | null }>(
      "SELECT wakeup_id, started_at, session_id, start_seq, task_id, task_title, attempt_id FROM turn WHERE k = 'active'",
    ).toArray()[0]
    if (row === undefined) return undefined
    const task = row.task_id === null || row.attempt_id === null ? null : { id: row.task_id, title: row.task_title ?? '', attemptId: row.attempt_id }
    return { wakeupId: row.wakeup_id, startedAt: row.started_at, sessionId: row.session_id, startSeq: row.start_seq, task }
  }

  /** The running Turn works on this Task from now on (mc-w3cc), or on none (ao-lj6z). @returns false when no Turn runs. */
  setTurnTask(task: { readonly id: string; readonly title: string; readonly attemptId: number } | null): boolean {
    return this.sql.exec("UPDATE turn SET task_id = ?, task_title = ?, attempt_id = ? WHERE k = 'active'", task?.id ?? null, task?.title ?? null, task?.attemptId ?? null).rowsWritten === 1
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

  addNotice(sessionId: string, afterSeq: number, text: string, now: number, card?: NoticeCard): NoticeRow {
    const notice = { id: `n-${crypto.randomUUID()}`, sessionId, afterSeq, at: now, text, ...(card === undefined ? {} : { card }) }
    this.sql.exec('INSERT INTO notice (id, session_id, after_seq, at, text, card) VALUES (?, ?, ?, ?, ?, ?)', notice.id, sessionId, afterSeq, now, text, card === undefined ? null : JSON.stringify(card))
    return notice
  }

  notices(sessionId: string): NoticeRow[] {
    return this.sql.exec<{ id: string; session_id: string; after_seq: number; at: number; text: string; card: string | null }>(
      'SELECT * FROM notice WHERE session_id = ? ORDER BY after_seq, at', sessionId,
    ).toArray().map((row) => ({ id: row.id, sessionId: row.session_id, afterSeq: row.after_seq, at: row.at, text: row.text, ...(row.card === null ? {} : { card: JSON.parse(row.card) as NoticeCard }) }))
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

  addUsage(month: string, source: UsageSource, inputTokens: number, outputTokens: number, costUsd: number): void {
    this.sql.exec(
      `INSERT INTO usage (month, source, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (month, source) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd`,
      month, source, inputTokens, outputTokens, costUsd,
    )
  }

  /** A month's cost by source (ao-zbld); its total is what the spend limit counts (ao-nkkb). */
  costBreakdown(month: string): CostBreakdown {
    return costBreakdown(this.sql.exec<{ source: UsageSource; cost_usd: number }>('SELECT source, cost_usd FROM usage WHERE month = ?', month).toArray().map((row) => ({ source: row.source, costUsd: row.cost_usd })))
  }

  addBrowserUsage(month: string, backend: string, ms: number, costUsd: number): void {
    this.sql.exec(
      'INSERT INTO browser_usage (month, backend, ms, cost_usd) VALUES (?, ?, ?, ?) ON CONFLICT (month, backend) DO UPDATE SET ms = ms + excluded.ms, cost_usd = cost_usd + excluded.cost_usd',
      month, backend, Math.max(0, Math.round(ms)), costUsd,
    )
  }

  addBoxUsage(month: string, ms: number, costUsd: number): void {
    this.sql.exec('INSERT INTO box_usage (month, ms, cost_usd) VALUES (?, ?, ?) ON CONFLICT (month) DO UPDATE SET ms = ms + excluded.ms, cost_usd = cost_usd + excluded.cost_usd', month, Math.max(0, Math.round(ms)), costUsd)
  }

  boxUsage(month: string): { ms: number; costUsd: number } {
    const row = this.sql.exec<{ ms: number; cost_usd: number }>('SELECT ms, cost_usd FROM box_usage WHERE month = ?', month).toArray()[0]
    return { ms: row?.ms ?? 0, costUsd: row?.cost_usd ?? 0 }
  }

  addServiceUsage(month: string, service: string, calls: number, costUsd: number): void {
    this.sql.exec('INSERT INTO service_usage (month, service, calls, cost_usd) VALUES (?, ?, ?, ?) ON CONFLICT (month, service) DO UPDATE SET calls = calls + excluded.calls, cost_usd = cost_usd + excluded.cost_usd', month, service, calls, costUsd)
  }

  serviceUsage(month: string): Array<{ service: string; calls: number; costUsd: number }> {
    return this.sql.exec<{ service: string; calls: number; cost_usd: number }>('SELECT service, calls, cost_usd FROM service_usage WHERE month = ? ORDER BY service', month).toArray().map((row) => ({ service: row.service, calls: row.calls, costUsd: row.cost_usd }))
  }

  browserUsage(month: string): Array<{ backend: string; ms: number; costUsd: number }> {
    return this.sql.exec<{ backend: string; ms: number; cost_usd: number }>('SELECT backend, ms, cost_usd FROM browser_usage WHERE month = ? ORDER BY backend', month).toArray()
      .map((row) => ({ backend: row.backend, ms: row.ms, costUsd: row.cost_usd }))
  }

  usage(month: string): { inputTokens: number; outputTokens: number; costUsd: number } {
    const row = this.sql.exec<{ input_tokens: number | null; output_tokens: number | null; cost_usd: number | null }>('SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd FROM usage WHERE month = ?', month).one()
    return { inputTokens: row.input_tokens ?? 0, outputTokens: row.output_tokens ?? 0, costUsd: row.cost_usd ?? 0 }
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

function reviewOf(payload: Record<string, unknown>): { review: ReviewView } | Record<string, never> {
  const review = payload['review'] as { title: string; items: ReviewView['items'] } | undefined
  if (review === undefined) return {}
  const decision = payload['decision'] as ReviewView['decision'] | undefined
  return { review: { ...review, ...(decision === undefined ? {} : { decision }) } }
}

function threadOf(payload: Record<string, unknown>): { thread: ThreadAsk } | Record<string, never> {
  const thread = payload['thread'] as Omit<ThreadAsk, 'scope'> & { scope: string } | undefined
  if (thread === undefined) return {}
  // The scope the owner answered with replaces the one proposed.
  return { thread: { ...thread, scope: typeof payload['scope'] === 'string' ? payload['scope'] : thread.scope } }
}

function helpOf(payload: Record<string, unknown>): { help: HelpAsk } | Record<string, never> {
  const help = payload['help'] as Omit<HelpAsk, 'answeredBy' | 'answer' | 'escalated' | 'override'> | undefined
  if (help === undefined) return {}
  const answer = payload['answer'] as { by: 'owner' | 'mr-robot'; text: string } | undefined
  const override = payload['override'] as { text: string } | undefined
  return { help: { ...help, answeredBy: answer?.by ?? 'none', answer: answer?.text ?? null, escalated: typeof payload['escalatedAt'] === 'number', override: override?.text ?? null } }
}

/** A stored tool call (the exact arguments) as the owner reads it: one line per argument. */
export interface StoredToolCall {
  readonly robot: string
  readonly tool: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly reason: string
  /** The Hosts the call's places resolved to when it was asked, by id in the order it names them (deep review P14); none when it names none. */
  readonly hosts: readonly string[]
}

export function storedToolCall(payload: Record<string, unknown>): StoredToolCall | undefined {
  const call = payload['toolCall'] as Omit<StoredToolCall, 'hosts'> & { readonly hosts?: unknown } | undefined
  if (call === undefined || typeof call.tool !== 'string') return undefined
  // An Ask stored without its Hosts pins none: a replay that names a Host is then refused, never sent to whichever Host has the name now.
  const hosts = Array.isArray(call.hosts) ? call.hosts.filter((host): host is string => typeof host === 'string') : []
  return { ...call, hosts }
}

function toolCallOf(payload: Record<string, unknown>): { toolCall: ToolCallAsk } | Record<string, never> {
  const call = storedToolCall(payload)
  if (call === undefined) return {}
  const note = payload['note']
  return {
    toolCall: {
      robot: call.robot,
      tool: call.tool,
      arguments: Object.entries(call.arguments).map(([name, value]) => ({ name, value: typeof value === 'string' ? value : JSON.stringify(value) ?? 'null' })),
      reason: call.reason,
      note: typeof note === 'string' && note.trim() !== '' ? note : null,
    },
  }
}

function questionOf(payload: Record<string, unknown>): { question: QuestionAsk } | Record<string, never> {
  const question = payload['question'] as Omit<QuestionAsk, 'answer'> | undefined
  if (question === undefined) return {}
  return { question: { ...question, answer: (payload['questionAnswer'] as QuestionAsk['answer'] | undefined) ?? null } }
}

function credentialOf(payload: Record<string, unknown>): { credential: CredentialAsk } | Record<string, never> {
  const credential = payload['credential'] as Omit<CredentialAsk, 'entry' | 'declined'> | undefined
  if (credential === undefined) return {}
  return { credential: { ...credential, entry: typeof payload['credentialEntry'] === 'string' ? payload['credentialEntry'] : null, declined: payload['credentialDeclined'] === true } }
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
    grants: payload['grants'] === undefined ? null : parseGrantSet(payload['grants']),
    file: (payload['file'] as ProposalView['file'] | undefined) ?? null,
    skill: (payload['skill'] as ProposalView['skill'] | undefined) ?? null,
    ...reviewOf(payload),
    ...threadOf(payload),
    ...helpOf(payload),
    ...toolCallOf(payload),
    ...questionOf(payload),
    ...credentialOf(payload),
    ...(payload['requiresHosts'] === true ? { requiresHosts: true } : {}),
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  }
}

type WakeupSql = {
  id: number
  /** 'routine' for a Wake-up queued before v1.13. */
  kind: WakeupKind | 'routine'
  sender: string
  text: string
  payload: string
  created_at: number
  delivery: Delivery
}

function wakeupFromSql(row: WakeupSql): Wakeup {
  return legacyWakeup<Wakeup>({
    id: row.id,
    kind: row.kind as WakeupKind,
    sender: JSON.parse(row.sender) as Sender,
    delivery: row.delivery ?? 'followup',
    text: row.text,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
  })
}