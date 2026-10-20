import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { Robot as ProductionRobot } from '../src/robot/robot.ts'
import type { ProviderCredential, ProviderId } from '../src/agent/providers.ts'
import { scriptedProviders, StubLlm } from './stub-llm.ts'
import { StubDriver } from './stub-browser.ts'
import { StubBox } from './stub-box.ts'
import { QUIET_DUE } from '../src/robot/programs.ts'
import type { BoxBackend } from '../src/box/backend.ts'
import { FakeChannel } from './fake-channel.ts'
import { fakeConnectors, fakeService } from './fake-connector.ts'
import { connectorFixtures } from './connector-fixtures.ts'
import type { ChannelAdapter, InboundEvent } from '../src/channels/channel.ts'
import type { BrowserDriver, BrowserState } from '../src/browser/driver.ts'
import type { BrowserBackend } from '@mr-robot/protocol'

import { Member as ProductionMember } from '../src/member/member.ts'
import { makeVault } from '../src/platform/vault.ts'
import * as Effect from 'effect/Effect'
import { ConversationIndex } from '../src/agent/conversation-search.ts'
import type { PushNotification } from '../src/platform/push.ts'

export const delivered = new Map<string, PushNotification[]>()

export { default } from '../src/index.ts'
import { Home as ProductionHome } from '../src/index.ts'

/** The production Home with recorded HTTP for Discord. */
export class Home extends ProductionHome {
  /** Every Thread's last message moves into the past by `ms`, and the alarm is due now. */
  async backdateThreadsForTest(ms: number): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE thread SET last_activity_at = last_activity_at - ?', ms)
    await this.ctx.storage.setAlarm(Date.now() + 1)
  }

  async alarmForTest(): Promise<number | null> {
    return this.ctx.storage.getAlarm()
  }

  /** The Robot's Routines are not Tasks yet, as for every Robot registered before v1.13. */
  async unmigrateForTest(robotId: string): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE robot SET routines_migrated = 0 WHERE id = ?', robotId)
  }

  /** Pretend the platform was down for `ms`: every Task's moment moves into the past, and the Robots and the alarm hear it. */
  async backdateTasksForTest(ms: number): Promise<void> {
    const sql = this.ctx.storage.sql
    sql.exec("UPDATE task SET wake_at = wake_at - ?, timing = CASE json_extract(timing, '$.kind') WHEN 'recurring' THEN json_set(timing, '$.next', json_extract(timing, '$.next') - ?) WHEN 'scheduled' THEN json_set(timing, '$.at', json_extract(timing, '$.at') - ?) ELSE timing END WHERE wake_at IS NOT NULL", ms, ms, ms)
    const robots = sql.exec<{ id: string }>("SELECT DISTINCT assignee_id AS id FROM task WHERE assignee_kind = 'robot'").toArray()
    for (const { id } of robots) {
      const at = sql.exec<{ at: number | null }>("SELECT MIN(wake_at) AS at FROM task WHERE assignee_kind = 'robot' AND assignee_id = ? AND state = 'open'", id).one().at
      await this.env.ROBOT.getByName(id).setNextDue(at)
    }
    await this.ctx.storage.setAlarm(Date.now() + 1)
  }

  /** The spend limits as stored before v1.12 (a number of USD or null), migrated as at start (ux-ommv). */
  async legacySpendLimitsForTest(robot: number | null, member: number | null): Promise<void> {
    const sql = this.ctx.storage.sql
    sql.exec("DELETE FROM setting WHERE k IN ('robotSpendLimit', 'memberSpendLimit')")
    sql.exec("INSERT INTO setting (k, v) VALUES ('robotSpendLimitUsd', ?), ('memberSpendLimitUsd', ?)", JSON.stringify(robot), JSON.stringify(member))
    this.migrateSpendLimits()
  }

  protected override connectorFetch(): typeof globalThis.fetch {
    return connectorFixtures.fetch
  }
}

/** The production Member with a clock hook for OAuth expiry. */
export class Member extends ProductionMember {
  protected override connectorFetch(): typeof globalThis.fetch {
    return connectorFixtures.fetch
  }

