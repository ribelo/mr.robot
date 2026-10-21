import type { ChapterView } from '@mr-robot/protocol'

/**
 * The chapters of a Robot's Conversation (v1.19, ec-7oq8): each chapter is one DSH session in the log, from a compaction checkpoint (or a
 * Rewind's point) to the next. They form a chain by parent: the Conversation is the live chapter and its ancestors, each ancestor up to
 * the point its child was seeded from (its cut). A chapter off that chain is superseded: a Rewind left it behind; it stays readable.
 * Subagent sessions are not chapters; they belong to the chapter they ran in by their parent session.
 */

export type ChapterClose = 'compaction' | 'rewind'

/** Whether a chapter is the one the Robot works in, or how it closed. */
export type ChapterState =
  | { readonly kind: 'live' }
  | {
    readonly kind: 'closed'
    readonly at: number
    readonly by: ChapterClose
    /** Off the Conversation's chain: a Rewind went back to before it. */
    readonly superseded: boolean
  }

export interface Chapter {
  readonly sessionId: string
  /** 1 for the first chapter, then one more for each chapter opened. */
  readonly ordinal: number
  /** The chapter it was seeded from and the last event of it that the seed carries; null for the first. */
  readonly parent: { readonly sessionId: string; readonly seq: number } | null
  /** Its own events start here; the ones before are its seed (what the model saw of its parent). */
  readonly firstSeq: number
  /** On the chain, the last of its events that is part of the Conversation when a Rewind went back into it; null: all of them. */
  readonly cut: number | null
  readonly openedAt: number
  readonly state: ChapterState
}

export const CHAPTER_SCHEMA = `CREATE TABLE IF NOT EXISTS chapter (
  session_id TEXT PRIMARY KEY,
  ordinal INTEGER NOT NULL UNIQUE,
  parent_session TEXT,
  parent_seq INTEGER,
  first_seq INTEGER NOT NULL,
  cut INTEGER,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  closed_by TEXT,
  superseded INTEGER NOT NULL DEFAULT 0,
  turns INTEGER
) WITHOUT ROWID`

type Row = {
  session_id: string; ordinal: number; parent_session: string | null; parent_seq: number | null; first_seq: number; cut: number | null
  opened_at: number; closed_at: number | null; closed_by: ChapterClose | null; superseded: number; turns: number | null
}

const fromSql = (row: Row): Chapter => ({
  sessionId: row.session_id,
  ordinal: row.ordinal,
  parent: row.parent_session === null ? null : { sessionId: row.parent_session, seq: row.parent_seq ?? 0 },
  firstSeq: row.first_seq,
  cut: row.cut,
  openedAt: row.opened_at,
  state: row.closed_at === null || row.closed_by === null ? { kind: 'live' } : { kind: 'closed', at: row.closed_at, by: row.closed_by, superseded: row.superseded === 1 },
})

export class ChapterStore {
  constructor(private readonly sql: SqlStorage) {}

  get(sessionId: string): Chapter | undefined {
    const row = this.sql.exec<Row>('SELECT * FROM chapter WHERE session_id = ?', sessionId).toArray()[0]
    return row === undefined ? undefined : fromSql(row)
  }

  /** Every chapter, oldest first. */
  all(): Chapter[] {
    return this.sql.exec<Row>('SELECT * FROM chapter ORDER BY ordinal').toArray().map(fromSql)
  }

  /** The chapters of the Conversation (the live chapter and its chain), oldest first. */
  chain(): Chapter[] {
    return this.sql.exec<Row>('SELECT * FROM chapter WHERE superseded = 0 ORDER BY ordinal').toArray().map(fromSql)
  }

  /** The chapter of the Conversation with this ordinal; undefined when it is superseded or does not exist. */
  onChain(ordinal: number): Chapter | undefined {
    const row = this.sql.exec<Row>('SELECT * FROM chapter WHERE ordinal = ? AND superseded = 0', ordinal).toArray()[0]
    return row === undefined ? undefined : fromSql(row)
  }

