/**
 * The chat, stored (v1.19 ticket 03, ec-2sra): each chapter's chat items as rows, folded from its events as they are written (in the
 * same transaction), with the notices, Asks and delegations that happen beside the log. A page of the chat is one query per
 * chapter it reaches; nothing reads the log to show it. A chapter written before v1.19 is folded later, a bounded number of events at
 * a time (backfill); until then it is folded in memory when shown, with the same fold, so its rows come out the same.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { readStoredEvents, storedLength } from '../agent/session-log.ts'
import type { Chapter, ChapterStore } from './chapters.ts'
import { arrayRows, EMPTY_FOLD, foldEvent, foldLog, foldSide, type ChatFold, type ChatRows, type ChatRowView, type FoldInput, type StoredItem, type StoredRow } from './projection.ts'
import type { NoticeRow } from './store.ts'

export const CHAT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chat_item (
    ordinal INTEGER NOT NULL,
    position INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    view TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item TEXT NOT NULL,
    PRIMARY KEY (ordinal, position)
  ) WITHOUT ROWID`,
  'CREATE INDEX IF NOT EXISTS chat_item_by_id ON chat_item (item_id)',
  'CREATE TABLE IF NOT EXISTS chat_fold (session_id TEXT PRIMARY KEY, next_seq INTEGER NOT NULL, fold TEXT NOT NULL) WITHOUT ROWID',
]

/** Where a page of the chat ends, toward the older items: a chapter and a row in it. */
export interface ChatCursor {
  readonly ordinal: number
  readonly position: number
}

export function formatCursor(cursor: ChatCursor): string {
  return `${cursor.ordinal}.${cursor.position}`
}

/** A cursor the edge received; undefined when it is not one. */
export function parseCursor(text: string): ChatCursor | undefined {
  const match = /^(\d+)\.(\d+)$/.exec(text)
  return match === null ? undefined : { ordinal: Number(match[1]), position: Number(match[2]) }
}

/** What a chapter written before v1.19 had beside its log: its notices, delegations and Asks, placed as they were then. */
export interface LegacySides {
  readonly notices: (sessionId: string) => readonly NoticeRow[]
  readonly delegations: (sessionId: string) => ReadonlyArray<{ readonly id: string; readonly parentSeq: number; readonly startedAt: number }>
  readonly proposals: (from: number, until: number) => ReadonlyArray<{ readonly id: string; readonly createdAt: number }>
}

/** The chat_fold row that says every chapter is folded: the backfill has nothing left (chapters opened since are current). */
export const ALL_FOLDED = '*all-folded*'

type FoldRow = { next_seq: number; fold: string }
type ItemRow = { position: number; seq: number; view: ChatRowView; item: string }

export class ChatItems {
  constructor(private readonly sql: SqlStorage, private readonly chapters: ChapterStore) {}

  /** A new chapter's chat: empty, and current from the first event after its seed. */
  open(sessionId: string, firstSeq: number): void {
    this.sql.exec('INSERT OR REPLACE INTO chat_fold (session_id, next_seq, fold) VALUES (?, ?, ?)', sessionId, firstSeq, JSON.stringify(EMPTY_FOLD))
  }

  private foldOf(sessionId: string): { next: number; fold: ChatFold } | undefined {
    const row = this.sql.exec<FoldRow>('SELECT next_seq, fold FROM chat_fold WHERE session_id = ?', sessionId).toArray()[0]
    return row === undefined ? undefined : { next: row.next_seq, fold: JSON.parse(row.fold) as ChatFold }
  }

  private save(sessionId: string, next: number, fold: ChatFold): void {
    this.sql.exec('INSERT OR REPLACE INTO chat_fold (session_id, next_seq, fold) VALUES (?, ?, ?)', sessionId, next, JSON.stringify(fold))
  }

  /** Whether every event of the chapter is folded: its rows are its chat. */
  current(sessionId: string): boolean {
    const state = this.foldOf(sessionId)
    return state !== undefined && state.next >= storedLength(this.sql, sessionId)
  }

  private rows(ordinal: number, sessionId: string): ChatRows {
    return {
      get: (position) => {
        const row = this.sql.exec<ItemRow>('SELECT position, seq, view, item FROM chat_item WHERE ordinal = ? AND position = ?', ordinal, position).toArray()[0]
        return row === undefined ? undefined : { position: row.position, seq: row.seq, view: row.view, item: JSON.parse(row.item) as StoredItem }
      },
      put: (row) => {
        this.sql.exec('INSERT OR REPLACE INTO chat_item (ordinal, position, session_id, seq, view, item_id, item) VALUES (?, ?, ?, ?, ?, ?, ?)', ordinal, row.position, sessionId, row.seq, row.view, row.item.id, JSON.stringify(row.item))
      },
    }
  }

  /**
   * Events from `from` on were just stored: a chapter whose chat was current folds them (the seed before its first own event is
   * skipped). A chapter still behind is left to the backfill.
   */
  extend(sessionId: string, from: number, input: FoldInput): void {
    const state = this.foldOf(sessionId)
    const chapter = state === undefined || state.next < from ? undefined : this.chapters.get(sessionId)
    if (state === undefined || chapter === undefined) return
    const rows = this.rows(chapter.ordinal, sessionId)
    let fold = state.fold
    let next = state.next
    for (const event of readStoredEvents(this.sql, sessionId, state.next)) {
      fold = foldEvent(fold, event, rows, input)
      next = event.seq + 1
    }
    this.save(sessionId, next, fold)
  }

