/**
 * The Thread registry at the Home (v1.9): the one authoritative record of each Thread between two
 * chiefs. Pure SQLite state and transitions; the Home Durable Object tells the chiefs.
 * A Thread is invited until both owners accept, then open; it ends closed or declined.
 */
import type { ThreadState } from '@mr-robot/protocol'

/** An open Thread with no message for this long is closed by the Home alarm (ch-gckb). */
export const THREAD_IDLE_MS = 7 * 24 * 60 * 60 * 1000

export type Answer = 'pending' | 'accepted' | 'declined'

export interface Side {
  readonly memberId: string
  readonly robotId: string
  /** The proposed scope until the owner answers, then the accepted one. */
  readonly scope: string
  readonly answer: Answer
}

export interface ThreadRow {
  readonly id: string
  readonly topic: string
  readonly state: ThreadState
  readonly initiator: Side
  readonly invitee: Side
  readonly messageCount: number
  readonly createdAt: number
  readonly openedAt: number | null
  readonly closedAt: number | null
  /** The robot id of the chief that closed it, 'idle', or 'declined'. */
  readonly closedBy: string | null
  readonly summary: string | null
  readonly lastActivityAt: number
}

type ThreadSql = {
  id: string; topic: string; state: ThreadState
  a_member: string; a_robot: string; a_scope: string; a_answer: Answer
  b_member: string; b_robot: string; b_scope: string; b_answer: Answer
  message_count: number; created_at: number; opened_at: number | null; closed_at: number | null
  closed_by: string | null; summary: string | null; last_activity_at: number
}

const fromSql = (row: ThreadSql): ThreadRow => ({
  id: row.id,
  topic: row.topic,
  state: row.state,
  initiator: { memberId: row.a_member, robotId: row.a_robot, scope: row.a_scope, answer: row.a_answer },
  invitee: { memberId: row.b_member, robotId: row.b_robot, scope: row.b_scope, answer: row.b_answer },
  messageCount: row.message_count,
  createdAt: row.created_at,
  openedAt: row.opened_at,
  closedAt: row.closed_at,
  closedBy: row.closed_by,
  summary: row.summary,
  lastActivityAt: row.last_activity_at,
})

/** What an answer to an invitation did to the Thread. */
export type AnswerOutcome = 'waiting' | 'opened' | 'declined'

export type MessageCheck =
  | { readonly ok: true; readonly row: ThreadRow; readonly to: string }
  | { readonly ok: false; readonly reason: string }

