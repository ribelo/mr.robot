/**
 * Cold chapters (v1.19 ticket 06, ec-4qsf): a chapter outside the retention window moves whole to R2, one object with its events and
 * those of the Subagents that ran in it; its rows leave the Durable Object. Its chat items and its search index stay, so the chat never
 * notices; its Trajectory is read from the object when someone opens it (ec-aly5). Cold chapters are never deleted by age, only by
 * deleting the Robot or clearing its history (ec-cgsl).
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as Schema from 'effect/Schema'
import { readStoredEvents } from '../agent/session-log.ts'
import type { Chapter } from './chapters.ts'
import type { RobotStore } from './store.ts'
import { SubagentStore } from './subagent-store.ts'

/** The retention window (ec-2rdv): the last 30 chapters or 60 days, whichever keeps more. */
export const CHAPTERS_KEPT = 30
export const CHAPTER_DAYS_KEPT = 60
const DAY_MS = 86_400_000
/** Chapters one tidy pass moves at most; the next passes take the rest. */
export const COLD_BATCH = 20

/** Where a Robot's cold chapters are: beside its Workspace, never in it (the Robot's file tools do not reach them). */
export function coldPrefix(robotId: string): string {
  return `chapters/${robotId}/`
}

const coldKey = (robotId: string, ordinal: number) => `${coldPrefix(robotId)}${ordinal}.json`

/** One cold chapter as stored: its session's events and its Subagents' (ec-h8ib: they age with it). */
const ColdChapter = Schema.Struct({
  sessionId: Schema.String,
  events: Schema.Array(Schema.Unknown),
  subagents: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
})
export interface ColdChapter {
  readonly sessionId: string
  readonly events: readonly SessionEvent[]
  readonly subagents: Readonly<Record<string, readonly SessionEvent[]>>
}

/** Move the chapters outside the window to R2 (the Workspace tidy pass runs it); a chapter whose chat is not stored yet waits. Returns how many moved. */
export async function moveColdChapters(store: RobotStore, bucket: R2Bucket, robotId: string, now: number, limit = COLD_BATCH): Promise<number> {
  const subagents = new SubagentStore(store.sql)
  let moved = 0
  for (const chapter of store.chapters.outsideWindow(CHAPTERS_KEPT, now - CHAPTER_DAYS_KEPT * DAY_MS, limit)) {
    if (!store.chat.current(chapter.sessionId)) continue
    const children = subagents.of(chapter.sessionId)
    if (children.some((row) => row.status === 'running')) continue
    const events = readStoredEvents(store.sql, chapter.sessionId)
    const body: ColdChapter = { sessionId: chapter.sessionId, events, subagents: Object.fromEntries(children.map((row) => [row.id, readStoredEvents(store.sql, row.id)])) }
    await bucket.put(coldKey(robotId, chapter.ordinal), JSON.stringify(body), { httpMetadata: { contentType: 'application/json' } })
    const turns = events.filter((event) => event.seq >= chapter.firstSeq && event.type === 'turn/start').length
    store.transaction(() => {
      for (const session of [chapter.sessionId, ...children.map((row) => row.id)]) store.sql.exec('DELETE FROM session_event WHERE session_id = ?', session)
      store.chapters.markCold(chapter.sessionId, turns)
    })
    moved += 1
  }
  return moved
}

/** A cold chapter's object; undefined when the chapter is not cold or its object is gone. */
export async function coldChapter(bucket: R2Bucket, robotId: string, chapter: Chapter): Promise<ColdChapter | undefined> {
  if (chapter.state.kind !== 'closed' || !chapter.state.cold) return undefined
  const object = await bucket.get(coldKey(robotId, chapter.ordinal))
  if (object === null) return undefined
  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(ColdChapter))(await object.text())
  return decoded as unknown as ColdChapter
}

/** Delete every cold chapter of a Robot: it is deleted, or its history is cleared (ec-cgsl). */
export async function deleteColdChapters(bucket: R2Bucket, robotId: string): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: coldPrefix(robotId), ...(cursor === undefined ? {} : { cursor }) })
    if (page.objects.length > 0) await bucket.delete(page.objects.map((object) => object.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
}
