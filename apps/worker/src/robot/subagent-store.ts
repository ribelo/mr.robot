/**
 * The Robot's Subagents as stored (v1.14 ticket 06): one row per child session, beside the Robot's own sessions
 * in the session tables. A child is running until its report is in; a Rewind archives the ones started after its
 * cut; deleting the Robot deletes the rows with the rest of its storage.
 */
import type { ThinkingEffort } from '@mr-robot/protocol'

export type SubagentStatus = 'running' | 'done' | 'interrupted' | 'failed' | 'archived'

export interface SubagentRow {
  readonly id: string
  readonly parentSession: string
  /** Where the delegation stands in the Robot's log: a Rewind before it archives the child. */
  readonly parentSeq: number
  readonly label: string
  readonly mode: 'spawn' | 'fork'
  readonly task: string
  readonly provider: string
  readonly model: string
  readonly effort: ThinkingEffort
  readonly status: SubagentStatus
  readonly report: string | null
  readonly startedAt: number
  readonly finishedAt: number | null
  /** The child's log is billed up to here. */
  readonly accountedSeq: number
}

type Row = {
  id: string; parent_session: string; parent_seq: number; label: string; mode: 'spawn' | 'fork'; task: string; provider: string; model: string; effort: ThinkingEffort
  status: SubagentStatus; report: string | null; started_at: number; finished_at: number | null; accounted_seq: number
}

const fromSql = (row: Row): SubagentRow => ({
  id: row.id, parentSession: row.parent_session, parentSeq: row.parent_seq, label: row.label, mode: row.mode, task: row.task, provider: row.provider, model: row.model, effort: row.effort,
  status: row.status, report: row.report, startedAt: row.started_at, finishedAt: row.finished_at, accountedSeq: row.accounted_seq,
})

export class SubagentStore {
  constructor(private readonly sql: SqlStorage) {}

  add(row: Omit<SubagentRow, 'status' | 'report' | 'finishedAt' | 'accountedSeq'>): void {
    this.sql.exec(
      "INSERT INTO subagent (id, parent_session, parent_seq, label, mode, task, provider, model, effort, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)",
      row.id, row.parentSession, row.parentSeq, row.label, row.mode, row.task, row.provider, row.model, row.effort, row.startedAt,
    )
  }

  get(id: string): SubagentRow | undefined {
    const row = this.sql.exec<Row>('SELECT * FROM subagent WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : fromSql(row)
  }

  /** The children of a Robot session, newest first. */
  of(parentSession: string): SubagentRow[] {
    return this.sql.exec<Row>('SELECT * FROM subagent WHERE parent_session = ? ORDER BY started_at DESC', parentSession).toArray().map(fromSql)
  }

  /** The newest children of the Conversation's chapters, up to each one's cut (v1.19: a Subagent belongs to the chapter it ran in); a Rewind's archived ones left it. */
  ofConversation(limit: number): SubagentRow[] {
    return this.sql.exec<Row>(
      "SELECT subagent.* FROM subagent JOIN chapter ON chapter.session_id = subagent.parent_session AND chapter.superseded = 0 AND (chapter.cut IS NULL OR subagent.parent_seq <= chapter.cut) WHERE subagent.status != 'archived' ORDER BY subagent.started_at DESC LIMIT ?",
      limit,
    ).toArray().map(fromSql)
  }

  running(): SubagentRow[] {
    return this.sql.exec<Row>("SELECT * FROM subagent WHERE status = 'running' ORDER BY started_at").toArray().map(fromSql)
  }

  finish(id: string, status: Exclude<SubagentStatus, 'running'>, report: string | null, now: number): void {
    this.sql.exec("UPDATE subagent SET status = ?, report = ?, finished_at = ? WHERE id = ? AND status = 'running'", status, report, now, id)
  }

  /** A Rewind to before these delegations: their children leave the live view with the old log. */
  archiveAfter(parentSession: string, atSeq: number, now: number): string[] {
    const ids = this.sql.exec<{ id: string }>('SELECT id FROM subagent WHERE parent_session = ? AND parent_seq >= ? AND status != \'archived\'', parentSession, atSeq).toArray().map((row) => row.id)
    for (const id of ids) this.sql.exec("UPDATE subagent SET status = 'archived', finished_at = COALESCE(finished_at, ?) WHERE id = ?", now, id)
    return ids
  }

  accounted(id: string, seq: number): void {
    this.sql.exec('UPDATE subagent SET accounted_seq = ? WHERE id = ?', seq, id)
  }

  clear(): void {
    this.sql.exec('DELETE FROM subagent')
  }
}
