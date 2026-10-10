/**
 * The Thread registry at the Home (v1.9): the one authoritative record of each Thread between two chiefs.
 * The transitions are pure functions over a ThreadRow (a closed set: answer, message, close, lapse, abandon);
 * the registry reads a row, applies one transition and saves the result in one SQLite transaction.
 * The Home Durable Object tells the chiefs.
 */
import type { ThreadState } from '@mr-robot/protocol'

/** An open Thread with no message, or an invitation without both answers, for this long is closed by the Home alarm (ch-gckb). */
export const THREAD_IDLE_MS = 7 * 24 * 60 * 60 * 1000

export type Answer = 'pending' | 'accepted' | 'declined'

export interface Side {
  readonly memberId: string
  readonly robotId: string
  /** The proposed scope until the owner answers, then the accepted one. */
  readonly scope: string
  readonly answer: Answer
}

/** How a closed Thread ended. */
export type Ending =
  | { readonly cause: 'chief'; readonly robotId: string; readonly summary: string }
  | { readonly cause: 'idle' }
  | { readonly cause: 'expired' }
  /** The chief's Robot was deleted or its owner left the Home. */
  | { readonly cause: 'gone'; readonly robotId: string }

interface Common {
  readonly id: string
  readonly topic: string
  readonly initiator: Side
  readonly invitee: Side
  readonly messageCount: number
  readonly createdAt: number
  readonly lastActivityAt: number
}

export type ThreadRow = Common & (
  | { readonly state: 'invited' }
  | { readonly state: 'open'; readonly openedAt: number }
  | { readonly state: 'declined'; readonly closedAt: number; readonly declinedBy: string }
  | { readonly state: 'closed'; readonly openedAt: number | null; readonly closedAt: number; readonly ending: Ending }
)

/** A transition either gives the next row or says, in words for the chief, why it does not apply. */
export type Step<T = object> = ({ readonly ok: true; readonly row: ThreadRow } & T) | { readonly ok: false; readonly reason: string }

export type AnswerOutcome = 'waiting' | 'opened' | 'declined'

const refused = (reason: string) => ({ ok: false, reason }) as const

const sideOf = (row: ThreadRow, robotId: string): 'initiator' | 'invitee' | undefined =>
  row.initiator.robotId === robotId ? 'initiator' : row.invitee.robotId === robotId ? 'invitee' : undefined

// ------------------------------------------------------------------ transitions

/** A new invitation; the initiator's scope is the one its chief proposed, and counts only once the owner approves. */
export function invited(id: string, topic: string, initiator: { memberId: string; robotId: string; scope: string }, invitee: { memberId: string; robotId: string }, now: number): ThreadRow {
  return {
    id, topic, state: 'invited', messageCount: 0, createdAt: now, lastActivityAt: now,
    initiator: { ...initiator, answer: 'pending' },
    invitee: { ...invitee, scope: '', answer: 'pending' },
  }
}

/** An owner answers the invitation with the scope they approved: the second acceptance opens the Thread, a decline ends it. */
export function answered(row: ThreadRow, robotId: string, accepted: boolean, scope: string, now: number): Step<{ readonly outcome: AnswerOutcome }> {
  const side = sideOf(row, robotId)
  if (side === undefined) return refused('you are not part of this Thread')
  if (row.state !== 'invited') return refused(`this Thread is already ${row.state}`)
  if (row[side].answer !== 'pending') return refused('this invitation was already answered')
  const common: Common = { ...row, [side]: { ...row[side], answer: accepted ? 'accepted' : 'declined', scope: accepted ? scope : row[side].scope } }
  if (!accepted) return { ok: true, outcome: 'declined', row: { ...common, state: 'declined', closedAt: now, declinedBy: robotId } }
  if (common.initiator.answer === 'accepted' && common.invitee.answer === 'accepted') return { ok: true, outcome: 'opened', row: { ...common, state: 'open', openedAt: now, lastActivityAt: now } }
  return { ok: true, outcome: 'waiting', row: { ...common, state: 'invited' } }
}

/** A chief sends a message: only an open Thread takes one; the count and the idle clock move. */
export function messaged(row: ThreadRow, robotId: string, now: number): Step<{ readonly to: string }> {
  const side = sideOf(row, robotId)
  if (side === undefined) return refused('you are not part of this Thread')
  if (row.state !== 'open') return refused(row.state === 'invited' ? 'this Thread is not open yet: both owners must accept first' : `this Thread is ${row.state}`)
  return { ok: true, to: side === 'initiator' ? row.invitee.robotId : row.initiator.robotId, row: { ...row, messageCount: row.messageCount + 1, lastActivityAt: now } }
}