  /** Every connection's access token is past its expiry. */
  async expireConnectionsForTest(): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE connection SET meta = json_set(meta, '$.expiresAt', 0)")
  }

  async expireCredentialsForTest(): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE account SET expires = 0')
  }

  /** Every notification delivered to devices, in order. */
  async deliveredForTest(): Promise<PushNotification[]> {
    return delivered.get((await this.profile()).id) ?? []
  }

  protected override async deliver(notification: PushNotification): Promise<void> {
    const id = (await this.profile()).id
    const list = delivered.get(id) ?? []
    list.push(notification)
    delivered.set(id, list)
    await super.deliver(notification)
  }

  async endQuietHoursForTest(): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE pending_notification SET deliver_at = 0')
  }

  async sealedForTest(provider: string): Promise<string> {
    return this.ctx.storage.sql.exec<{ sealed: string }>('SELECT sealed FROM account WHERE provider = ? ORDER BY created_at LIMIT 1', provider).one().sealed
  }

  /** Every limited or broken account is past its retry time. */
  async expireAccountStatesForTest(): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE account SET until = 1 WHERE until IS NOT NULL')
  }

  /** A credential or OpenCode pool as stored before accounts existed (pa-mdlk). */
  async seedLegacyForTest(provider: string, kind: 'api-key' | 'oauth', data: unknown, shared: boolean): Promise<void> {
    const sealed = await Effect.runPromise(makeVault(this.env.DATA_KEY, 'credentials').seal(JSON.stringify(data)))
    this.ctx.storage.sql.exec('INSERT INTO credential (provider, kind, sealed, shared, expires, updated_at) VALUES (?, ?, ?, ?, NULL, ?)', provider, kind, sealed, shared ? 1 : 0, Date.now())
    this.ctx.storage.sql.exec("DELETE FROM kv WHERE k = 'accounts-migrated'")
  }
}

/** The production Robot with the scripted stub model on the "stub" Provider. */
export class Robot extends ProductionRobot {
  /** Fake connectors set by a test replace the real ones; their HTTP is the recorded fake service. */
  protected override connectorPlugins() {
    return fakeConnectors.size === 0 ? super.connectorPlugins() : Object.fromEntries(fakeConnectors)
  }

  protected override connectorFetch(): typeof globalThis.fetch {
    return fakeConnectors.size === 0 ? connectorFixtures.fetch : fakeService
  }

  protected override adapter(provider: string, contextWindow?: number, model?: string, wire?: 'chat' | 'anthropic' | 'responses'): LlmAdapter {
    return scriptedProviders.has(provider) ? new StubLlm(this.store.requireConfig().id) : super.adapter(provider, contextWindow, model, wire)
  }

  /** The credential this Robot's Turns would use for a Provider. */
  async credentialForTest(provider: ProviderId): Promise<ProviderCredential | null> {
    return (await this.credentials().resolve(provider)) ?? null
  }

  protected override channels(): Map<string, ChannelAdapter> {
    const channels = super.channels()
    channels.set('fake', new FakeChannel())
    return channels
  }

  /** Channel events as the edge would deliver them. */
  override async channelEvent(event: InboundEvent): Promise<{ accepted: boolean }> {
    return super.channelEvent(event)
  }

  protected override browserDriver(backend: BrowserBackend): BrowserDriver {
    return new StubDriver(backend)
  }

  protected override boxBackend(): BoxBackend {
    return new StubBox(this.store.requireConfig().id)
  }

  /** The Robot as a v1.14 deploy left it: a computer grant, its running time, cost rows, state and folder name (v1.15 ticket 06). */
  async legacyComputerForTest(): Promise<void> {
    const sql = this.store.sql
    sql.exec("DELETE FROM grant_item WHERE kind = 'tool' AND name = 'box'")
    sql.exec("INSERT INTO grant_item (kind, name, level) VALUES ('tool', 'computer', 'allow')")
    sql.exec('DROP TABLE IF EXISTS computer_usage')
    sql.exec('CREATE TABLE computer_usage (month TEXT PRIMARY KEY, ms INTEGER NOT NULL, cost_usd REAL NOT NULL) WITHOUT ROWID')
    sql.exec("INSERT INTO computer_usage (month, ms, cost_usd) VALUES ('2026-09', 60000, 0.5)")
    sql.exec("INSERT INTO usage (month, source, input_tokens, output_tokens, cost_usd) VALUES ('2026-09', 'computer', 0, 0, 0.5)")
    sql.exec("DELETE FROM kv WHERE k = 'box-folder-moved'")
    sql.exec("INSERT INTO kv (k, v) VALUES ('computer', ?)", JSON.stringify({ state: 'off' }))
    sql.exec('UPDATE schema_version SET version = 16')
    this.store.prepare()
    this.store.updateConfig(() => ({}))
  }

