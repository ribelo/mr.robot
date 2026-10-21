/**
 * Routines become Tasks (v1.13 ticket 05, mc-t7gg): the one place that still reads a Robot's routine and
 * routine_run tables. The Space asks each Robot for its Routines once, stores them as Tasks, and the Robot drops
 * the tables. Each Routine keeps its id, so a Wake-up or a Conversation item that names it names its Task.
 */
import type { Attempt, RecurringSchedule, TaskTiming } from '@mr-robot/protocol'
import { nextRun, onceAt } from './schedule.ts'

/** A Routine as the Space stores it: a recurring Task, or a scheduled one for a one-shot Routine. */
export interface ExportedRoutine {
  readonly id: string
  readonly title: string
  readonly instructions: string
  readonly timing: TaskTiming
  /** A one-shot Routine that already ran is done. */
  readonly done: boolean
  readonly createdAt: number
  /** Its runs, newest first, as attempts. */
  readonly attempts: readonly Attempt[]
}

type RoutineSql = {
  id: string; name: string; prompt: string; schedule: string; time_zone: string; next_run: number | null
  created_at: number; paused: number; record: string | null
}

/** The DSH schedule record a Routine was stored as (robot-c8hq), as far as a Task needs it. */
interface StoredRecord {
  readonly kind: 'after' | 'at' | 'every' | 'daily' | 'weekly' | 'cron'
  readonly title?: string
  readonly prompt?: string
  readonly scheduledAt: string
  readonly everySeconds?: number
  readonly time?: string
  readonly weekdays?: readonly number[]
  readonly expression?: string
  readonly timeZone?: string
}

/** The schedule column of a Routine stored before the DSH record (v1). */
type LegacySchedule = RecurringSchedule | { readonly kind: 'once'; readonly at: string }

function tableExists(sql: SqlStorage, name: string): boolean {
  return sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name).toArray().length > 0
}

function timingOf(row: RoutineSql, now: number): { timing: TaskTiming; done: boolean } {
  const record = row.record === null ? undefined : JSON.parse(row.record) as StoredRecord
  const zone = record?.timeZone ?? row.time_zone
  const legacy = JSON.parse(row.schedule) as LegacySchedule
  const once = record === undefined ? (legacy.kind === 'once' ? onceAt(legacy.at, zone) : undefined) : record.kind === 'after' || record.kind === 'at' ? Date.parse(record.scheduledAt) : undefined
  if (once !== undefined) return { timing: { kind: 'scheduled', at: once, deadline: null }, done: row.next_run === null }
  const schedule: RecurringSchedule = record === undefined ? (legacy.kind === 'once' ? { kind: 'daily', time: '09:00' } : legacy)
    : record.kind === 'every' ? { kind: 'interval', everyMinutes: Math.max(5, Math.round((record.everySeconds ?? 300) / 60)) }
      : record.kind === 'daily' ? { kind: 'daily', time: (record.time ?? '09:00').slice(0, 5) }
        : record.kind === 'weekly' ? { kind: 'weekly', time: (record.time ?? '09:00').slice(0, 5), weekdays: [...(record.weekdays ?? [1])] }
          : { kind: 'cron', expression: record.expression ?? '0 9 * * *' }
  const planned = row.next_run ?? (record === undefined ? null : Date.parse(record.scheduledAt))
  const next = planned !== null && Number.isFinite(planned) ? planned : nextRun(schedule, zone, now, now) ?? now
  return { timing: { kind: 'recurring', schedule, timeZone: zone, next, paused: row.paused === 1 }, done: false }
}

/** The Robot's Routines with their runs; none when its tables are gone. */
export function exportRoutines(sql: SqlStorage, now = Date.now()): ExportedRoutine[] {
  if (!tableExists(sql, 'routine')) return []
  const runs = tableExists(sql, 'routine_run')
    ? sql.exec<{ routine_id: string; started_at: number; finished_at: number | null; outcome: Attempt['outcome']; first_line: string }>(
      'SELECT routine_id, started_at, finished_at, outcome, first_line FROM routine_run ORDER BY started_at DESC, id DESC',
    ).toArray()
    : []
  return sql.exec<RoutineSql>('SELECT id, name, prompt, schedule, time_zone, next_run, created_at, paused, record FROM routine ORDER BY created_at').toArray().map((row) => {
    const record = row.record === null ? undefined : JSON.parse(row.record) as StoredRecord
    const { timing, done } = timingOf(row, now)
    return {
      id: row.id, title: (record?.title ?? row.name).slice(0, 200) || 'Task', instructions: record?.prompt ?? row.prompt, timing, done, createdAt: row.created_at,
      // A run still marked running belonged to a Turn that is gone with the table.
      attempts: runs.filter((run) => run.routine_id === row.id).slice(0, 20).map((run) => ({ robotId: '', startedAt: run.started_at, finishedAt: run.finished_at ?? run.started_at, outcome: run.outcome === 'running' ? 'failed' : run.outcome, firstLine: run.first_line })),
    }
  })
}

/** After the Space stored them: the Routine tables go. */
export function dropRoutines(sql: SqlStorage): void {
  sql.exec('DROP TABLE IF EXISTS routine_run')
  sql.exec('DROP TABLE IF EXISTS routine')
}

/** A Robot made after v1.13 got empty Routine tables from the old migrations: they go at once. */
export function dropEmptyRoutines(sql: SqlStorage): void {
  if (!tableExists(sql, 'routine')) return
  if (sql.exec('SELECT 1 FROM routine LIMIT 1').toArray().length === 0) dropRoutines(sql)
}

/** A Wake-up queued by a Routine before v1.13 is the Task Wake-up of the Task it became. */
export function legacyWakeup<W extends { kind: string; sender: { kind: string }; payload: Record<string, unknown> }>(wakeup: W): W {
  if ((wakeup.kind as string) !== 'routine') return wakeup
  const sender = wakeup.sender as { routineId?: unknown; name?: unknown }
  const taskId = String(wakeup.payload['routineId'] ?? sender.routineId ?? '')
  return { ...wakeup, kind: 'task', sender: { kind: 'task', taskId, name: String(sender.name ?? 'Task') }, payload: { ...wakeup.payload, taskId, by: 'schedule' } }
}
