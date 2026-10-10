/**
 * The owner's time zone (v1.11 ticket 08): what counts as a zone, and what a zone change does to a
 * Routine. Pure functions; the Member decides when the zone changes, the Robot applies it.
 */
import { createCronScheduleRecord, createDailyScheduleRecord, createWeeklyScheduleRecord, type ScheduleRecord } from '@deepseek-ai/dsh-schedule'

/** The zone every Member starts with, until the app reports its own. */
export const DEFAULT_TIME_ZONE = 'UTC'

// The same shape DSH accepts for a Routine: UTC, or Area/Location.
const IANA = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/

/** An IANA zone as the runtime knows it, or undefined for anything else (parse at the boundary). */
export function parseTimeZone(value: string): string | undefined {
  const text = value.trim()
  if (text !== 'UTC' && !IANA.test(text)) return undefined
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: text }).resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/**
 * A wall-clock Routine that ran in the owner's old zone keeps its local time in the new one: the
 * same rule, the next occurrence after `now` in the new zone. A Routine with its own zone, a
 * one-shot and an interval are instants and stay as they are.
 */
export function rezoneRecord(record: ScheduleRecord, from: string, to: string, now: number): ScheduleRecord {
  if (record.kind !== 'daily' && record.kind !== 'weekly' && record.kind !== 'cron') return record
  if (record.timeZone !== from) return record
  try {
    switch (record.kind) {
      case 'daily': return createDailyScheduleRecord(record.id, record.prompt, { time: record.time, time_zone: to }, now, record.title)
      case 'weekly': return createWeeklyScheduleRecord(record.id, record.prompt, { time: record.time, time_zone: to, weekdays: [...record.weekdays] }, now, record.title)
      case 'cron': return createCronScheduleRecord(record.id, record.prompt, { expression: record.expression, time_zone: to }, now, record.title)
    }
  } catch {
    // No future occurrence in the new zone: the Routine keeps its old target.
    return record
  }
}
