import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RoutineView } from '@mr-robot/protocol'
import { tool } from './define.ts'

/** What a Routine request may carry: the new or changed content and exactly one timing. */
export interface RoutineChange {
  readonly id?: string
  readonly title?: string
  readonly prompt?: string
  readonly at?: unknown
  readonly after_seconds?: number
  readonly every_seconds?: number
  readonly daily?: { time: string; time_zone?: string }
  readonly weekly?: { time: string; time_zone?: string; weekdays: number[] }
  readonly cron?: { expression: string; time_zone?: string }
}

/**
 * The Routines a Robot may change: its own, and, for Mr. Robot only, those of another Robot his owner
 * reaches (robot_id). One implementation serves both, so the validation and the limits are the same.
 */
export interface RoutinesHost {
  set(robotId: string | undefined, change: RoutineChange): Promise<RoutineView>
  list(robotId: string | undefined): Promise<RoutineView[]>
  pause(robotId: string | undefined, id: string, paused: boolean): Promise<RoutineView>
  /** `name` is the title of the deleted Routine when it is known. */
  delete(robotId: string | undefined, id: string): Promise<{ deleted: string; name?: string }>
}

const robotId = { type: 'string', description: 'Id of another Robot (from robot_list); only Mr. Robot may give it. Omit it for your own Routines.' }
const zone = "time_zone is an IANA zone and defaults to the Robot's own"

/** The tool group `routines`: the same four tools for every Robot with the Grant. */
export function routineTools(host: RoutinesHost): ToolDefinition[] {
  return [
    tool<{ robot_id?: string }>({
      name: 'routine_list',
      description: 'List Routines: schedule, instructions, paused or not, next run, and the last 20 runs of each (started, finished, outcome ok, failed or skipped, first line of its reply). Without robot_id they are your own; with it (Mr. Robot only) they are the Routines of that Robot.',
      parameters: { properties: { robot_id: robotId } },
      concurrencySafe: true,
      execute: async ({ robot_id }) => host.list(robot_id),
    }),
    tool<RoutineChange & { robot_id?: string }>({
      name: 'routine_set',
      description: `Create or edit a Routine. Without id: needs title, prompt (what you are told when it runs; make it self-contained) and exactly one timing. With id: changes the title, prompt or timing you give. Timings: at (ISO 8601 with offset, one run), after_seconds (one run, at least 60), every_seconds (at least 300), daily {time: "HH:MM:SS"}, weekly {time, weekdays: [1..7]}, cron {expression}; ${zone}. A Robot has at most 50 Routines and none may run more often than every 5 minutes. Without robot_id the Routine is your own; with it (Mr. Robot only) it is a Routine of that Robot, and its Conversation shows "Routine created by <you>".`,
      parameters: {
        properties: {
          robot_id: robotId, id: { type: 'string', description: 'The Routine to edit; omit to create' }, title: { type: 'string', description: 'Short name of the Routine' }, prompt: { type: 'string', description: 'What the Robot is told when the Routine runs' },
          at: { type: 'string', description: 'One run at this ISO 8601 time with offset' }, after_seconds: { type: 'integer', description: 'One run after this many seconds, at least 60' }, every_seconds: { type: 'integer', description: 'Run every this many seconds, at least 300' },
          daily: { type: 'object', properties: { time: { type: 'string' }, time_zone: { type: 'string' } }, required: ['time'], description: `Run every day at time (HH:MM:SS); ${zone}` },
          weekly: { type: 'object', properties: { time: { type: 'string' }, time_zone: { type: 'string' }, weekdays: { type: 'array', items: { type: 'integer' } } }, required: ['time', 'weekdays'], description: `Run on weekdays (1 Monday to 7 Sunday) at time; ${zone}` },
          cron: { type: 'object', properties: { expression: { type: 'string' }, time_zone: { type: 'string' } }, required: ['expression'], description: `Run on a five-field cron expression; ${zone}` },
        },
      },
      execute: async ({ robot_id, ...change }) => host.set(robot_id, change),
    }),
    tool<{ robot_id?: string; id: string; paused?: boolean }>({
      name: 'routine_pause',
      description: 'Pause a Routine (paused true, the default) or resume it (paused false). A resumed recurring Routine skips what it missed. Without robot_id the Routine is your own; with it (Mr. Robot only) it is a Routine of that Robot.',
      parameters: { properties: { robot_id: robotId, id: { type: 'string', description: 'Routine id from routine_list' }, paused: { type: 'boolean', description: 'true pauses (the default), false resumes' } }, required: ['id'] },
      execute: async ({ robot_id, id, paused }) => host.pause(robot_id, id, paused ?? true),
    }),
    tool<{ robot_id?: string; id: string }>({
      name: 'routine_delete',
      description: 'Delete a Routine, with its run history. Without robot_id the Routine is your own; with it (Mr. Robot only) it is a Routine of that Robot.',
      parameters: { properties: { robot_id: robotId, id: { type: 'string', description: 'Routine id from routine_list' } }, required: ['id'] },
      execute: async ({ robot_id, id }) => host.delete(robot_id, id),
    }),
  ]
}
