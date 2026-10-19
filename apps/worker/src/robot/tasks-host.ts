/**
 * The Task tools of every Robot (v1.13 ticket 04): the boundary where a tool call's text (an assignee as
 * "owner" or "member:Ben", a moment as ISO 8601) becomes the Home's typed input, and a TaskView becomes what
 * the model reads. Without robot_id the call works as this Robot; with it, and only for Mr. Robot, as one of
 * his staff by that Robot's rules (the deputy's reach checks), recorded as Mr. Robot.
 */
import * as Effect from 'effect/Effect'
import type { Actor, MemberView, RobotSummary, TaskAssignee, TaskInput, TaskTimingInput, TaskView } from '@mr-robot/protocol'
import type { TaskCreateArgs, TaskTimingArgs, TaskUpdateArgs, TasksHost } from '../agent/tools/tasks.ts'
import type { TaskCaller } from '../home/tasks.ts'
import { HOME_ID } from '../env.ts'
import { invalid, type DurableError } from '../platform/durable.ts'
import * as Deputy from './deputy.ts'
import { RobotPlatform, RobotState } from './programs.ts'
import { onceAt } from './schedule.ts'

type R = RobotState | RobotPlatform

/** What the Task tools need of the running Turn: its subject, and the result line of the Task it finished. */
export interface TaskTurn {
  focus(taskId: string | null, reason: string): Promise<{ ok: true; title: string | null } | { ok: false; reason: string }>
  /** task_done on the Turn's own Task gives its attempt this line. */
  doneLine(taskId: string, line: string): void
}

const promise = <A>(run: () => Promise<A>) => Effect.promise(run)

/** A call to the Home whose refusal (Invalid, NotFound, Conflict) is the tool's error, in the Home's words. */
const home = <A>(run: (stub: DurableObjectStub<import('../home/home.ts').Home>) => Promise<A>) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  return yield* Effect.tryPromise({ try: () => run(platform.env.HOME.getByName(HOME_ID)), catch: (error) => invalid(error instanceof Error ? error.message : String(error)) })
})

interface Acting {
  readonly caller: Extract<TaskCaller, { kind: 'robot' }>
  readonly zone: string
  /** Mr. Robot's name when he works as one of his staff. */
  readonly deputy: boolean
}

/** Who a call works as: this Robot, or (robot_id, Mr. Robot only) one of the Robots his owner reaches. */
const acting = (robotId: string | undefined, change: boolean): Effect.Effect<Acting, DurableError, R> => Effect.gen(function* () {
  const current = (yield* RobotState).config()
  if (current === undefined) return yield* invalid('robot is not initialised')
  const actor: Actor = { kind: 'robot', robotId: current.id, name: current.identity.name, avatarColor: current.identity.avatarColor, avatarSeed: current.identity.avatarSeed }
  if (robotId === undefined || robotId === current.id) return { caller: { kind: 'robot', robotId: current.id, ownerId: current.ownerId, actor }, zone: current.timeZone, deputy: false }
  if (current.kind !== 'mr-robot') return yield* invalid('only Mr. Robot can use robot_id; leave it out to work on your own Tasks')
  const { entry } = yield* Deputy.reach(robotId, change)
  return { caller: { kind: 'robot', robotId: entry.id, ownerId: entry.ownerId, actor }, zone: current.timeZone, deputy: true }
})

/** "self", "owner", "nobody", "robot:<id>", "member:<id, name or e-mail>" as the Home's assignee. */
const parseAssignee = (text: string, caller: Acting['caller']) => Effect.gen(function* () {
  const value = text.trim()
  if (value === 'self' || value === 'me') return { kind: 'robot', robotId: caller.robotId } satisfies TaskAssignee
  if (value === 'owner') return { kind: 'member', memberId: caller.ownerId } satisfies TaskAssignee
  if (value === 'nobody') return { kind: 'nobody' } satisfies TaskAssignee
  const [kind, ...rest] = value.split(':')
  const id = rest.join(':').trim()
  if (kind === 'robot' && id !== '') return { kind: 'robot', robotId: id } satisfies TaskAssignee
  if (kind === 'member' && id !== '') {
    const members = (yield* home((stub) => stub.members())).filter((member) => member.status === 'active')
    const wanted = id.toLowerCase()
    const found = members.filter((member) => member.id === id || member.email.toLowerCase() === wanted || member.name.toLowerCase() === wanted)
    if (found.length === 1) return { kind: 'member', memberId: found[0]!.id } satisfies TaskAssignee
    return yield* invalid(found.length === 0 ? `No active Member "${id}" in this Home.` : `More than one Member is called "${id}"; give their e-mail.`)
  }
  return yield* invalid('assignee is "self", "owner", "nobody", "robot:<id>" or "member:<name or e-mail>"')
})

