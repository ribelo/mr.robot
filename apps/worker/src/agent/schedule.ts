/**
 * DSH's schedule plugin ported onto Durable Object alarms (robot-c8hq, robot-gbbt). The model
 * gets DSH's own schedule_create / schedule_list / schedule_update / schedule_delete tools and
 * DSH's records and recurrence arithmetic, the same as in the desktop harness. What DSH keeps in
 * a Host storage domain and drives with timers lives here in the Robot's SQLite and its alarm.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  createAfterScheduleRecord, createAtScheduleRecord, createCronScheduleRecord, createDailyScheduleRecord, createEveryScheduleRecord,
  createWeeklyScheduleRecord, isRecurringScheduleRecord, registerScheduleTools, renderRecurringReminderBatchFraming, renderReminderFraming,
  resolveRecurringOccurrence, ScheduleId, ScheduleInputError, scheduleTitle,
  type ScheduleCatalogEntry, type ScheduleCreateRequest, type ScheduleDeleteRequest, type ScheduleDeleteResult, type ScheduleRecord,
  type ScheduleUpdateRequest, type ScheduleUpdateResult,
} from '@deepseek-ai/dsh-schedule'
import { resolveScheduleUpdate } from './schedule-update.ts'
import type { RoutineSchedule } from '@mr-robot/protocol'

export type { ScheduleRecord } from '@deepseek-ai/dsh-schedule'

/** One stored task: a DSH record bound to the session that created it. */
export interface ScheduleTask {
  readonly record: ScheduleRecord
  readonly sessionId: string
  readonly active: boolean
}

/** Where the tasks live: the Robot's routine table. */
export interface ScheduleStorage {
  tasks(): ScheduleTask[]
  save(task: ScheduleTask): void
  remove(id: string): boolean
  /** A task changed: re-plan the alarm and refresh views. */
  changed(): void
}

/** The ctx.schedule service DSH's schedule tools call, over the Robot's storage. */
export class AlarmSchedule {
  constructor(private readonly storage: ScheduleStorage) {}

  async create(sessionId: string, request: ScheduleCreateRequest): Promise<ScheduleRecord> {
    const selectors = [request.at, request.after_seconds, request.every_seconds, request.daily, request.weekly, request.cron].filter((value) => value !== undefined)
    if (selectors.length !== 1) throw new ScheduleInputError('invalid_selector', 'Exactly one reminder selector is required.')
    const title = scheduleTitle(request.title)
    const id = ScheduleId(`schedule-${crypto.randomUUID()}`)
    const now = Date.now()
    const record: ScheduleRecord =
      request.at !== undefined ? createAtScheduleRecord(id, request.prompt, request.at, now, title)
        : request.after_seconds !== undefined ? createAfterScheduleRecord(id, request.prompt, request.after_seconds, now, title)
          : request.every_seconds !== undefined ? createEveryScheduleRecord(id, request.prompt, request.every_seconds, now, title)
            : request.daily !== undefined ? createDailyScheduleRecord(id, request.prompt, request.daily, now, title)
              : request.weekly !== undefined ? createWeeklyScheduleRecord(id, request.prompt, request.weekly, now, title)
                : createCronScheduleRecord(id, request.prompt, request.cron!, now, title)
    this.storage.save({ record, sessionId, active: true })
    this.storage.changed()
    return record
  }

  async list(request: { sessionId: string }): Promise<ScheduleRecord[]> {
    return this.storage.tasks().filter((task) => task.active && task.sessionId === request.sessionId).map((task) => task.record)
  }

  async catalog(): Promise<ScheduleCatalogEntry[]> {
    return this.storage.tasks().map((task) => ({ ...task.record, sessionId: task.sessionId, status: task.active ? 'active' : 'inactive' }) as ScheduleCatalogEntry)
  }

  async delete(request: ScheduleDeleteRequest): Promise<ScheduleDeleteResult> {
    const task = this.storage.tasks().find((entry) => entry.record.id === request.id)
    if (task === undefined || task.sessionId !== request.sessionId) return { id: request.id, deleted: false, code: 'schedule_not_found' }
    this.storage.remove(request.id)
    this.storage.changed()
    return { id: request.id, deleted: true }
  }