  /** The Box's cost rows and running time per month, as stored (v1.15 ticket 06). */
  async boxRowsForTest(): Promise<{ usage: Array<{ month: string; source: string; costUsd: number }>; running: Array<{ month: string; ms: number }>; oldTable: boolean; grants: string[] }> {
    const sql = this.store.sql
    return {
      usage: sql.exec<{ month: string; source: string; cost_usd: number }>("SELECT month, source, cost_usd FROM usage WHERE source IN ('box', 'computer') ORDER BY month").toArray().map((row) => ({ month: row.month, source: row.source, costUsd: row.cost_usd })),
      running: sql.exec<{ month: string; ms: number }>('SELECT month, ms FROM box_usage ORDER BY month').toArray(),
      oldTable: sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'computer_usage'").toArray().length > 0,
      grants: sql.exec<{ name: string }>("SELECT name FROM grant_item WHERE kind = 'tool' ORDER BY name").toArray().map((row) => row.name),
    }
  }

  /** The upgrade to v1.15 as a Robot with a Conversation already in its log sees it (gb-psyl): the markers are written again. */
  async upgradeVoiceForTest(): Promise<void> {
    this.store.sql.exec("DELETE FROM kv WHERE k = 'voice-upgraded' OR k LIKE 'voice-from:%'")
    this.markVoiceUpgrade()
    // v1.14 had indexed that assistant text as replies: the index is read again under the new marker.
    this.store.search.clear()
  }

  /** The moment an owner Turn that said nothing gets its steer is now (gb-0skq); false when no such moment is kept. */
  async quietDueForTest(): Promise<boolean> {
    const due = this.store.get<{ wakeupId: number; at: number }>(QUIET_DUE)
    if (due === undefined) return false
    this.store.set(QUIET_DUE, { ...due, at: Date.now() - 1 })
    await this.ctx.storage.setAlarm(Date.now() + 1)
    return true
  }

  /** The Robot as a v1.14 deploy left it: no chief recipient Grant and no messaging group, the schema before them (v1.15 ticket 04). */
  async withoutChiefGrantForTest(): Promise<void> {
    this.store.sql.exec("DELETE FROM grant_item WHERE (kind = 'recipient' AND name LIKE 'mr-robot-%') OR (kind = 'tool' AND name = 'messaging')")
    this.store.sql.exec('UPDATE schema_version SET version = 17')
    this.store.prepare()
  }

  /** The Box's last command was `ms` ago, and the alarm is due. */
  async backdateBoxForTest(ms: number): Promise<void> {
    const state = this.store.get<{ state: string; since?: number; lastCommandAt?: number }>('box')
    if (state?.lastCommandAt !== undefined) this.store.set('box', { ...state, since: state.since! - ms, lastCommandAt: state.lastCommandAt - ms })
    await this.ctx.storage.setAlarm(Date.now() + 1)
  }

  /** Skip the setup interview: the Robot becomes active with its current Grants. */
  /** The chain's resume time came (as the alarm sees it). */
  async resumeChainDueForTest(): Promise<number | null> {
    const at = this.store.get<number>('chain-resume-at') ?? null
    if (at !== null) this.store.set('chain-resume-at', 1)
    return at
  }

  /** The config as stored before v1.12 (spendLimitUsd: a number of USD or null), migrated as at start (ux-ommv). */
  async legacySpendLimitForTest(spendLimitUsd: number | null): Promise<void> {
    const { spendLimit: _, ...config } = this.store.requireConfig()
    this.store.sql.exec("UPDATE robot SET v = ? WHERE k = 'config'", JSON.stringify({ ...config, spendLimitUsd }))
    this.store.sql.exec('UPDATE schema_version SET version = 8')
    this.store.prepare()
  }

  /** The config exactly as stored. */
  async storedConfigForTest(): Promise<Record<string, unknown>> {
    return JSON.parse(this.store.sql.exec<{ v: string }>("SELECT v FROM robot WHERE k = 'config'").one().v) as Record<string, unknown>
  }

  async activateForTest(): Promise<void> {
    this.store.updateConfig(() => ({ status: 'active' }))
    await this.changed()
  }