const moment = (text: string, zone: string, field: string) => Effect.try({
  try: () => onceAt(text, zone),
  catch: () => invalid(`${field} is an ISO 8601 moment, like 2026-10-23T18:00 (local in ${zone}) or 2026-10-23T16:00Z`),
})

/** A tool's timing as the Home's input; exactly one rule for a recurring Task. */
const parseTiming = (args: TaskTimingArgs, zone: string) => Effect.gen(function* () {
  const at = (text: string | undefined, field: string) => (text === undefined ? Effect.succeed(undefined) : moment(text, args.time_zone ?? zone, field))
  const deadline = yield* at(args.deadline, 'deadline')
  switch (args.kind) {
    case 'unscheduled': return { kind: 'unscheduled', deadline: deadline ?? null } satisfies TaskTimingInput
    case 'scheduled': {
      if (args.at === undefined) return yield* invalid('a scheduled Task needs at')
      return { kind: 'scheduled', at: (yield* at(args.at, 'at'))!, deadline: deadline ?? null } satisfies TaskTimingInput
    }
    case 'recurring': {
      const rules = [
        ...(args.every_minutes === undefined ? [] : [{ kind: 'interval' as const, everyMinutes: args.every_minutes }]),
        ...(args.daily === undefined ? [] : [{ kind: 'daily' as const, time: args.daily.time.slice(0, 5) }]),
        ...(args.weekly === undefined ? [] : [{ kind: 'weekly' as const, time: args.weekly.time.slice(0, 5), weekdays: [...args.weekly.weekdays] }]),
        ...(args.cron === undefined ? [] : [{ kind: 'cron' as const, expression: args.cron.expression }]),
      ]
      if (rules.length !== 1) return yield* invalid('a recurring Task needs exactly one of every_minutes, daily, weekly or cron')
      return { kind: 'recurring', schedule: rules[0]!, timeZone: args.time_zone ?? zone, ...(deadline === undefined ? {} : { deadline }) } satisfies TaskTimingInput
    }
    default: return yield* invalid('timing.kind is unscheduled, scheduled or recurring')
  }
})

/** A local wall-clock moment the model reads easily: "2026-10-23 18:00". */
function local(at: number | null, zone: string): string | null {
  if (at === null) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map((part) => [part.type, part.value]))
  return `${parts['year']}-${parts['month']}-${parts['day']} ${parts['hour']}:${parts['minute']}`
}

interface Names { readonly members: ReadonlyMap<string, string>; readonly robots: ReadonlyMap<string, string> }

const names = (ownerId: string) => Effect.gen(function* () {
  const [members, robots] = yield* Effect.all([home((stub) => stub.members() as Promise<MemberView[]>), home((stub) => stub.reachable(ownerId) as Promise<RobotSummary[]>)])
  return { members: new Map(members.map((member) => [member.id, member.name])), robots: new Map(robots.map((robot) => [robot.id, robot.identity.name])) } as Names
})

/** A Task as the model reads it: names instead of ids where it helps, moments local in the zone. */
function shown(task: TaskView, caller: Acting['caller'], zone: string, known: Names) {
  const who = (assignee: TaskAssignee): string => {
    switch (assignee.kind) {
      case 'nobody': return 'nobody'
      case 'robot': return assignee.robotId === caller.robotId ? 'self' : `robot:${assignee.robotId} (${known.robots.get(assignee.robotId) ?? 'a Robot'})`
      case 'member': return assignee.memberId === caller.ownerId ? `owner (${known.members.get(assignee.memberId) ?? 'your owner'})` : `member:${known.members.get(assignee.memberId) ?? assignee.memberId}`
    }
  }
  const timing = task.timing
  return {
    id: task.id, title: task.title, instructions: task.instructions, state: task.state, assignee: who(task.assignee), parent_id: task.parentId,
    timing: timing.kind === 'unscheduled' ? { kind: 'unscheduled', deadline: local(timing.deadline, zone) }
      : timing.kind === 'scheduled' ? { kind: 'scheduled', at: local(timing.at, zone), deadline: local(timing.deadline, zone) }
        : { kind: 'recurring', schedule: timing.schedule, time_zone: timing.timeZone, next: local(timing.next, timing.timeZone), paused: timing.paused },
    remind_minutes: task.remind.kind === 'before' ? task.remind.minutes : null,
    overdue: task.overdue, children: task.children,
    created_by: task.createdBy.kind === 'platform' ? 'platform' : task.createdBy.name,
    last_attempts: task.attempts.slice(0, 3).map((attempt) => ({ started: local(attempt.startedAt, zone), outcome: attempt.outcome, first_line: attempt.firstLine })),
  }
}