  async update(request: ScheduleUpdateRequest): Promise<ScheduleUpdateResult> {
    const task = this.storage.tasks().find((entry) => entry.record.id === request.id)
    if (task === undefined || task.sessionId !== request.sessionId) return { id: request.id, updated: false, code: 'schedule_not_found' }
    if (!task.active) return { id: request.id, updated: false, code: 'schedule_ended' }
    const result = resolveScheduleUpdate(task.record, request.expected, request.change, Date.now(), request)
    if (!('record' in result) || !result.updated) return result
    this.storage.save({ ...task, record: result.record })
    this.storage.changed()
    return result
  }
}

/** Mount ctx.schedule and attach DSH's schedule tools to every agent (only when routines are granted). */
export function schedulePlugin(service: AlarmSchedule): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('schedule', service)
    const on = ctx as unknown as { on(event: string, listener: (input: { agent: { ctx: { effect(body: () => () => void): void } } }) => void): void }
    on.on('agent/created', ({ agent }) => {
      agent.ctx.effect(() => registerScheduleTools(ctx, agent.ctx as never, agent as never))
    })
  }
}

/** The tools DSH registers, for prompt previews and the admin view. */
export const SCHEDULE_TOOL_NAMES = ['schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete'] as const

/** A due task becomes a wake-up: DSH's own framing, and the next target for recurring tasks. */
export function dueDelivery(record: ScheduleRecord, now: number): { text: string; next: ScheduleRecord | null } {
  if (!isRecurringScheduleRecord(record)) return { text: renderReminderFraming(record), next: null }
  const occurrence = resolveRecurringOccurrence(record, now)
  return {
    text: renderRecurringReminderBatchFraming([{ record, occurrenceAt: occurrence.occurrenceAt }]),
    next: occurrence.nextScheduledAt === undefined ? null : { ...record, scheduledAt: occurrence.nextScheduledAt },
  }
}

/** The next target after a pause: a recurring task skips what it missed while paused. */
export function resumed(record: ScheduleRecord, now: number): ScheduleRecord | null {
  if (Date.parse(record.scheduledAt) > now) return record
  if (!isRecurringScheduleRecord(record)) return null
  const next = resolveRecurringOccurrence(record, now).nextScheduledAt
  return next === undefined ? null : { ...record, scheduledAt: next }
}

/** The record in the words the panel already shows (schedule summary and cron line). */
export function displaySchedule(record: ScheduleRecord): RoutineSchedule {
  switch (record.kind) {
    case 'after':
    case 'at': return { kind: 'once', at: record.scheduledAt }
    case 'every': return { kind: 'interval', everyMinutes: Math.max(1, Math.round(record.everySeconds / 60)) }
    case 'daily': return { kind: 'daily', time: record.time.slice(0, 5) }
    case 'weekly': return { kind: 'weekly', time: record.time.slice(0, 5), weekdays: [...record.weekdays] }
    case 'cron': return { kind: 'cron', expression: record.expression }
  }
}

/** A Routine stored before the port, as the DSH record it now is. */
export function recordFromLegacy(id: string, name: string, prompt: string, schedule: RoutineSchedule, timeZone: string, now: number): ScheduleRecord {
  const scheduleId = ScheduleId(id)
  const title = scheduleTitle(name.slice(0, 120) || 'Routine')
  switch (schedule.kind) {
    case 'once': return createAtScheduleRecord(scheduleId, prompt, { date: schedule.at.slice(0, 10), time: `${schedule.at.slice(11, 16)}:00`, time_zone: timeZone } as never, now, title)
    case 'interval': return createEveryScheduleRecord(scheduleId, prompt, schedule.everyMinutes * 60, now, title)
    case 'daily': return createDailyScheduleRecord(scheduleId, prompt, { time: `${schedule.time}:00`, time_zone: timeZone }, now, title)
    case 'weekly': return createWeeklyScheduleRecord(scheduleId, prompt, { time: `${schedule.time}:00`, time_zone: timeZone, weekdays: [...schedule.weekdays] }, now, title)
    case 'cron': return createCronScheduleRecord(scheduleId, prompt, { expression: schedule.expression, time_zone: timeZone }, now, title)
  }
}
