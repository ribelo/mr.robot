/** Routines: DSH's schedule tools over the Robot's alarm. */
import z from '@deepseek-ai/schemastery'
import { schedulePlugin, SCHEDULE_TOOL_NAMES, type AlarmSchedule } from '../agent/schedule.ts'
import { capability } from './define.ts'

export const Routines = capability<{ schedule: AlarmSchedule }>({
  name: 'routines',
  Config: z.object({ schedule: z.any().required() }) as never,
  seams: (ctx, { schedule }) => schedulePlugin(schedule)(ctx),
  extraToolNames: [...SCHEDULE_TOOL_NAMES],
})
