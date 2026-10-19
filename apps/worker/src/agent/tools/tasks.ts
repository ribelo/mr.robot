import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

/** A timing as a Robot gives it: moments as ISO 8601 text (with an offset, or local in the zone), a recurring rule by one of its fields. */
export interface TaskTimingArgs {
  readonly kind: 'unscheduled' | 'scheduled' | 'recurring'
  readonly at?: string
  readonly deadline?: string
  readonly every_minutes?: number
  readonly daily?: { readonly time: string }
  readonly weekly?: { readonly time: string; readonly weekdays: readonly number[] }
  readonly cron?: { readonly expression: string }
  readonly time_zone?: string
}

export interface TaskCreateArgs {
  readonly title: string
  readonly instructions?: string
  readonly assignee: string
  readonly parent_id?: string
  readonly timing?: TaskTimingArgs
  readonly remind_minutes?: number
}

export interface TaskUpdateArgs {
  readonly title?: string
  readonly instructions?: string
  readonly parent_id?: string | null
  readonly timing?: TaskTimingArgs
  readonly remind_minutes?: number | null
}

/**
 * The Tasks a Robot may read and change (v1.13 ticket 04): those its owner sees. With robot_id, and only for
 * Mr. Robot, a call works as one of his staff: by that Robot's rules, recorded as Mr. Robot. One host serves
 * both, so the rules and limits are the same.
 */
export interface TasksHost {
  list(robotId: string | undefined, filter: { readonly assignee?: string; readonly state?: string }): Promise<unknown>
  create(robotId: string | undefined, input: TaskCreateArgs): Promise<unknown>
  update(robotId: string | undefined, taskId: string, patch: TaskUpdateArgs): Promise<unknown>
  assign(robotId: string | undefined, taskId: string, assignee: string): Promise<unknown>
  /** The running Turn works on this Task (once per Turn). */
  focus(taskId: string | null, reason: string): Promise<unknown>
  done(robotId: string | undefined, taskId: string, firstLine: string | undefined): Promise<unknown>
  cancel(robotId: string | undefined, taskId: string): Promise<unknown>
  pause(robotId: string | undefined, taskId: string, paused: boolean): Promise<unknown>
}

const robotId = { type: 'string', description: 'Id of another Robot (from robot_list); only Mr. Robot may give it, to work as that Robot. Omit it for your own work.' }
const taskId = { type: 'string', description: 'Task id from task_list' }
const assignee = {
  type: 'string',
  description: 'Who does it: "self" (you), "owner" (your owner), "nobody", "robot:<id>" (one of your owner\'s Robots), or "member:<name or e-mail>" (another Member of the Home, only when they accept Tasks from your owner\'s Robots).',
}
const timing = {
  type: 'object',
  description: 'When the doer is woken. unscheduled: on the list, with an optional deadline. scheduled: at a moment, with an optional deadline not before it. recurring: one rule of every_minutes (at least 5), daily, weekly or cron; no deadline (put preparation in a child Task with its own date). Moments are ISO 8601, with an offset or local in time_zone, which defaults to your owner\'s.',
  properties: {
    kind: { type: 'string', enum: ['unscheduled', 'scheduled', 'recurring'] },
    at: { type: 'string', description: 'scheduled: when it starts' },
    deadline: { type: 'string', description: 'unscheduled or scheduled: by when it must be done' },
    every_minutes: { type: 'integer', description: 'recurring: every N minutes, at least 5' },
    daily: { type: 'object', properties: { time: { type: 'string', description: 'HH:MM' } }, required: ['time'] },
    weekly: { type: 'object', properties: { time: { type: 'string', description: 'HH:MM' }, weekdays: { type: 'array', items: { type: 'integer' }, description: '1 Monday to 7 Sunday' } }, required: ['time', 'weekdays'] },
    cron: { type: 'object', properties: { expression: { type: 'string', description: 'five fields' } }, required: ['expression'] },
    time_zone: { type: 'string', description: 'IANA zone' },
  },
  required: ['kind'],
}
const remind = { type: 'integer', description: 'For a Task of a person with a moment: remind them this many minutes before by push, without waking a Robot.' }