/** A chief closes an open Thread with a summary both chiefs receive (ch-rlnd). */
export function closed(row: ThreadRow, robotId: string, summary: string, now: number): Step {
  if (sideOf(row, robotId) === undefined) return refused('you are not part of this Thread')
  if (row.state !== 'open') return refused(row.state === 'invited' ? 'this Thread is not open yet: wait for the invitation to be answered' : `this Thread is already ${row.state}`)
  return { ok: true, row: { ...row, state: 'closed', closedAt: now, ending: { cause: 'chief', robotId, summary } } }
}

/** 7 days without a message closes an open Thread; 7 days without both answers ends an invitation (ch-gckb). */
export function lapsed(row: ThreadRow, now: number): Step {
  if (now - row.lastActivityAt < THREAD_IDLE_MS) return refused('this Thread is not idle')
  if (row.state === 'open') return { ok: true, row: { ...row, state: 'closed', closedAt: now, ending: { cause: 'idle' } } }
  if (row.state === 'invited') return { ok: true, row: { ...row, state: 'closed', openedAt: null, closedAt: now, ending: { cause: 'expired' } } }
  return refused(`this Thread is already ${row.state}`)
}

/** A chief is gone (its Robot deleted, its owner removed): its Threads that are not over end. */
export function abandoned(row: ThreadRow, robotId: string, now: number): Step {
  if (sideOf(row, robotId) === undefined) return refused('not part of this Thread')
  if (row.state === 'open') return { ok: true, row: { ...row, state: 'closed', closedAt: now, ending: { cause: 'gone', robotId } } }
  if (row.state === 'invited') return { ok: true, row: { ...row, state: 'closed', openedAt: null, closedAt: now, ending: { cause: 'gone', robotId } } }
  return refused(`this Thread is already ${row.state}`)
}

// ------------------------------------------------------------------ storage

type ThreadSql = {
  id: string; topic: string; state: string
  a_member: string; a_robot: string; a_scope: string; a_answer: string
  b_member: string; b_robot: string; b_scope: string; b_answer: string
  message_count: number; created_at: number; opened_at: number | null; closed_at: number | null
  closed_by: string | null; closer: string | null; summary: string | null; last_activity_at: number
}

const answerOf = (value: string, id: string): Answer => {
  if (value !== 'pending' && value !== 'accepted' && value !== 'declined') throw new Error(`thread row ${id}: unknown answer ${value}`)
  return value
}

const endingOf = (row: ThreadSql): Ending | undefined => {
  switch (row.closed_by) {
    case 'chief': return row.closer === null ? undefined : { cause: 'chief', robotId: row.closer, summary: row.summary ?? '' }
    case 'idle': return { cause: 'idle' }
    case 'expired': return { cause: 'expired' }
    case 'gone': return row.closer === null ? undefined : { cause: 'gone', robotId: row.closer }
    default: return undefined
  }
}

/** Parse a stored row; a row no transition could have written is a defect. */
function fromSql(row: ThreadSql): ThreadRow {
  const common: Common = {
    id: row.id,
    topic: row.topic,
    initiator: { memberId: row.a_member, robotId: row.a_robot, scope: row.a_scope, answer: answerOf(row.a_answer, row.id) },
    invitee: { memberId: row.b_member, robotId: row.b_robot, scope: row.b_scope, answer: answerOf(row.b_answer, row.id) },
    messageCount: row.message_count,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  }
  const broken = new Error(`thread row ${row.id} is inconsistent (${row.state}, ${String(row.closed_by)})`)
  switch (row.state) {
    case 'invited': return { ...common, state: 'invited' }
    case 'open':
      if (row.opened_at === null) throw broken
      return { ...common, state: 'open', openedAt: row.opened_at }
    case 'declined':
      if (row.closed_at === null || row.closer === null) throw broken
      return { ...common, state: 'declined', closedAt: row.closed_at, declinedBy: row.closer }
    case 'closed': {
      const ending = endingOf(row)
      if (row.closed_at === null || ending === undefined) throw broken
      return { ...common, state: 'closed', openedAt: row.opened_at, closedAt: row.closed_at, ending }
    }
    default: throw broken
  }
}

