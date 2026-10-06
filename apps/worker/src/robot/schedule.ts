/**
 * Routine schedules in the owner's time zone (robot-gbbt): one-shot, interval, daily,
 * weekly and cron (five-field, Vixie semantics: when day-of-month and day-of-week are both
 * restricted, either matches). Pure functions; the Robot keeps one alarm at the earliest
 * next run.
 */
import type { RoutineSchedule } from '@mr-robot/protocol'

const MINUTE = 60_000
const DAY = 86_400_000

interface LocalDate { readonly year: number; readonly month: number; readonly day: number }

/** Offset of a time zone at an instant, in ms (local = utc + offset). */
function offsetAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return local - Math.floor(at / 1000) * 1000
}

/** The instant of a local wall-clock time; a time skipped by DST moves forward with the clock. */
export function zonedTime(date: LocalDate, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute)
  const first = guess - offsetAt(guess, timeZone)
  const second = guess - offsetAt(first, timeZone)
  return Math.min(first, second)
}

export function localDate(at: number, timeZone: string): LocalDate & { readonly weekday: number; readonly hour: number; readonly minute: number } {
  const local = new Date(at + offsetAt(at, timeZone))
  const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay()
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), weekday, hour: local.getUTCHours(), minute: local.getUTCMinutes() }
}

function addDays(date: LocalDate, days: number): LocalDate & { readonly weekday: number } {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY)
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), weekday: next.getUTCDay() === 0 ? 7 : next.getUTCDay() }
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (match === null) throw new ScheduleError(`time must be HH:MM, got "${time}"`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new ScheduleError(`time out of range: "${time}"`)
  return { hour, minute }
}

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleError'
  }
}

/** Reject a schedule that can never run; returns it unchanged otherwise. */
export function validateSchedule(schedule: RoutineSchedule, timeZone: string, now: number): RoutineSchedule {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    throw new ScheduleError(`unknown time zone "${timeZone}"`)
  }
  switch (schedule.kind) {
    case 'interval':
      if (!(schedule.everyMinutes >= 5)) throw new ScheduleError('an interval must be at least 5 minutes')
      break
    case 'weekly':
      if (schedule.weekdays.length === 0 || schedule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
        throw new ScheduleError('weekdays are ISO numbers, Monday 1 to Sunday 7')
      }
      parseTime(schedule.time)
      break
    case 'daily':
      parseTime(schedule.time)
      break
    case 'cron':
      parseCron(schedule.expression)
      break
    case 'once':
      if (onceAt(schedule.at, timeZone) <= now) throw new ScheduleError('a one-shot routine must be in the future')
      break
  }
  return schedule
}

function onceAt(at: string, timeZone: string): number {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(at)) {
    const instant = Date.parse(at)
    if (Number.isNaN(instant)) throw new ScheduleError(`cannot read the date "${at}"`)
    return instant
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(at.trim())
  if (match === null) throw new ScheduleError(`a one-shot time is YYYY-MM-DDTHH:MM in the owner's time zone, got "${at}"`)
  return zonedTime({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }, Number(match[4]), Number(match[5]), timeZone)
}

/**
 * The first run strictly after `after`, or null when the schedule has no more runs.
 * @param anchor - when the Routine was created; interval runs are aligned to it.
 */
export function nextRun(schedule: RoutineSchedule, timeZone: string, after: number, anchor: number): number | null {
  switch (schedule.kind) {
    case 'once': {
      const at = onceAt(schedule.at, timeZone)
      return at > after ? at : null
    }
    case 'interval': {
      const every = schedule.everyMinutes * MINUTE
      const steps = Math.floor((after - anchor) / every) + 1
      return anchor + Math.max(1, steps) * every
    }
    case 'daily': {
      const { hour, minute } = parseTime(schedule.time)
      return scanDays(after, timeZone, () => true, [hour], [minute])
    }
    case 'weekly': {
      const { hour, minute } = parseTime(schedule.time)
      return scanDays(after, timeZone, (date) => schedule.weekdays.includes(date.weekday), [hour], [minute])
    }
    case 'cron': {
      const cron = parseCron(schedule.expression)
      return scanDays(after, timeZone, (date) => cronDayMatches(cron, date), cron.hours, cron.minutes, cron.months)
    }
  }
}