export class ThreadRegistry {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS thread (
      id TEXT PRIMARY KEY, topic TEXT NOT NULL, state TEXT NOT NULL,
      a_member TEXT NOT NULL, a_robot TEXT NOT NULL, a_scope TEXT NOT NULL, a_answer TEXT NOT NULL,
      b_member TEXT NOT NULL, b_robot TEXT NOT NULL, b_scope TEXT NOT NULL, b_answer TEXT NOT NULL,
      message_count INTEGER NOT NULL, created_at INTEGER NOT NULL, opened_at INTEGER, closed_at INTEGER,
      closed_by TEXT, summary TEXT, last_activity_at INTEGER NOT NULL
    )`)
  }

  get(id: string): ThreadRow | undefined {
    const row = this.sql.exec<ThreadSql>('SELECT * FROM thread WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : fromSql(row)
  }

  all(): ThreadRow[] {
    return this.sql.exec<ThreadSql>('SELECT * FROM thread ORDER BY last_activity_at DESC, created_at DESC').toArray().map(fromSql)
  }

  /** A new invitation: the initiator's scope is the one the chief proposed; it counts as answered only when the owner approves. */
  create(topic: string, initiator: { memberId: string; robotId: string; scope: string }, invitee: { memberId: string; robotId: string }, now: number): ThreadRow {
    const id = `th-${crypto.randomUUID()}`
    this.sql.exec(
      `INSERT INTO thread (id, topic, state, a_member, a_robot, a_scope, a_answer, b_member, b_robot, b_scope, b_answer, message_count, created_at, last_activity_at)
       VALUES (?, ?, 'invited', ?, ?, ?, 'pending', ?, ?, '', 'pending', 0, ?, ?)`,
      id, topic, initiator.memberId, initiator.robotId, initiator.scope, invitee.memberId, invitee.robotId, now, now,
    )
    return this.get(id)!
  }

  /** An owner answers the invitation with the scope they approved; the Thread opens with the second acceptance and ends with a decline. */
  answer(id: string, robotId: string, accepted: boolean, scope: string, now: number): { row: ThreadRow; outcome: AnswerOutcome } | { error: string } {
    const row = this.get(id)
    if (row === undefined) return { error: 'no such Thread' }
    const side = row.initiator.robotId === robotId ? 'a' : row.invitee.robotId === robotId ? 'b' : undefined
    if (side === undefined) return { error: 'you are not part of this Thread' }
    if (row.state !== 'invited') return { error: `this Thread is already ${row.state}` }
    const mine = side === 'a' ? row.initiator : row.invitee
    if (mine.answer !== 'pending') return { error: 'this invitation was already answered' }
    const answer: Answer = accepted ? 'accepted' : 'declined'
    this.sql.exec(`UPDATE thread SET ${side}_answer = ?, ${side}_scope = ? WHERE id = ?`, answer, accepted ? scope : mine.scope, id)
    if (!accepted) {
      this.sql.exec("UPDATE thread SET state = 'declined', closed_at = ?, closed_by = 'declined' WHERE id = ?", now, id)
      return { row: this.get(id)!, outcome: 'declined' }
    }
    const after = this.get(id)!
    if (after.initiator.answer === 'accepted' && after.invitee.answer === 'accepted') {
      this.sql.exec("UPDATE thread SET state = 'open', opened_at = ?, last_activity_at = ? WHERE id = ?", now, now, id)
      return { row: this.get(id)!, outcome: 'opened' }
    }
    return { row: after, outcome: 'waiting' }
  }

  /** A chief sends a message: only an open Thread takes one; the count and the idle clock move. */
  message(id: string, robotId: string, now: number): MessageCheck {
    const row = this.get(id)
    if (row === undefined) return { ok: false, reason: 'no such Thread' }
    if (row.initiator.robotId !== robotId && row.invitee.robotId !== robotId) return { ok: false, reason: 'you are not part of this Thread' }
    if (row.state !== 'open') return { ok: false, reason: row.state === 'invited' ? 'this Thread is not open yet: both owners must accept first' : `this Thread is ${row.state}` }
    this.sql.exec('UPDATE thread SET message_count = message_count + 1, last_activity_at = ? WHERE id = ?', now, id)
    return { ok: true, row: this.get(id)!, to: row.initiator.robotId === robotId ? row.invitee.robotId : row.initiator.robotId }
  }

  /** A chief closes an open Thread with a summary, or the alarm closes it as idle. */
  close(id: string, by: string, summary: string | null, now: number): { row: ThreadRow } | { error: string } {
    const row = this.get(id)
    if (row === undefined) return { error: 'no such Thread' }
    if (by !== 'idle' && row.initiator.robotId !== by && row.invitee.robotId !== by) return { error: 'you are not part of this Thread' }
    if (row.state !== 'open') return { error: row.state === 'invited' ? 'this Thread is not open yet: wait for the invitation to be answered' : `this Thread is already ${row.state}` }
    this.sql.exec("UPDATE thread SET state = 'closed', closed_at = ?, closed_by = ?, summary = ? WHERE id = ?", now, by, summary, id)
    return { row: this.get(id)! }
  }

  /** Open Threads whose last message is older than the idle limit. */
  idle(now: number): ThreadRow[] {
    return this.sql.exec<ThreadSql>("SELECT * FROM thread WHERE state = 'open' AND last_activity_at <= ?", now - THREAD_IDLE_MS).toArray().map(fromSql)
  }

  /** When the first open Thread turns idle; null when none is open. */
  nextIdleAt(): number | null {
    const row = this.sql.exec<{ at: number | null }>("SELECT MIN(last_activity_at) AS at FROM thread WHERE state = 'open'").one()
    return row.at === null ? null : row.at + THREAD_IDLE_MS
  }
}
