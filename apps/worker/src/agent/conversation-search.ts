/**
 * Full-text search over a Robot's own Conversation (cd-ggem), in the Durable Object's SQLite.
 *
 * The index holds the words of the chat items (messages and replies, see chatTextOf). FTS5 is used
 * when the runtime offers it; otherwise the same table shape is searched with LIKE. The index is
 * extended after every append to a tracked session and caught up from the stored log on first use,
 * so a Conversation written before search existed becomes searchable at its first search.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { chatTextOf } from '../robot/projection.ts'

export const SEARCH_PAGE_SIZE = 10
const CATCH_UP_BATCH = 500
const MAX_TERMS = 8
const SNIPPET_RADIUS = 70

export interface SearchHit {
  readonly id: string
  /** Who said it; null when the Robot itself did. */
  readonly sender: string | null
  readonly at: number
  readonly snippet: string
}

export interface SearchPage {
  readonly hits: readonly SearchHit[]
  /** The page to ask for next (1-based), or null when this was the last. */
  readonly nextPage: number | null
}

export class ConversationIndex {
  /** How this runtime searches: FTS5, or LIKE over the same columns. */
  readonly mode: 'fts5' | 'like'

  /** fullText false builds a new index for LIKE even where FTS5 exists (the fallback, tested in workerd). */
  constructor(private readonly sql: SqlStorage, fullText = true) {
    this.sql.exec('CREATE TABLE IF NOT EXISTS chat_search_state (session_id TEXT PRIMARY KEY, next_seq INTEGER NOT NULL) WITHOUT ROWID')
    const existing = this.sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'chat_search'").toArray()[0]
    if (existing !== undefined) {
      this.mode = /fts5/i.test(existing.sql) ? 'fts5' : 'like'
      return
    }
    try {
      if (!fullText) throw new Error('LIKE asked for')
      this.sql.exec('CREATE VIRTUAL TABLE chat_search USING fts5(text, id UNINDEXED, session_id UNINDEXED, seq UNINDEXED, kind UNINDEXED, sender UNINDEXED, at UNINDEXED)')
      this.mode = 'fts5'
    } catch {
      this.sql.exec('CREATE TABLE chat_search (text TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, sender TEXT, at INTEGER NOT NULL)')
      this.sql.exec('CREATE INDEX chat_search_session ON chat_search (session_id, seq)')
      this.mode = 'like'
    }
  }

  /** Start keeping the index of a new session up to date as events are appended. */
  track(sessionId: string): void {
    this.sql.exec('INSERT OR IGNORE INTO chat_search_state (session_id, next_seq) VALUES (?, 0)', sessionId)
  }

  /** After an append: extend the index of a session that is already being kept (never starts a backfill). */
  extend(sessionId: string): void {
    if (this.sql.exec('SELECT 1 FROM chat_search_state WHERE session_id = ?', sessionId).toArray().length > 0) this.catchUp(sessionId)
  }

  /** Index every stored event of the session that is not indexed yet. */
  catchUp(sessionId: string): void {
    let next = this.sql.exec<{ next_seq: number }>('SELECT next_seq FROM chat_search_state WHERE session_id = ?', sessionId).toArray()[0]?.next_seq ?? 0
    for (;;) {
      const rows = this.sql.exec<{ seq: number; event: string }>(
        'SELECT seq, event FROM session_event WHERE session_id = ? AND seq >= ? ORDER BY seq LIMIT ?', sessionId, next, CATCH_UP_BATCH,
      ).toArray()
      if (rows.length === 0) break
      for (const row of rows) {
        const event = JSON.parse(row.event) as SessionEvent
        const found = chatTextOf(event)
        if (found === undefined) continue
        this.sql.exec(
          'INSERT INTO chat_search (text, id, session_id, seq, kind, sender, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          found.text, found.id, sessionId, row.seq, found.kind, found.sender, event.time,
        )
      }
      next = rows[rows.length - 1]!.seq + 1
    }
    this.sql.exec('INSERT INTO chat_search_state (session_id, next_seq) VALUES (?, ?) ON CONFLICT (session_id) DO UPDATE SET next_seq = excluded.next_seq', sessionId, next)
  }

  /** Forget everything (the Conversation was cleared). */
  clear(): void {
    this.sql.exec('DELETE FROM chat_search')
    this.sql.exec('DELETE FROM chat_search_state')
  }

  /** Items matching every word of the query, newest first, a page at a time (page is 1-based). */
  search(sessionId: string, query: string, page: number): SearchPage {
    const terms = query.split(/\s+/).filter((term) => term !== '').slice(0, MAX_TERMS)
    if (terms.length === 0) throw new Error('give some words to search for')
    const number = Number.isInteger(page) && page >= 1 ? page : 1
    this.catchUp(sessionId)
    const offset = (number - 1) * SEARCH_PAGE_SIZE
    const rows = this.query(sessionId, terms, offset)
    const hits = rows.slice(0, SEARCH_PAGE_SIZE).map((row): SearchHit => ({ id: row.id, sender: row.kind === 'reply' ? null : row.sender, at: Number(row.at), snippet: snippet(row.text, terms) }))
    return { hits, nextPage: rows.length > SEARCH_PAGE_SIZE ? number + 1 : null }
  }

  private query(sessionId: string, terms: readonly string[], offset: number): Array<{ id: string; kind: string; sender: string | null; at: number; text: string }> {
    type Row = { id: string; kind: string; sender: string | null; at: number; text: string }
    if (this.mode === 'fts5') {
      const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ')
      try {
        return this.sql.exec<Row>(
          'SELECT id, kind, sender, at, text FROM chat_search WHERE chat_search MATCH ? AND session_id = ? ORDER BY CAST(seq AS INTEGER) DESC LIMIT ? OFFSET ?',
          match, sessionId, SEARCH_PAGE_SIZE + 1, offset,
        ).toArray()
      } catch {
        // A query the FTS5 syntax cannot express (only punctuation, say) matches nothing.
        return []
      }
    }
    const like = terms.map(() => "text LIKE ? ESCAPE '\\'").join(' AND ')
    return this.sql.exec<Row>(
      `SELECT id, kind, sender, at, text FROM chat_search WHERE session_id = ? AND ${like} ORDER BY seq DESC LIMIT ? OFFSET ?`,
      sessionId, ...terms.map((term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`), SEARCH_PAGE_SIZE + 1, offset,
    ).toArray()
  }
}

/** A short stretch of the text around the first matching word. */
function snippet(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase()
  const at = Math.min(...terms.map((term) => lower.indexOf(term.toLowerCase())).filter((index) => index >= 0), Number.POSITIVE_INFINITY)
  const from = Number.isFinite(at) ? Math.max(0, at - SNIPPET_RADIUS) : 0
  const to = Math.min(text.length, from + 2 * SNIPPET_RADIUS)
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`
}