  /**
   * The Robot as it was before v1.13 (ticket 05): Routine tables with these rows and runs, as the old migrations
   * left them, so the Home's migration finds something to take.
   */
  async seedRoutinesForTest(routines: ReadonlyArray<{ id: string; name: string; prompt: string; record: Record<string, unknown>; nextRun: number | null; paused?: boolean; runs: ReadonlyArray<{ startedAt: number; outcome: string; firstLine: string }> }>): Promise<void> {
    const sql = this.store.sql
    sql.exec('CREATE TABLE IF NOT EXISTS routine (id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, schedule TEXT NOT NULL, time_zone TEXT NOT NULL, next_run INTEGER, last_run INTEGER, created_at INTEGER NOT NULL, paused INTEGER NOT NULL DEFAULT 0, record TEXT, session_id TEXT)')
    sql.exec('CREATE TABLE IF NOT EXISTS routine_run (id INTEGER PRIMARY KEY AUTOINCREMENT, wakeup_id INTEGER, routine_id TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT NOT NULL, first_line TEXT NOT NULL)')
    for (const routine of routines) {
      sql.exec('INSERT INTO routine (id, name, prompt, schedule, time_zone, next_run, last_run, created_at, paused, record, session_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
        routine.id, routine.name, routine.prompt, JSON.stringify({ kind: 'daily', time: '09:00' }), 'Europe/Warsaw', routine.nextRun, Date.now() - 86_400_000, routine.paused === true ? 1 : 0, JSON.stringify(routine.record), 's-old')
      for (const run of routine.runs) sql.exec('INSERT INTO routine_run (wakeup_id, routine_id, started_at, finished_at, outcome, first_line) VALUES (NULL, ?, ?, ?, ?, ?)', routine.id, run.startedAt, run.startedAt + 1000, run.outcome, run.firstLine)
    }
  }

  /** A Routine card notice and a queued Routine Wake-up, as a Robot before v1.13 stored them (mc-c2bb). */
  async seedRoutineItemsForTest(routineId: string, name: string): Promise<void> {
    const config = this.store.requireConfig()
    this.store.sql.exec('INSERT INTO notice (id, session_id, after_seq, at, text, card) VALUES (?, ?, ?, ?, ?, ?)', 'n-old', config.liveSessionId, 0, Date.now(), `Routine created by Mr. Robot: ${name}`, JSON.stringify({ kind: 'routine', action: 'created', name, by: 'Mr. Robot' }))
    this.store.sql.exec('INSERT INTO wakeup (kind, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?)', 'routine', JSON.stringify({ kind: 'routine', routineId, name }), 'Do the old thing.', JSON.stringify({ routineId, due: Date.now(), attachments: [] }), Date.now())
  }

  /** Whether the Routine tables are still there. */
  async hasRoutineTablesForTest(): Promise<boolean> {
    return this.store.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN ('routine', 'routine_run')").toArray().length > 0
  }


  /** A help Ask as v1.14 left it open (need_help is gone; the owner's answer path stays until it is closed). */
  helpFromBeforeForTest(need: string): string {
    return this.propose('help', need, { help: { doing: 'Filing the VAT return', tried: 'Looked in my notes', need, urgent: false, created: Date.now() } }).id
  }

  /** Put a message in the outbox without delivering it (as if the DO died right after writing). */
  async outboxOnlyForTest(to: string, text: string, key: string): Promise<string> {
    const config = this.store.requireConfig()
    const id = `msg-test-${key}`
    this.store.sql.exec(
      "INSERT INTO outbox (id, recipient, payload, status, attempts, next_attempt, created_at) VALUES (?, ?, ?, 'pending', 0, 0, ?)",
      id, to, JSON.stringify({ id, kind: 'request', from: { robotId: config.id, ownerId: config.ownerId, name: config.identity.name, avatarColor: config.identity.avatarColor }, text, requestId: id, chain: { id: 'c', hops: 1 } }), Date.now(),
    )
    await this.ctx.storage.setAlarm(Date.now() + 60_000)
    return id
  }

  /** As before the migration ran: the memory/bank clean-up has not been done. */
  async forgetBankMigrationForTest(): Promise<void> {
    this.store.delete('bank-retired')
  }

  async fileForTest(path: string): Promise<string | null> {
    return (await this.run(this.workspace.readText(path))) ?? null
  }

  /** Every stored Subagent's status (v1.14 ticket 06). */
  async subagentStatusesForTest(): Promise<string[]> {
    return this.store.sql.exec<{ status: string }>("SELECT status FROM subagent").toArray().map((row) => row.status)
  }

  /** The idle moments planned after the last Turn (v1.14 ticket 09). */
  async idlePlanForTest(): Promise<Array<{ at: number; action: string }>> {
    return this.store.get<Array<{ at: number; action: string }>>('idle-plan') ?? []
  }

