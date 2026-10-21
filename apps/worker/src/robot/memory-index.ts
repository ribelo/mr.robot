/**
 * The memory index (v1.20 ticket 03, dm-hmet, dm-yn3q, dm-zpoo): one row per paragraph of each indexed file, full text (FTS5) in the
 * Robot's SQLite, with LIKE where FTS5 is missing. The indexed set: the Robot's MEMORY.md, AGENTS.md, SOUL.md, memory/** and dreams/**;
 * the Member files it reads (USER.md, PROACTIVE_PREFERENCES.md, memory/world.md, memory/people/**) and SPACE.md. Every Workspace write
 * reindexes its file at once; the rest (the Member and Space files, and a Robot from before the index) is caught up a bounded number of
 * files per Turn. Limits, as decided: full text only, no vectors; no stemming (English and Polish words match as written, a prefix
 * matches its longer words).
 */
import type { MemoryScope } from '../agent/memory.ts'

/** Files indexed per catch-up (the first Turns after the upgrade index a year of notes in a few Turns). */
export const INDEX_BATCH = 100
const MAX_TERMS = 8
const SNIPPET_RADIUS = 120

/** A Robot file in the indexed set. */
export function isIndexedRobotPath(path: string): boolean {
  return path === 'MEMORY.md' || path === 'AGENTS.md' || path === 'SOUL.md' || /^(memory|dreams)\/.+\.md$/.test(path)
}

/** The note's date from its file name, when it has one (memory/2026-10-21.md, dreams/2026-10-21.md). */
export function dateOf(path: string): string | null {
  return /(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1] ?? null
}

/** The paragraphs of a file with their 1-based line ranges: blank lines separate them; a heading starts a new one. */
export function paragraphs(text: string): Array<{ readonly start: number; readonly end: number; readonly text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = []
  let current: { start: number; end: number; lines: string[] } | undefined
  const flush = () => {
    if (current !== undefined && current.lines.join('').trim() !== '') out.push({ start: current.start, end: current.end, text: current.lines.join('\n') })
    current = undefined
  }
  text.split('\n').forEach((line, index) => {
    const number = index + 1
    if (line.trim() === '') return flush()
    if (/^#{1,6}\s/.test(line)) flush()
    current ??= { start: number, end: number, lines: [] }
    current.lines.push(line)
    current.end = number
  })
  flush()
  return out
}

/** A cheap content version for files read through RPC (no etag). */
export function versionOf(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  return `h${(hash >>> 0).toString(36)}-${text.length}`
}

export interface MemoryMatch {
  readonly path: string
  readonly scope: MemoryScope
  /** "12-15" */
  readonly lines: string
  readonly date: string | null
  readonly snippet: string
}

export class MemoryIndex {
  readonly mode: 'fts5' | 'like'

  constructor(private readonly sql: SqlStorage, fullText = true) {
    sql.exec('CREATE TABLE IF NOT EXISTS memory_indexed (scope TEXT NOT NULL, path TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY (scope, path)) WITHOUT ROWID')
    const existing = sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'memory_index'").toArray()[0]
    if (existing !== undefined) {
      this.mode = /fts5/i.test(existing.sql) ? 'fts5' : 'like'
      return
    }
    try {
      if (!fullText) throw new Error('LIKE asked for')
      sql.exec('CREATE VIRTUAL TABLE memory_index USING fts5(text, scope UNINDEXED, path UNINDEXED, start UNINDEXED, end UNINDEXED, date UNINDEXED)')
      this.mode = 'fts5'
    } catch {
      sql.exec('CREATE TABLE memory_index (text TEXT NOT NULL, scope TEXT NOT NULL, path TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, date TEXT)')
      sql.exec('CREATE INDEX memory_index_file ON memory_index (scope, path)')
      this.mode = 'like'
    }
  }

  version(scope: MemoryScope, path: string): string | undefined {
    return this.sql.exec<{ version: string }>('SELECT version FROM memory_indexed WHERE scope = ? AND path = ?', scope, path).toArray()[0]?.version
  }

  /** The files indexed now, with their versions. */
  indexed(scope?: MemoryScope): Array<{ scope: MemoryScope; path: string; version: string }> {
    return (scope === undefined
      ? this.sql.exec<{ scope: MemoryScope; path: string; version: string }>('SELECT scope, path, version FROM memory_indexed')
      : this.sql.exec<{ scope: MemoryScope; path: string; version: string }>('SELECT scope, path, version FROM memory_indexed WHERE scope = ?', scope)).toArray()
  }

  /** Replace a file's rows. */
  index(scope: MemoryScope, path: string, text: string, version: string): void {
    this.sql.exec('DELETE FROM memory_index WHERE scope = ? AND path = ?', scope, path)
    const date = dateOf(path)
    for (const paragraph of paragraphs(text)) {
      this.sql.exec('INSERT INTO memory_index (text, scope, path, start, end, date) VALUES (?, ?, ?, ?, ?, ?)', paragraph.text, scope, path, paragraph.start, paragraph.end, date)
    }
    this.sql.exec('INSERT INTO memory_indexed (scope, path, version) VALUES (?, ?, ?) ON CONFLICT (scope, path) DO UPDATE SET version = excluded.version', scope, path, version)
  }

  remove(scope: MemoryScope, path: string): void {
    this.sql.exec('DELETE FROM memory_index WHERE scope = ? AND path = ?', scope, path)
    this.sql.exec('DELETE FROM memory_indexed WHERE scope = ? AND path = ?', scope, path)
  }

  clear(): void {
    this.sql.exec('DELETE FROM memory_index')
    this.sql.exec('DELETE FROM memory_indexed')
  }

  /** The best matches of the words, ranked (bm25 with FTS5; with LIKE, the most words matched, then the newest note). */
  search(query: string, limit = 10): MemoryMatch[] {
    const terms = query.split(/\s+/).map((term) => term.replace(/[^\p{L}\p{N}_.@-]/gu, '')).filter((term) => term !== '').slice(0, MAX_TERMS)
    if (terms.length === 0) throw new Error('give some words to search for')
    const count = Math.max(1, Math.min(50, Math.floor(limit)))
    type Row = { text: string; scope: MemoryScope; path: string; start: number; end: number; date: string | null }
    let rows: Row[]
    if (this.mode === 'fts5') {
      const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' OR ')
      try {
        rows = this.sql.exec<Row>('SELECT text, scope, path, start, end, date FROM memory_index WHERE memory_index MATCH ? ORDER BY bm25(memory_index), date DESC LIMIT ?', match, count).toArray()
      } catch {
        rows = []
      }
    } else {
      const score = terms.map(() => "(text LIKE ? ESCAPE '\\')").join(' + ')
      const likes = terms.map((term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`)
      rows = this.sql.exec<Row>(`SELECT text, scope, path, start, end, date FROM (SELECT *, (${score}) AS hits FROM memory_index) WHERE hits > 0 ORDER BY hits DESC, date DESC LIMIT ?`, ...likes, count).toArray()
    }
    return rows.map((row) => ({ path: row.path, scope: row.scope, lines: `${row.start}-${row.end}`, date: row.date, snippet: snippet(row.text, terms) }))
  }
}

function snippet(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase()
  const at = Math.min(...terms.map((term) => lower.indexOf(term.toLowerCase())).filter((index) => index >= 0), Number.POSITIVE_INFINITY)
  const from = Number.isFinite(at) ? Math.max(0, at - SNIPPET_RADIUS) : 0
  const to = Math.min(text.length, from + 2 * SNIPPET_RADIUS)
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`
}