  /** The chapter of the Conversation just before this ordinal. */
  olderThan(ordinal: number): Chapter | undefined {
    const row = this.sql.exec<Row>('SELECT * FROM chapter WHERE ordinal < ? AND superseded = 0 ORDER BY ordinal DESC LIMIT 1', ordinal).toArray()[0]
    return row === undefined ? undefined : fromSql(row)
  }

  /** The newest chapters of the Conversation, newest first. */
  latest(count: number): Chapter[] {
    return this.sql.exec<Row>('SELECT * FROM chapter WHERE superseded = 0 ORDER BY ordinal DESC LIMIT ?', count).toArray().map(fromSql)
  }

  /** The first chapter of a new Conversation, or the next one seeded from its parent's events up to parentSeq. */
  open(sessionId: string, parent: { readonly sessionId: string; readonly seq: number } | null, firstSeq: number, now: number): Chapter {
    const ordinal = (this.sql.exec<{ last: number | null }>('SELECT MAX(ordinal) AS last FROM chapter').one().last ?? 0) + 1
    this.sql.exec(
      'INSERT INTO chapter (session_id, ordinal, parent_session, parent_seq, first_seq, opened_at) VALUES (?, ?, ?, ?, ?, ?)',
      sessionId, ordinal, parent?.sessionId ?? null, parent?.seq ?? null, firstSeq, now,
    )
    return this.get(sessionId)!
  }

  /** The live chapter closes: a compaction opened the next one, or a Rewind did; its events give its count of Turns. */
  close(sessionId: string, by: ChapterClose, now: number, events: ReadonlyArray<{ readonly type: string; readonly seq: number }>): void {
    const first = this.get(sessionId)?.firstSeq ?? 0
    const turns = events.filter((event) => event.seq >= first && event.type === 'turn/start').length
    this.sql.exec('UPDATE chapter SET closed_at = ?, closed_by = ?, turns = ? WHERE session_id = ? AND closed_at IS NULL', now, by, turns, sessionId)
  }

  /**
   * A new chapter was seeded from inside this one at seq: the Conversation keeps this chapter up to there, and every chapter after it
   * leaves the chain (a Rewind; for a compaction the cut is the chapter's end and nothing is after it).
   */
  branch(sessionId: string, seq: number, now: number): void {
    const target = this.get(sessionId)
    if (target === undefined) return
    this.sql.exec('UPDATE chapter SET cut = ? WHERE session_id = ?', seq, sessionId)
    this.sql.exec("UPDATE chapter SET superseded = 1, closed_at = COALESCE(closed_at, ?), closed_by = COALESCE(closed_by, 'rewind') WHERE ordinal > ? AND superseded = 0", now, target.ordinal)
  }

  /** Undo of a Rewind (until v1.19 ticket 05): its chapter leaves the chain and the one it came from is live again, whole. */
  restore(sessionId: string, from: string, now: number): void {
    this.sql.exec("UPDATE chapter SET superseded = 1, closed_at = COALESCE(closed_at, ?), closed_by = COALESCE(closed_by, 'rewind') WHERE session_id = ?", now, from)
    this.sql.exec('UPDATE chapter SET closed_at = NULL, closed_by = NULL, cut = NULL, superseded = 0 WHERE session_id = ?', sessionId)
  }

  /** The chapter with this ordinal, on the Conversation or superseded. */
  byOrdinal(ordinal: number): Chapter | undefined {
    const row = this.sql.exec<Row>('SELECT * FROM chapter WHERE ordinal = ?', ordinal).toArray()[0]
    return row === undefined ? undefined : fromSql(row)
  }