function toSql(row: ThreadRow): ThreadSql {
  const ending = row.state === 'closed' ? row.ending : undefined
  const state: ThreadState = row.state
  return {
    id: row.id, topic: row.topic, state,
    a_member: row.initiator.memberId, a_robot: row.initiator.robotId, a_scope: row.initiator.scope, a_answer: row.initiator.answer,
    b_member: row.invitee.memberId, b_robot: row.invitee.robotId, b_scope: row.invitee.scope, b_answer: row.invitee.answer,
    message_count: row.messageCount, created_at: row.createdAt, last_activity_at: row.lastActivityAt,
    opened_at: row.state === 'open' || row.state === 'closed' ? row.openedAt : null,
    closed_at: row.state === 'declined' || row.state === 'closed' ? row.closedAt : null,
    closed_by: row.state === 'declined' ? 'declined' : ending?.cause ?? null,
    closer: row.state === 'declined' ? row.declinedBy : ending !== undefined && 'robotId' in ending ? ending.robotId : null,
    summary: ending?.cause === 'chief' ? ending.summary : null,
  }
}

const COLUMNS = ['id', 'topic', 'state', 'a_member', 'a_robot', 'a_scope', 'a_answer', 'b_member', 'b_robot', 'b_scope', 'b_answer', 'message_count', 'created_at', 'opened_at', 'closed_at', 'closed_by', 'closer', 'summary', 'last_activity_at'] as const

export class ThreadRegistry {
  constructor(private readonly sql: SqlStorage, private readonly transaction: <A>(work: () => A) => A) {
    sql.exec(`CREATE TABLE IF NOT EXISTS thread (
      id TEXT PRIMARY KEY, topic TEXT NOT NULL, state TEXT NOT NULL,
      a_member TEXT NOT NULL, a_robot TEXT NOT NULL, a_scope TEXT NOT NULL, a_answer TEXT NOT NULL,
      b_member TEXT NOT NULL, b_robot TEXT NOT NULL, b_scope TEXT NOT NULL, b_answer TEXT NOT NULL,
      message_count INTEGER NOT NULL, created_at INTEGER NOT NULL, opened_at INTEGER, closed_at INTEGER,
      closed_by TEXT, closer TEXT, summary TEXT, last_activity_at INTEGER NOT NULL
    )`)
  }

  get(id: string): ThreadRow | undefined {
    const row = this.sql.exec<ThreadSql>('SELECT * FROM thread WHERE id = ?', id).toArray()[0]
    return row === undefined ? undefined : fromSql(row)
  }

  all(): ThreadRow[] {
    return this.sql.exec<ThreadSql>('SELECT * FROM thread ORDER BY last_activity_at DESC, created_at DESC').toArray().map(fromSql)
  }

  /** The ids of a chief's Threads that are not over yet. */
  activeOf(robotId: string): string[] {
    return this.sql.exec<{ id: string }>("SELECT id FROM thread WHERE state IN ('invited', 'open') AND (a_robot = ? OR b_robot = ?)", robotId, robotId).toArray().map((row) => row.id)
  }

  /** The ids of Threads not over whose last move is older than the idle limit. */
  lapsing(now: number): string[] {
    return this.sql.exec<{ id: string }>("SELECT id FROM thread WHERE state IN ('invited', 'open') AND last_activity_at <= ?", now - THREAD_IDLE_MS).toArray().map((row) => row.id)
  }

  /** When the first Thread that is not over lapses; null when none. */
  nextLapseAt(): number | null {
    const row = this.sql.exec<{ at: number | null }>("SELECT MIN(last_activity_at) AS at FROM thread WHERE state IN ('invited', 'open')").one()
    return row.at === null ? null : row.at + THREAD_IDLE_MS
  }

  insert(row: ThreadRow): ThreadRow {
    this.save(row)
    return row
  }

  /** Read the Thread, apply one transition and keep its result, in one SQLite transaction. */
  step<T extends object>(id: string, transition: (row: ThreadRow) => Step<T>): Step<T> {
    return this.transaction(() => {
      const row = this.get(id)
      if (row === undefined) return refused('no such Thread')
      const next = transition(row)
      if (next.ok) this.save(next.row)
      return next
    })
  }

  private save(row: ThreadRow): void {
    const values = toSql(row)
    this.sql.exec(
      `INSERT INTO thread (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
       ON CONFLICT (id) DO UPDATE SET ${COLUMNS.filter((name) => name !== 'id').map((name) => `${name} = excluded.${name}`).join(', ')}`,
      ...COLUMNS.map((name) => values[name]),
    )
  }
}
