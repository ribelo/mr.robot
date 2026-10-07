/**
 * DSH's schedule update rule (packages/schedule/schedule/src/update.ts, MIT), restated over the
 * published package's exports: the published build does not export resolveScheduleUpdate or the
 * input parsers it uses. Same contract: the caller's complete expected record must match; an
 * omitted name, instruction or timing keeps the stored one; an equivalent timing keeps the
 * committed target; any other timing re-anchors exactly as creation does.
 */
import {
  createAtScheduleRecord, createCronScheduleRecord, createDailyScheduleRecord, createEveryScheduleRecord, createWeeklyScheduleRecord,
  decodeScheduleRecord, ScheduleInputError, ScheduleLogError, scheduleTitle,
  type ScheduleRecord, type ScheduleTimingChange, type ScheduleUpdateContent, type ScheduleUpdateResult,
} from '@deepseek-ai/dsh-schedule'

/** Deep equality for plain JSON records, independent of key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** The rule of a record without its target and content. */
function rule(record: ScheduleRecord): string {
  const { scheduledAt: _target, title: _title, prompt: _prompt, id: _id, ...rest } = record as ScheduleRecord & Record<string, unknown>
  return canonical(record.kind === 'after' || record.kind === 'at' ? { kind: 'once', at: record.scheduledAt } : rest)
}

function changedRecord(current: ScheduleRecord, title: string, prompt: string, change: ScheduleTimingChange | undefined, now: number): ScheduleRecord {
  const withContent = (): ScheduleRecord => (title === current.title && prompt === current.prompt ? current : Object.freeze({ ...current, title, prompt }))
  if (change === undefined) return withContent()
  if (typeof change !== 'object' || change === null || Array.isArray(change)) throw new ScheduleInputError('invalid_rule', 'Timing change must be an object with exactly one supported timing selector.')
  const next: ScheduleRecord = (() => {
    switch (change.kind) {
      case 'at': return createAtScheduleRecord(current.id, prompt, change.at, now, title)
      case 'every': return createEveryScheduleRecord(current.id, prompt, change.every_seconds, now, title)
      case 'daily': return createDailyScheduleRecord(current.id, prompt, change.daily, now, title)
      case 'weekly': return createWeeklyScheduleRecord(current.id, prompt, change.weekly, now, title)
      case 'cron': return createCronScheduleRecord(current.id, prompt, change.cron, now, title)
      default: throw new ScheduleInputError('invalid_rule', 'Timing change must contain exactly kind and its matching timing selector.')
    }
  })()
  return rule(next) === rule(current) ? withContent() : next
}

export function resolveScheduleUpdate(current: ScheduleRecord, expected: ScheduleRecord, change: ScheduleTimingChange | undefined, now: number, content: ScheduleUpdateContent = {}): ScheduleUpdateResult {
  let decoded: ScheduleRecord
  try {
    decoded = decodeScheduleRecord(expected)
  } catch (error) {
    if (!(error instanceof ScheduleLogError)) throw error
    return { code: 'invalid_rule', message: 'expected must be a complete valid Schedule record.' }
  }
  if (canonical(current) !== canonical(decoded)) return { id: current.id, updated: false, code: 'schedule_conflict' }
  try {
    const title = content.title === undefined ? current.title : scheduleTitle(content.title)
    if (content.prompt !== undefined && (typeof content.prompt !== 'string' || content.prompt.trim() === '')) throw new ScheduleInputError('invalid_prompt', 'prompt must be non-empty after trimming.')
    const prompt = content.prompt === undefined ? current.prompt : content.prompt.trim()
    const record = changedRecord(current, title, prompt, change, now)
    return { id: current.id, updated: record !== current, record }
  } catch (error) {
    if (!(error instanceof ScheduleInputError)) throw error
    return { code: error.code, message: error.message }
  }
}