/** The tool group `tasks`: the same eight tools for every Robot with the Grant. */
export function taskTools(host: TasksHost): ToolDefinition[] {
  return [
    tool<{ robot_id?: string; assignee?: string; state?: string }>({
      name: 'task_list',
      description: 'List the Tasks you may see: your owner\'s, yours, those of your owner\'s other Robots, and unassigned ones your owner or their Robots made. Each has its timing, state, overdue mark, children and last attempts. Filter by assignee ("self", "owner", "nobody", "robot:<id>", "member:<name>") and state (open, the default; done; cancelled; all).',
      parameters: { properties: { robot_id: robotId, assignee: { type: 'string', description: 'Only Tasks of this doer' }, state: { type: 'string', enum: ['open', 'done', 'cancelled', 'all'], description: 'open (the default), done, cancelled or all' } } },
      concurrencySafe: true,
      execute: async ({ robot_id, ...filter }) => host.list(robot_id, filter),
    }),
    tool<TaskCreateArgs & { robot_id?: string }>({
      name: 'task_create',
      description: 'Create a Task: a title, instructions (what the doer is told when it is woken; for a Robot write them for a Turn that starts cold: what to do, which files to read, when to tell your owner), a doer and a timing. A Robot has at most 50 scheduled or recurring Tasks, none recurring more often than every 5 minutes. A Task can sit under a parent Task (parent_id).',
      parameters: {
        properties: {
          robot_id: robotId, title: { type: 'string', description: 'Short name of the Task' }, instructions: { type: 'string', description: 'What the doer is told when it is woken' }, assignee,
          parent_id: { type: 'string', description: 'The parent Task' }, timing, remind_minutes: remind,
        },
        required: ['title', 'assignee'],
      },
      execute: async ({ robot_id, ...input }) => host.create(robot_id, input),
    }),
    tool<TaskUpdateArgs & { robot_id?: string; task_id: string }>({
      name: 'task_update',
      description: 'Change a Task\'s title, instructions, parent (null takes it out), timing or reminder. Use task_assign for the doer, task_done, task_cancel and task_pause for its state.',
      parameters: {
        properties: {
          robot_id: robotId, task_id: taskId, title: { type: 'string', description: 'The new title' }, instructions: { type: 'string', description: 'The new instructions' },
          parent_id: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'The new parent Task; null takes the Task out of its parent' }, timing, remind_minutes: { oneOf: [{ type: 'integer' }, { type: 'null' }], description: `${remind.description} null removes the reminder.` },
        },
        required: ['task_id'],
      },
      execute: async ({ robot_id, task_id, ...patch }) => host.update(robot_id, task_id, patch),
    }),
    tool<{ robot_id?: string; task_id: string; assignee: string }>({
      name: 'task_assign',
      description: 'Give a Task to another doer. Refused while a Robot works on it.',
      parameters: { properties: { robot_id: robotId, task_id: taskId, assignee }, required: ['task_id', 'assignee'] },
      execute: async ({ robot_id, task_id, assignee: who }) => host.assign(robot_id, task_id, who),
    }),
    tool<{ task_id: string; reason: string }>({
      name: 'task_focus',
      description: 'Say which of your Tasks this Turn works on now, or none (task_id "none"): when a message and not its schedule started the work ("do the shopping now"), or when your owner redirected you. Call it again whenever the focus changes; the Task you leave ends its attempt as skipped with your reason.',
      parameters: {
        properties: {
          task_id: { type: 'string', description: 'The Task to work on now, or "none"' },
          reason: { type: 'string', description: 'Why the focus changes, in one line (for a Task you leave, its attempt line)' },
        },
        required: ['task_id', 'reason'],
      },
      execute: async ({ task_id, reason }) => host.focus(task_id === 'none' ? null : task_id, reason),
    }),
    tool<{ robot_id?: string; task_id: string; first_line?: string }>({
      name: 'task_done',
      description: 'Mark a Task done: the only way a Task becomes done. For a recurring Task it finishes this occurrence; the Task stays for the next. first_line is a one-line result for the attempt.',
      parameters: { properties: { robot_id: robotId, task_id: taskId, first_line: { type: 'string', description: 'One line on how it ended, for the attempt' } }, required: ['task_id'] },
      execute: async ({ robot_id, task_id, first_line }) => host.done(robot_id, task_id, first_line),
    }),
    tool<{ robot_id?: string; task_id: string }>({
      name: 'task_cancel',
      description: 'Cancel a Task: it is not done and will not be. A recurring Task ends this way.',
      parameters: { properties: { robot_id: robotId, task_id: taskId }, required: ['task_id'] },
      execute: async ({ robot_id, task_id }) => host.cancel(robot_id, task_id),
    }),
    tool<{ robot_id?: string; task_id: string; paused?: boolean }>({
      name: 'task_pause',
      description: 'Pause a recurring Task (paused true, the default) or resume it (paused false). A resumed Task skips what it missed.',
      parameters: { properties: { robot_id: robotId, task_id: taskId, paused: { type: 'boolean', description: 'true pauses (the default), false resumes' } }, required: ['task_id'] },
      execute: async ({ robot_id, task_id, paused }) => host.pause(robot_id, task_id, paused ?? true),
    }),
  ]
}