function scanDays(
  after: number,
  timeZone: string,
  dayMatches: (date: LocalDate & { weekday: number }) => boolean,
  hours: readonly number[],
  minutes: readonly number[],
  months?: ReadonlySet<number>,
): number | null {
  const start = localDate(after, timeZone)
  for (let offset = 0; offset < 366 * 5; offset += 1) {
    const date = addDays(start, offset)
    if (months !== undefined && !months.has(date.month)) continue
    if (!dayMatches(date)) continue
    for (const hour of hours) {
      for (const minute of minutes) {
        const at = zonedTime(date, hour, minute, timeZone)
        if (at > after) return at
      }
    }
  }
  return null
}

// ---------------------------------------------------------------- cron

interface Cron {
  readonly minutes: number[]
  readonly hours: number[]
  readonly days: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  readonly weekdays: ReadonlySet<number>
  readonly daysRestricted: boolean
  readonly weekdaysRestricted: boolean
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function field(text: string, min: number, max: number, names?: readonly string[]): number[] {
  const values = new Set<number>()
  for (const part of text.toLowerCase().split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) throw new ScheduleError(`bad step in "${text}"`)
    const value = (token: string) => {
      const named = names?.indexOf(token) ?? -1
      const number = named >= 0 ? named + (min === 1 ? 1 : 0) : Number(token)
      if (!Number.isInteger(number) || number < min || number > max) throw new ScheduleError(`"${token}" is out of range ${min}-${max}`)
      return number
    }
    let low = min
    let high = max
    if (range !== '*' && range !== undefined) {
      const [a, b] = range.split('-')
      low = value(a!)
      high = b === undefined ? (stepText === undefined ? low : max) : value(b)
    }
    for (let current = low; current <= high; current += step) values.add(current)
  }
  return [...values].sort((a, b) => a - b)
}

export function parseCron(expression: string): Cron {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new ScheduleError('a cron expression has five fields: minute hour day-of-month month day-of-week')
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string]
  const weekdays = new Set(field(weekday, 0, 7, DAY_NAMES).map((value) => (value === 0 ? 7 : value)))
  return {
    minutes: field(minute, 0, 59),
    hours: field(hour, 0, 23),
    days: new Set(field(day, 1, 31)),
    months: new Set(field(month, 1, 12, MONTH_NAMES)),
    weekdays,
    daysRestricted: day !== '*',
    weekdaysRestricted: weekday !== '*',
  }
}

function cronDayMatches(cron: Cron, date: LocalDate & { weekday: number }): boolean {
  const dayOk = cron.days.has(date.day)
  const weekdayOk = cron.weekdays.has(date.weekday)
  if (cron.daysRestricted && cron.weekdaysRestricted) return dayOk || weekdayOk
  return dayOk && weekdayOk
}

// ---------------------------------------------------------------- summary

const WEEKDAY_PLURAL = ['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

/** How the panel describes a schedule: "Weekdays at 09:00", "Sundays at 02:00", "Every 30 minutes". */
export function describeSchedule(schedule: RoutineSchedule, timeZone: string): string {
  switch (schedule.kind) {
    case 'once': {
      const at = onceAt(schedule.at, timeZone)
      return `Once, ${new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at)}`
    }
    case 'interval':
      return schedule.everyMinutes % 60 === 0 ? `Every ${schedule.everyMinutes / 60 === 1 ? 'hour' : `${schedule.everyMinutes / 60} hours`}` : `Every ${schedule.everyMinutes} minutes`
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