  /** A notice, an Ask or a delegation in a chapter whose chat is current; false when it is not (it is kept the way it was before v1.19). */
  side(sessionId: string, item: (seq: number) => StoredItem): boolean {
    const state = this.foldOf(sessionId)
    const chapter = this.chapters.get(sessionId)
    if (state === undefined || chapter === undefined || state.next < storedLength(this.sql, sessionId)) return false
    this.save(sessionId, state.next, foldSide(state.fold, this.rows(chapter.ordinal, sessionId), item(storedLength(this.sql, sessionId))))
    return true
  }

  /**
   * Fold the chapters written before v1.19, newest first, at most `budget` events (ec-2sra): a huge Robot is folded over several Turns.
   * Returns how many events were folded.
   */
  backfill(budget: number, input: (sessionId: string) => FoldInput, sides: LegacySides): number {
    if (this.foldOf(ALL_FOLDED) !== undefined) return 0
    const behind = this.sql.exec<{ session_id: string }>(
      `SELECT chapter.session_id FROM chapter JOIN session_log ON session_log.id = chapter.session_id
        LEFT JOIN chat_fold ON chat_fold.session_id = chapter.session_id
        WHERE chat_fold.session_id IS NULL OR chat_fold.next_seq < session_log.length ORDER BY chapter.ordinal DESC`,
    ).toArray()
    let done = 0
    for (const { session_id: sessionId } of behind) {
      if (done >= budget) break
      const chapter = this.chapters.get(sessionId)
      if (chapter === undefined) continue
      const state = this.foldOf(sessionId) ?? { next: chapter.firstSeq, fold: EMPTY_FOLD }
      const events = this.sql.exec<{ event: string }>('SELECT event FROM session_event WHERE session_id = ? AND seq >= ? ORDER BY seq LIMIT ?', sessionId, state.next, budget - done).toArray()
        .map((row) => JSON.parse(row.event) as SessionEvent)
      const length = storedLength(this.sql, sessionId)
      const last = events.at(-1)?.seq ?? state.next - 1
      const final = last + 1 >= length
      const fold = foldLog(legacyOf(chapter, events, state.next, final, sides), input(sessionId), state.fold, this.rows(chapter.ordinal, sessionId), final)
      this.save(sessionId, last + 1, fold)
      done += events.length
    }
    if (done < budget) this.save(ALL_FOLDED, 0, EMPTY_FOLD)
    return done
  }

  /**
   * The rows of one chapter newest first, older than `before` (a position), for one work-details level, up to its cut. A chapter not
   * folded yet is folded in memory, as the backfill would.
   */
  page(chapter: Chapter, view: 'compact' | 'detail', before: number | null, limit: number, input: (sessionId: string) => FoldInput, sides: LegacySides): StoredRow[] {
    const visible = (row: StoredRow) => (row.view === 'both' || row.view === view) && (chapter.cut === null || row.seq <= chapter.cut) && (before === null || row.position < before)
    if (this.current(chapter.sessionId)) {
      return this.sql.exec<ItemRow>(
        "SELECT position, seq, view, item FROM chat_item WHERE ordinal = ? AND position < ? AND view IN ('both', ?) AND seq <= ? ORDER BY position DESC LIMIT ?",
        chapter.ordinal, before ?? Number.MAX_SAFE_INTEGER, view, chapter.cut ?? Number.MAX_SAFE_INTEGER, limit,
      ).toArray().map((row) => ({ position: row.position, seq: row.seq, view: row.view, item: JSON.parse(row.item) as StoredItem }))
    }
    const rows = arrayRows()
    const events = readStoredEvents(this.sql, chapter.sessionId, chapter.firstSeq)
    foldLog(legacyOf(chapter, events, chapter.firstSeq, true, sides), input(chapter.sessionId), EMPTY_FOLD, rows, true)
    return rows.all.filter(visible).reverse().slice(0, limit)
  }

  /** The chapter and event of a chat item by its id (a diagnosis asks about one). */
  find(itemId: string): { readonly sessionId: string; readonly seq: number } | undefined {
    return this.sql.exec<{ session_id: string; seq: number }>('SELECT session_id, seq FROM chat_item WHERE item_id = ? LIMIT 1', itemId).toArray()
      .map((row) => ({ sessionId: row.session_id, seq: row.seq }))[0]
  }

  clear(): void {
    this.sql.exec('DELETE FROM chat_item')
    this.sql.exec('DELETE FROM chat_fold')
  }
}

/** The part of a chapter written before v1.19 from `from` on, with what was beside it from there. */
function legacyOf(chapter: Chapter, events: readonly SessionEvent[], from: number, final: boolean, sides: LegacySides) {
  const until = chapter.state.kind === 'closed' ? chapter.state.at : Number.MAX_SAFE_INTEGER
  return {
    events: events.filter((event) => event.seq >= chapter.firstSeq),
    notices: sides.notices(chapter.sessionId).filter((notice) => notice.afterSeq + 1 >= from),
    delegations: sides.delegations(chapter.sessionId).filter((row) => row.parentSeq >= from),
    proposals: final || events.length === 0 ? sides.proposals(chapter.openedAt, until) : sides.proposals(chapter.openedAt, Math.min(until, events.at(-1)!.time)),
  }
}
