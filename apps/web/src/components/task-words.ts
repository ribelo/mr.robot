/**
 * Tasks in words (v1.13): a recurring rule, a timing, a doer, an attempt's outcome, as the panel, the detail sheet
 * and Mission Control show them. Pure functions.
 */
import type { Attempt, RecurringSchedule, TaskAssignee, TaskTiming, TaskView } from '@mr-robot/protocol'

const WEEKDAY_PLURAL = ['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

/** "Weekdays at 09:00", "Sundays at 02:00", "Every 30 minutes", "Every 2 hours", "cron 0 9 * * 1". */
export function scheduleText(schedule: RecurringSchedule): string {
  switch (schedule.kind) {
    case 'interval':
      return schedule.everyMinutes % 60 === 0 ? `Every ${schedule.everyMinutes === 60 ? 'hour' : `${schedule.everyMinutes / 60} hours`}` : `Every ${schedule.everyMinutes} minutes`
    case 'daily':
      return `Daily at ${schedule.time}`
    case 'weekly': {
      const days = [...schedule.weekdays].sort()
      const label = days.join(',') === '1,2,3,4,5' ? 'Weekdays' : days.join(',') === '6,7' ? 'Weekends' : days.length === 7 ? 'Daily' : days.map((day) => WEEKDAY_PLURAL[day]).join(', ')
      return `${label} at ${schedule.time}`
    }
    case 'cron':
      return `cron ${schedule.expression}`
  }
}

/** A moment as the person's clock shows it, short: "Fri 23 Oct, 18:00". */
export function momentText(at: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at)
}

/** The "when" of a Task: its start, its next occurrence (or paused), its deadline. */
export function whenText(timing: TaskTiming): string {
  switch (timing.kind) {
    case 'unscheduled': return timing.deadline === null ? '—' : `by ${momentText(timing.deadline)}`
    case 'scheduled': return `${momentText(timing.at)}${timing.deadline === null ? '' : ` · by ${momentText(timing.deadline)}`}`
    case 'recurring': return timing.paused ? `${scheduleText(timing.schedule)} · paused` : `${scheduleText(timing.schedule)} · next ${momentText(timing.next)}`
  }
}

/** The moment a Task is about, for sorting by time: its start, next occurrence or deadline. */
export function momentOf(timing: TaskTiming): number | null {
  return timing.kind === 'scheduled' ? timing.at : timing.kind === 'recurring' ? (timing.paused ? null : timing.next) : timing.deadline
}

export interface Names {
  readonly members: ReadonlyMap<string, string>
  readonly robots: ReadonlyMap<string, string>
}

/** "Anna", "Shopper", "nobody". */
export function assigneeText(assignee: TaskAssignee, names: Names): string {
  switch (assignee.kind) {
    case 'nobody': return 'nobody'
    case 'member': return names.members.get(assignee.memberId) ?? 'a Member'
    case 'robot': return names.robots.get(assignee.robotId) ?? 'a Robot'
  }
}

/** A stable key for a doer, for grouping and for the Assign to… menu. */
export function assigneeKey(assignee: TaskAssignee): string {
  return assignee.kind === 'nobody' ? 'nobody' : assignee.kind === 'member' ? `member:${assignee.memberId}` : `robot:${assignee.robotId}`
}

/** One character for an attempt's outcome. */
export function outcomeMark(outcome: Attempt['outcome']): string {
  switch (outcome) {
    case 'ok': return '✓'
    case 'failed': return '✕'
    case 'skipped': return '–'
    case 'interrupted': return '■'
    case 'running': return '…'
  }
}

/** The last attempt in one line: "✓ 18:02 Shopping list sent." */
export function lastAttemptText(task: TaskView): string {
  const last = task.attempts[0]
  if (last === undefined) return ''
  return `${outcomeMark(last.outcome)} ${momentText(last.startedAt)}${last.firstLine === '' ? '' : ` ${last.firstLine}`}`
}