const one = (who: Acting, task: TaskView) => Effect.map(names(who.caller.ownerId), (known) => ({ ...shown(task, who.caller, who.zone, known), time_zone: who.zone }))

const remindOf = (minutes: number | null | undefined) => (minutes === undefined ? {} : { remind: minutes === null ? { kind: 'none' as const } : { kind: 'before' as const, minutes: Math.max(0, Math.round(minutes)) } })

const list = (robotId: string | undefined, filter: { readonly assignee?: string; readonly state?: string }) => Effect.gen(function* () {
  const who = yield* acting(robotId, false)
  const state = filter.state === undefined ? 'open' : filter.state
  if (!['open', 'done', 'cancelled', 'all'].includes(state)) return yield* invalid('state is open, done, cancelled or all')
  const assignee = filter.assignee === undefined || filter.assignee === 'all' ? undefined : yield* parseAssignee(filter.assignee, who.caller)
  const page = yield* home((stub) => stub.listTasks(who.caller, { state: state as 'open', ...(assignee === undefined ? {} : { assignee }) }))
  const known = yield* names(who.caller.ownerId)
  return { time_zone: who.zone, tasks: page.tasks.map((task) => shown(task, who.caller, who.zone, known)), more: page.next !== null }
})

const create = (robotId: string | undefined, args: TaskCreateArgs) => Effect.gen(function* () {
  const who = yield* acting(robotId, true)
  const input: TaskInput = {
    title: args.title.trim(), ...(args.instructions === undefined ? {} : { instructions: args.instructions }),
    assignee: yield* parseAssignee(args.assignee, who.caller),
    ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
    ...(args.timing === undefined ? {} : { timing: yield* parseTiming(args.timing, who.zone) }),
    ...remindOf(args.remind_minutes),
  }
  if (input.title === '') return yield* invalid('title must not be empty')
  return yield* one(who, yield* home((stub) => stub.createTask(who.caller, input)))
})

const update = (robotId: string | undefined, taskId: string, args: TaskUpdateArgs) => Effect.gen(function* () {
  const who = yield* acting(robotId, true)
  const patch = {
    ...(args.title === undefined ? {} : { title: args.title.trim() }),
    ...(args.instructions === undefined ? {} : { instructions: args.instructions }),
    ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
    ...(args.timing === undefined ? {} : { timing: yield* parseTiming(args.timing, who.zone) }),
    ...remindOf(args.remind_minutes),
  }
  return yield* one(who, yield* home((stub) => stub.updateTask(who.caller, taskId, patch)))
})

export function tasksHost(run: Deputy.Run, turn: TaskTurn): TasksHost {
  const act = <A>(program: Effect.Effect<A, DurableError, R>) => Deputy.plain(run(program))
  const change = (robotId: string | undefined, call: (who: Acting) => Effect.Effect<TaskView, DurableError, R>) =>
    act(Effect.gen(function* () {
      const who = yield* acting(robotId, true)
      return yield* one(who, yield* call(who))
    }))
  return {
    list: (robotId, filter) => act(list(robotId, filter)),
    create: (robotId, input) => act(create(robotId, input)),
    update: (robotId, taskId, patch) => act(update(robotId, taskId, patch)),
    assign: (robotId, taskId, text) => change(robotId, (who) => Effect.flatMap(parseAssignee(text, who.caller), (assignee) => home((stub) => stub.assignTask(who.caller, taskId, assignee)))),
    focus: async (taskId, reason) => {
      const focused = await turn.focus(taskId, reason)
      if (!focused.ok) throw new Error(focused.reason)
      return taskId === null ? { focused: null } : { focused: taskId, title: focused.title }
    },
    done: (robotId, taskId, firstLine) => change(robotId, (who) => Effect.gen(function* () {
      if (!who.deputy && firstLine !== undefined && firstLine.trim() !== '') turn.doneLine(taskId, firstLine.trim())
      return yield* home((stub) => stub.finishTask(who.caller, taskId))
    })),
    cancel: (robotId, taskId) => change(robotId, (who) => home((stub) => stub.cancelTask(who.caller, taskId))),
    pause: (robotId, taskId, paused) => change(robotId, (who) => home((stub) => stub.pauseTask(who.caller, taskId, paused))),
  }
}