  /** Every chapter as the Trajectory lists it (ec-mwvo); a closed chapter's Turns are counted once, the live one's each time. */
  views(): ChapterView[] {
    return this.sql.exec<Row>('SELECT * FROM chapter ORDER BY ordinal').toArray().map((row) => {
      let turns = row.turns
      if (turns === null) {
        // Stored events begin with their type: the count reads one chapter, never the history.
        turns = this.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM session_event WHERE session_id = ? AND seq >= ? AND event LIKE '{"type":"turn/start"%'`, row.session_id, row.first_seq).one().count
        if (row.closed_at !== null) this.sql.exec('UPDATE chapter SET turns = ? WHERE session_id = ?', turns, row.session_id)
      }
      return {
        ordinal: row.ordinal, sessionId: row.session_id, openedAt: row.opened_at, closedAt: row.closed_at, closedBy: row.closed_by,
        superseded: row.superseded === 1, turns, firstSeq: row.first_seq,
      }
    })
  }

  clear(): void {
    this.sql.exec('DELETE FROM chapter')
  }
}

/**
 * The upgrade to chapters (v1.19 ticket 02, ec-eaz3): every session of the Robot (not of a Subagent) becomes a chapter, in the order
 * it was made. Before v1.19 only a Rewind made another session: its rewind row is the link to its parent at the rewind's point, and a
 * session off the chain that leads to the live one (an undone Rewind's) is superseded.
 */
export function registerChapters(sql: SqlStorage): void {
  sql.exec(CHAPTER_SCHEMA)
  const config = sql.exec<{ v: string }>("SELECT v FROM robot WHERE k = 'config'").toArray()[0]
  const hasLog = sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'session_log'").toArray().length > 0
  if (config === undefined || !hasLog || sql.exec('SELECT 1 FROM chapter LIMIT 1').toArray().length > 0) return
  // Chapters registered now have no stored chat yet: the backfill looks again (chat-items.ts).
  if (sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'chat_fold'").toArray().length > 0) sql.exec("DELETE FROM chat_fold WHERE session_id = '*all-folded*'")
  if (sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'chat_search_state'").toArray().length > 0) sql.exec("DELETE FROM chat_search_state WHERE session_id = '*all-indexed*'")
  const live = (JSON.parse(config.v) as { liveSessionId: string }).liveSessionId
  const sessions = sql.exec<{ id: string; header: string; inherited: number }>("SELECT id, header, inherited FROM session_log WHERE id NOT LIKE 'sa-%'").toArray()
    .map((row) => ({ id: row.id, inherited: row.inherited, createdAt: Number((JSON.parse(row.header) as { createdAt?: number }).createdAt ?? 0) }))
  if (!sessions.some((session) => session.id === live)) sessions.push({ id: live, inherited: 0, createdAt: Date.now() })
  sessions.sort((a, b) => a.createdAt - b.createdAt || (a.id === live ? 1 : b.id === live ? -1 : 0))
  const rewinds = sql.exec<{ at_seq: number; archived_session_id: string; live_session_id: string; created_at: number; undone_at: number | null }>('SELECT * FROM rewind ORDER BY created_at').toArray()
  const parentOf = new Map(rewinds.map((rewind) => [rewind.live_session_id, { sessionId: rewind.archived_session_id, seq: rewind.at_seq }]))
  const chain = new Map<string, number | null>()
  for (let at: string | undefined = live, cut: number | null = null; at !== undefined && !chain.has(at);) {
    chain.set(at, cut)
    const parent = parentOf.get(at)
    cut = parent?.seq ?? null
    at = parent?.sessionId
  }
  const closedAt = (id: string, createdAt: number) => {
    const left = rewinds.filter((rewind) => rewind.archived_session_id === id && rewind.undone_at === null).map((rewind) => rewind.created_at)
    const undone = rewinds.filter((rewind) => rewind.live_session_id === id && rewind.undone_at !== null).map((rewind) => rewind.undone_at!)
    return Math.max(createdAt, ...left, ...undone)
  }
  for (const [index, session] of sessions.entries()) {
    const parent = parentOf.get(session.id) ?? null
    const isLive = session.id === live
    sql.exec(
      'INSERT INTO chapter (session_id, ordinal, parent_session, parent_seq, first_seq, cut, opened_at, closed_at, closed_by, superseded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      session.id, index + 1, parent?.sessionId ?? null, parent?.seq ?? null, session.inherited, chain.get(session.id) ?? null, session.createdAt,
      isLive ? null : closedAt(session.id, session.createdAt), isLive ? null : 'rewind', chain.has(session.id) ? 0 : 1,
    )
  }
}
