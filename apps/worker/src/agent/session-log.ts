/**
 * Session persistence over Durable Object SQLite: the Robot's Conversation log.
 *
 * A Robot DO is single-threaded and its SQLite writes are durable at the output
 * gate, so every routed event is written synchronously in its own statement;
 * there is no batching window and `flush` has nothing to drain.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  SessionLogOffset,
  type Session,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
} from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistence,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  assertContiguous,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  validateStoredEvents,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'

export const SESSION_LOG_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS session_log (
    id TEXT PRIMARY KEY,
    header TEXT NOT NULL,
    inherited INTEGER NOT NULL,
    length INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session_event (
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
  ) WITHOUT ROWID`,
]

/** Read the full stored log of one session (used by the conversation views). */
export function readStoredEvents(sql: SqlStorage, id: string, from = 0): SessionEvent[] {
  return sql
    .exec<{ event: string }>('SELECT event FROM session_event WHERE session_id = ? AND seq >= ? ORDER BY seq', id, from)
    .toArray()
    .map((row) => JSON.parse(row.event) as SessionEvent)
}

/** Number of events stored for a session (0 when it does not exist yet). */
export function storedLength(sql: SqlStorage, id: string): number {
  return sql.exec<{ length: number }>('SELECT length FROM session_log WHERE id = ?', id).toArray()[0]?.length ?? 0
}

interface StoredLog {
  readonly header: SessionHeader
  readonly inherited: number
  length: number
}

export interface SessionLogConfig {
  readonly storage: DurableObjectStorage
  /** Called after events are durably appended (live views subscribe through it). */
  readonly onAppend?: (sessionId: string) => void
  /** Rewrites an event's JSON before it is stored: secret values never reach SQLite (robot-4zi6). */
  readonly redact?: (json: string) => string
}

export class SqliteSessionLog extends SessionPersistence {
  static inject = ['sessions']
  private readonly storage: DurableObjectStorage
  private readonly onAppend: ((sessionId: string) => void) | undefined
  private readonly redact: (json: string) => string
  private readonly sql: SqlStorage
  private readonly writers = new Map<string, SessionHandle>()

  constructor(ctx: Context, config: SessionLogConfig) {
    super(ctx)
    this.storage = config.storage
    this.onAppend = config.onAppend
    this.redact = config.redact ?? ((json) => json)
    this.sql = config.storage.sql
    for (const statement of SESSION_LOG_SCHEMA) this.sql.exec(statement)
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      const writer = this.writers.get(session.id)
      if (writer !== undefined) this.write(session.id, [event])
    })
    ctx.on('session/disposed', (session: Session) => {
      void this.writers.get(session.id)?.close()
    })
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    const meta = materializeCreateHeader(header)
    if (this.load(meta.id) !== undefined) throw new SessionAlreadyExistsError(meta.id)
    const inherited = options?.inheritedEventCount ?? 0
    this.sql.exec(
      'INSERT INTO session_log (id, header, inherited, length) VALUES (?, ?, ?, 0)',
      meta.id, JSON.stringify(meta), inherited,
    )
    return this.claim(meta.id, 'write')
  }

  async open(id: SessionId, access: SessionAccess): Promise<SessionHandle> {
    if (this.load(id) === undefined) throw new SessionPersistenceNotFoundError(id)
    return this.claim(id, access)
  }

  async flush(): Promise<void> {}

  async stat(id: SessionId): Promise<SessionPersistenceSnapshot | undefined> {
    const stored = this.load(id)
    return stored === undefined ? undefined : snapshot(stored)
  }

  async list(): Promise<readonly SessionPersistenceSnapshot[]> {
    return this.sql
      .exec<{ id: string }>('SELECT id FROM session_log')
      .toArray()
      .flatMap((row) => {
        const stored = this.load(row.id)
        return stored === undefined ? [] : [snapshot(stored)]
      })
  }

  private load(id: string): StoredLog | undefined {
    const row = this.sql
      .exec<{ header: string; inherited: number; length: number }>(
        'SELECT header, inherited, length FROM session_log WHERE id = ?', id,
      )
      .toArray()[0]
    if (row === undefined) return undefined
    const header = JSON.parse(row.header) as SessionHeader
    assertVersion(header)
    return { header, inherited: row.inherited, length: row.length }
  }

  private write(id: string, events: readonly SessionEvent[]): void {
    if (events.length === 0) return
    const batch = materializeAppendBatch(events)
    this.storage.transactionSync(() => {
      const stored = this.load(id)
      if (stored === undefined) throw new SessionPersistenceNotFoundError(id as SessionId)
      assertContiguous(stored.header.id, batch, stored.length)
      for (const event of batch) {
        this.sql.exec('INSERT INTO session_event (session_id, seq, event) VALUES (?, ?, ?)', id, event.seq, this.redact(JSON.stringify(event)))
      }
      this.sql.exec('UPDATE session_log SET length = ? WHERE id = ?', stored.length + batch.length, id)
    })
    this.onAppend?.(id)
  }

  private claim(id: SessionId, access: SessionAccess): SessionHandle {
    if (access === 'write' && this.writers.has(id)) throw new SessionAlreadyOwnedError(id)
    const stored = this.load(id)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(id)
    let closed = false
    const guard = (operation: 'read' | 'append' | 'flush') => {
      if (closed) throw new SessionHandleClosedError(id, operation)
      if (operation !== 'read' && access !== 'write') throw new SessionReadOnlyError(id, operation)
    }
    const handle: SessionHandle = {
      id,
      header: stored.header,
      inheritedEventCount: SessionLogOffset(stored.inherited),
      access,
      read: async (offset = 0, length) => {
        guard('read')
        const events = readStoredEvents(this.sql, id, offset)
        const slice = length === undefined ? events : events.slice(0, length)
        return { eventState: 'detached', events: validateStoredEvents(stored.header, slice) }
      },
      append: async (events) => {
        guard('append')
        this.write(id, events)
      },
      flush: async () => {
        guard('flush')
      },
      close: async () => {
        if (closed) return
        closed = true
        if (this.writers.get(id) === handle) this.writers.delete(id)
      },
      [Symbol.asyncDispose]: () => handle.close(),
    }
    if (access === 'write') this.writers.set(id, handle)
    return handle
  }
}

function snapshot(stored: StoredLog): SessionPersistenceSnapshot {
  return {
    header: stored.header,
    revision: SessionPersistenceRevision(`${stored.header.id}:${stored.length}`),
    eventCount: stored.length,
  }
}