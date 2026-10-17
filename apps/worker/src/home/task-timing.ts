/**
 * The time of a Task (v1.13, mc-t2bb, mc-s2bb): parsing a timing a request gives, the next occurrence of a
 * recurring Task, the moment a Task wakes its doer, its reminder and whether it is overdue. Pure functions.
 */
import type { Attempt, Remind, TaskAssignee, TaskState, TaskTiming, TaskTimingInput } from '@mr-robot/protocol'
import { cronMinGapMinutes, nextRun, validateSchedule } from '../robot/schedule.ts'
import { parseTimeZone } from '../robot/time-zone.ts'

/** The shortest wait between two occurrences of a recurring Task, in minutes (cd-d14a). */
export const MIN_OCCURRENCE_GAP_MINUTES = 5

export const TOO_FREQUENT = `A recurring Task must wait at least ${MIN_OCCURRENCE_GAP_MINUTES} minutes (${MIN_OCCURRENCE_GAP_MINUTES * 60} seconds) between occurrences.`

export type Parsed<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly message: string }

export type Recurring = Extract<TaskTiming, { kind: 'recurring' }>

const refused = (message: string): Parsed<never> => ({ ok: false, message })

/**
 * A timing as stored, from what a request gave: a deadline never before the start, none on a recurring
 * Task, a rule that occurs at all and at least 5 minutes apart. `zone` is the caller's zone; `now` anchors an interval.
 */
export function parseTiming(input: TaskTimingInput | undefined, zone: string, now: number): Parsed<TaskTiming> {
  if (input === undefined) return { ok: true, value: { kind: 'unscheduled', deadline: null } }
  switch (input.kind) {
    case 'unscheduled':
      return { ok: true, value: { kind: 'unscheduled', deadline: input.deadline ?? null } }
    case 'scheduled': {
      const deadline = input.deadline ?? null
      if (deadline !== null && deadline < input.at) return refused('The deadline is before the start. Give a deadline at or after the moment the Task starts.')
      return { ok: true, value: { kind: 'scheduled', at: input.at, deadline } }
    }
    case 'recurring': {
      if (input.deadline !== undefined && input.deadline !== null) return refused('A recurring Task has no deadline. Put the preparation in a child Task with its own date.')
      const timeZone = parseTimeZone(input.timeZone ?? zone)
      if (timeZone === undefined) return refused(`"${input.timeZone ?? zone}" is not a time zone; use a name like Europe/Warsaw`)
      try {
        validateSchedule(input.schedule, timeZone)
        if (input.schedule.kind === 'cron' && cronMinGapMinutes(input.schedule.expression) < MIN_OCCURRENCE_GAP_MINUTES) return refused(`${TOO_FREQUENT} This cron expression occurs more often.`)
        const next = nextRun(input.schedule, timeZone, now, now)
        if (next === null) return refused('This schedule never occurs.')
        return { ok: true, value: { kind: 'recurring', schedule: input.schedule, timeZone, next, paused: false } }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return refused(message === 'an interval must be at least 5 minutes' ? TOO_FREQUENT : message)
      }
    }
  }
}

/**
 * A recurring Task after an occurrence is handled (mc-s2bb): the first occurrence after both the handled one
 * and now, so occurrences missed while the platform was down collapse into the one just handled.
 */
export function advanced(timing: Recurring, now: number): Recurring {
  const next = nextRun(timing.schedule, timing.timeZone, Math.max(now, timing.next), timing.next)
  return next === null ? { ...timing, paused: true } : { ...timing, next }
}

/** A recurring Task paused or resumed; a resumed one skips what it missed while paused. */
export function pausedTiming(timing: Recurring, pause: boolean, now: number): Recurring {
  if (pause) return { ...timing, paused: true }
  return timing.next > now ? { ...timing, paused: false } : { ...advanced(timing, now), paused: false }
}

/** The moment an open Task next wakes its doer: a scheduled Task's start, a running recurring Task's next occurrence. */
export function wakeAt(timing: TaskTiming, state: TaskState): number | null {
  if (state !== 'open') return null
  switch (timing.kind) {
    case 'unscheduled': return null
    case 'scheduled': return timing.at
    case 'recurring': return timing.paused ? null : timing.next
  }
}

/**
 * When the Home reminds a person of the occurrence at `wake` (mc-s3cc, mc-s4dd): `minutes` before a scheduled
 * Task that asks for it; before (or, without a reminder, at) a recurring occurrence. Null: no reminder.
 */
export function reminderAt(assignee: TaskAssignee, timing: TaskTiming, remind: Remind, wake: number | null): number | null {
  if (assignee.kind !== 'member' || wake === null) return null
  const before = remind.kind === 'before' ? remind.minutes * 60_000 : 0
  if (timing.kind === 'scheduled') return remind.kind === 'before' ? wake - before : null
  if (timing.kind === 'recurring') return wake - before
  return null
}

/**
 * Overdue, computed on read: a scheduled Task whose moment passed with no attempt since, or a person's
 * recurring Task whose occurrence passed unhandled. Done and cancelled Tasks are never overdue.
 */
export function overdue(state: TaskState, assignee: TaskAssignee, timing: TaskTiming, attempts: readonly Attempt[], now: number): boolean {
  if (state !== 'open') return false
  if (timing.kind === 'scheduled') return timing.at < now && !attempts.some((attempt) => attempt.startedAt >= timing.at)
  if (timing.kind === 'recurring') return assignee.kind === 'member' && !timing.paused && timing.next < now
  return false
}