  /** The next idle moment is now, and the alarm with it. */
  async idleDueForTest(): Promise<void> {
    const plan = this.store.get<Array<{ at: number; action: string }>>('idle-plan') ?? []
    if (plan.length > 0) this.store.set('idle-plan', [{ ...plan[0]!, at: Date.now() - 1 }, ...plan.slice(1)])
    await this.ctx.storage.setAlarm(Date.now() + 60_000)
  }

  /** The screenshot sweep is due now (and the alarm with it). */
  async sweepDueForTest(): Promise<void> {
    this.store.set('screens-sweep-next', 1)
    await this.ctx.storage.setAlarm(Date.now() + 1)
  }

  /** The spill tidy pass as the start of a Turn runs it, at a moment the test picks; the daily throttle is reset first. */
  async tidySpillForTest(now: number): Promise<void> {
    this.store.delete('spill-sweep-next')
    await this.tidySpill(now)
  }

  /** When the next screenshot sweep is due; null when none is planned. */
  async sweepNextForTest(): Promise<number | null> {
    return this.store.get<number>('screens-sweep-next') ?? null
  }

  /** A PNG screenshot (stored outside the Workspace), as a Turn with the browser leaves one; its name. */
  async saveScreenForTest(): Promise<string> {
    return (await this.saveScreen(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 5, 0, 0, 0, 3, 32, 0, 255]))).name
  }

  async outboxForTest(): Promise<Array<{ id: string; status: string }>> {
    return this.store.sql.exec<{ id: string; status: string }>('SELECT id, status FROM outbox').toArray()
  }

  /** Make the screen watch due now. */
  async watchDueForTest(): Promise<void> {
    this.store.set('watch-next', Date.now() - 1)
    await this.ctx.storage.setAlarm(Date.now() + 60_000)
  }

  async alarmForTest(): Promise<number | null> {
    return this.ctx.storage.getAlarm()
  }

  /** The cookies and storage the Robot keeps for its next browser session. */
  async browserStateForTest(): Promise<BrowserState | null> {
    return this.store.get<BrowserState>('browser-state') ?? null
  }

  async browserOpenForTest(): Promise<boolean> {
    return this.store.get('browser-session') !== undefined
  }

  /** The open browser session started `ms` earlier, as if the Turn had used it that long. */
  async backdateBrowserForTest(ms: number): Promise<void> {
    const session = this.store.get<{ since: number }>('browser-session')
    if (session !== undefined) this.store.set('browser-session', { ...session, since: session.since - ms })
  }

  async seedBrowserStateForTest(state: BrowserState): Promise<void> {
    this.store.set('browser-state', state)
  }

  /** The sign-in under Takeover is past its ten minutes (v1.12 ticket 11), and the alarm with it. */
  async signInDueForTest(): Promise<void> {
    const takeover = this.store.get<{ capture?: { deadline: number } }>('takeover')
    if (takeover?.capture !== undefined) this.store.set('takeover', { ...takeover, capture: { ...takeover.capture, deadline: Date.now() - 1 } })
    await this.ctx.storage.setAlarm(Date.now() + 60_000)
  }

  /** How this runtime searches the Conversation. */
  async searchModeForTest(): Promise<'fts5' | 'like'> {
    return this.store.search.mode
  }

  /** Search with the LIKE fallback from now on, as a runtime without FTS5 would; the index is rebuilt at the next search. */
  async searchWithoutFullTextForTest(): Promise<'fts5' | 'like'> {
    this.store.sql.exec('DROP TABLE chat_search')
    this.store.sql.exec('DELETE FROM chat_search_state')
    this.store.search = new ConversationIndex(this.store.sql, false)
    return this.store.search.mode
  }

  /** Put the grant table back as it was before levels (schema 7) with these rows, then open the store as after a deploy. */
  async grantsBeforeLevelsForTest(rows: Array<{ kind: string; name: string }>): Promise<void> {
    const sql = this.store.sql
    sql.exec('DROP TABLE grant_item')
    sql.exec('CREATE TABLE grant_item (kind TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (kind, name)) WITHOUT ROWID')
    for (const row of rows) sql.exec('INSERT INTO grant_item (kind, name) VALUES (?, ?)', row.kind, row.name)
    sql.exec('UPDATE schema_version SET version = 7')
    this.store.prepare()
    await this.changed()
  }
}