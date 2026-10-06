import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RoutineSchedule } from '@mr-robot/protocol'
import type { RoutineHost } from '../host.ts'
import { tool } from './define.ts'

const scheduleProperties = {
  kind: { type: 'string', enum: ['once', 'interval', 'daily', 'weekly', 'cron'] },
  at: { type: 'string', description: 'once: local date and time YYYY-MM-DDTHH:MM' },
  everyMinutes: { type: 'integer', description: 'interval: minutes between runs (at least 5)' },
  time: { type: 'string', description: 'daily/weekly: local time HH:MM' },
  weekdays: { type: 'array', items: { type: 'integer' }, description: 'weekly: ISO weekdays, Monday 1 ... Sunday 7' },
  expression: { type: 'string', description: 'cron: five fields, minute hour day-of-month month day-of-week' },
}

interface ScheduleArgs {
  kind?: string
  at?: string
  everyMinutes?: number
  time?: string
  weekdays?: number[]
  expression?: string
}

function schedule(args: ScheduleArgs): RoutineSchedule {
  switch (args.kind) {
    case 'once': return { kind: 'once', at: String(args.at ?? '') }
    case 'interval': return { kind: 'interval', everyMinutes: Number(args.everyMinutes) }
    case 'daily': return { kind: 'daily', time: String(args.time ?? '') }
    case 'weekly': return { kind: 'weekly', time: String(args.time ?? ''), weekdays: (args.weekdays ?? []).map(Number) }
    case 'cron': return { kind: 'cron', expression: String(args.expression ?? '') }
    default: throw new Error('schedule kind must be once, interval, daily, weekly or cron')
  }
}

/** Routines the Robot owns (robot-yrw7, robot-gbbt): times are in its owner's time zone. */
export function routineTools(host: RoutineHost, timeZone: string): ToolDefinition[] {
  const zone = `Times are in your owner's time zone, ${timeZone}.`
  return [
    tool<{ name: string; prompt: string } & ScheduleArgs>({
      name: 'routine_create',
      description: `Create a Routine: a schedule that wakes you with its prompt. Use it when your owner says "every week", "tomorrow at 9", "check daily". ${zone} The prompt is what you will be told when it runs; make it self-contained.`,
      parameters: { properties: { name: { type: 'string' }, prompt: { type: 'string' }, ...scheduleProperties }, required: ['name', 'prompt', 'kind'] },
      execute: async ({ name, prompt, ...rest }) => host.createRoutine({ name, prompt, schedule: schedule(rest) }),
    }),
    tool<{ id: string; name?: string; prompt?: string } & ScheduleArgs>({
      name: 'routine_update',
      description: `Change a Routine's name, prompt or schedule (give the full new schedule). ${zone}`,
      parameters: { properties: { id: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' }, ...scheduleProperties }, required: ['id'] },
      execute: async ({ id, name, prompt, ...rest }) => host.updateRoutine(id, {
        ...(name === undefined ? {} : { name }),
        ...(prompt === undefined ? {} : { prompt }),
        ...(rest.kind === undefined ? {} : { schedule: schedule(rest) }),
      }),
    }),
    tool<{ id: string }>({
      name: 'routine_delete',
      description: 'Delete one of your Routines.',
      parameters: { properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async ({ id }) => host.deleteRoutine(id),
    }),
    tool<Record<string, never>>({
      name: 'routine_list',
      description: 'List your Routines with their next run.',
      parameters: { properties: {} },
      concurrencySafe: true,
      execute: async () => host.listRoutines(),
    }),
  ]
}
