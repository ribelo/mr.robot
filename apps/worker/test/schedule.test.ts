import { describe, expect, it } from 'vitest'
import { describeSchedule, localDate, nextRun, parseCron, validateSchedule } from '../src/robot/schedule.ts'

const WARSAW = 'Europe/Warsaw'
const at = (iso: string) => Date.parse(iso)

describe('Routine schedules in the owner\'s time zone (robot-gbbt)', () => {
  it('runs daily at local time across the DST change', () => {
    const before = nextRun({ kind: 'daily', time: '09:00' }, WARSAW, at('2026-10-24T12:00:00Z'), 0)
    expect(new Date(before!).toISOString()).toBe('2026-10-25T08:00:00.000Z')
    const after = nextRun({ kind: 'daily', time: '09:00' }, WARSAW, before!, 0)
    expect(new Date(after!).toISOString()).toBe('2026-10-26T08:00:00.000Z')
  })

  it('runs weekly on ISO weekdays', () => {
    const next = nextRun({ kind: 'weekly', time: '02:00', weekdays: [7] }, WARSAW, at('2026-10-06T18:00:00Z'), 0)
    expect(localDate(next!, WARSAW)).toMatchObject({ weekday: 7, hour: 2, minute: 0, day: 11 })
  })

  it('reads cron with Vixie day semantics', () => {
    const next = nextRun({ kind: 'cron', expression: '30 7 1 * mon' }, WARSAW, at('2026-10-06T18:00:00Z'), 0)
    expect(localDate(next!, WARSAW)).toMatchObject({ weekday: 1, hour: 7, minute: 30, day: 12 })
    expect(parseCron('*/15 9-17 * * 1-5').minutes).toEqual([0, 15, 30, 45])
    expect(() => parseCron('61 * * * *')).toThrow()
  })

  it('keeps interval runs aligned to the anchor and refuses past one-shots', () => {
    const anchor = at('2026-10-06T10:00:00Z')
    expect(nextRun({ kind: 'interval', everyMinutes: 30 }, WARSAW, at('2026-10-06T10:31:00Z'), anchor)).toBe(at('2026-10-06T11:00:00Z'))
    expect(() => validateSchedule({ kind: 'once', at: '2020-01-01T09:00' }, WARSAW, Date.now())).toThrow('future')
    expect(nextRun({ kind: 'once', at: '2026-10-07T09:00' }, WARSAW, at('2026-10-06T00:00:00Z'), 0)).toBe(at('2026-10-07T07:00:00Z'))
  })

  it('describes schedules the way the panel shows them (robot-qyd5)', () => {
    expect(describeSchedule({ kind: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] }, WARSAW)).toBe('Weekdays at 09:00')
    expect(describeSchedule({ kind: 'weekly', time: '02:00', weekdays: [7] }, WARSAW)).toBe('Sundays at 02:00')
    expect(describeSchedule({ kind: 'interval', everyMinutes: 30 }, WARSAW)).toBe('Every 30 minutes')
  })
})
