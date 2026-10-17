/**
 * Tasks at the Home (v1.13, mc-t1aa…mc-t8hh): the one store of work for people and Robots. Tasks live in
 * the Home's SQLite beside the Robot registry, so who may see a Task (its creator, its assignee, the people who
 * reach its Robot) is one query. The programs here are Effects over that SQLite; what a change means
 * elsewhere (a Robot's next moment, a reminder, a card in a Conversation) goes out through TaskPorts.
 */
import * as Effect from 'effect/Effect'
import type { Actor, Attempt, AttemptOutcome, Remind, TaskAssignee, TaskExternal, TaskInput, TaskPage, TaskPatch, TaskState, TaskTiming, TaskView } from '@mr-robot/protocol'
import { conflict, invalid, notFound, Sql, type DurableError } from '../platform/durable.ts'
import { advanced, overdue, parseTiming, pausedTiming, wakeAt } from './task-timing.ts'

export const TASK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS task (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, instructions TEXT NOT NULL, created_by TEXT NOT NULL, creator_member TEXT,
    assignee_kind TEXT NOT NULL, assignee_id TEXT, parent_id TEXT, timing TEXT NOT NULL, wake_at INTEGER,
    remind TEXT NOT NULL, reminded_for INTEGER, state TEXT NOT NULL, external TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS task_by_assignee ON task (assignee_kind, assignee_id, state)',
  'CREATE INDEX IF NOT EXISTS task_by_parent ON task (parent_id)',
  'CREATE INDEX IF NOT EXISTS task_by_wake ON task (wake_at)',
  'CREATE INDEX IF NOT EXISTS task_by_state ON task (state, updated_at)',
  `CREATE TABLE IF NOT EXISTS task_attempt (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, robot_id TEXT NOT NULL,
    started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT NOT NULL, first_line TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS task_attempt_by_task ON task_attempt (task_id, started_at)',
] as const

/** Tasks per page of a list (mc-m3cc). */
export const TASK_PAGE_SIZE = 200
/** Attempts kept per Task (mc-t4dd). */
export const ATTEMPTS_KEPT = 20
/** Scheduled or recurring Tasks one Robot may have open (cd-d14a, mc-s6ff). */
export const MAX_TIMED_TASKS = 50

/**
 * Who asks: a Member (the Home admin with Whole Home sees every Task), or a Robot, which works by its
 * owner's rules. `actor` is who the change is recorded as: for Mr. Robot acting for one of his staff, himself.
 */
export type TaskCaller =
  | { readonly kind: 'member'; readonly memberId: string; readonly wholeHome: boolean; readonly actor: Actor }
  | { readonly kind: 'robot'; readonly robotId: string; readonly ownerId: string; readonly actor: Actor }

export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly instructions: string
  readonly createdBy: Actor
  /** The Member whose Task it is by creation: the person, or the owner of the Robot that made it. */
  readonly creatorMember: string | null
  readonly assignee: TaskAssignee
  readonly parentId: string | null
  readonly timing: TaskTiming
  /** When the Task next wakes its doer; null when it does not (done, paused, unscheduled, or a fired scheduled Task). */
  readonly wakeAt: number | null
  readonly remind: Remind
  /** The occurrence a person was last reminded of, so each is reminded once. */
  readonly remindedFor: number | null
  readonly state: TaskState
  readonly external: TaskExternal | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type TaskAction = 'created' | 'updated' | 'assigned' | 'done' | 'cancelled' | 'paused' | 'resumed' | 'ran'

/** A change to one Task, for what follows from it outside the Task store. */
export interface TaskChange {
  readonly action: TaskAction
  readonly before: TaskRow | null
  readonly after: TaskRow
  readonly actor: Actor
}

export interface TaskPorts {
  /** The zone a Member works in (the default zone of a recurring Task they give). */
  readonly zoneOf: (memberId: string) => Effect.Effect<string>
  /** The Members whose Robots may give this Member Tasks (mc-a1aa). */
  readonly acceptsFrom: (memberId: string) => Effect.Effect<readonly string[]>
  /** A Task changed: plan the doers' moments again, tell their Conversations. */
  readonly changed: (change: TaskChange) => Effect.Effect<void>
}

type TaskSql = {
  id: string; title: string; instructions: string; created_by: string; creator_member: string | null
  assignee_kind: TaskAssignee['kind']; assignee_id: string | null; parent_id: string | null; timing: string; wake_at: number | null
  remind: string; reminded_for: number | null; state: TaskState; external: string | null; created_at: number; updated_at: number
}

function assigneeOf(kind: TaskAssignee['kind'], id: string | null): TaskAssignee {
  switch (kind) {
    case 'member': return { kind: 'member', memberId: id ?? '' }
    case 'robot': return { kind: 'robot', robotId: id ?? '' }
    case 'nobody': return { kind: 'nobody' }
  }
}

export function assigneeId(assignee: TaskAssignee): string | null {
  return assignee.kind === 'member' ? assignee.memberId : assignee.kind === 'robot' ? assignee.robotId : null
}

export function taskFromSql(row: TaskSql): TaskRow {
  return {
    id: row.id, title: row.title, instructions: row.instructions, createdBy: JSON.parse(row.created_by) as Actor, creatorMember: row.creator_member,
    assignee: assigneeOf(row.assignee_kind, row.assignee_id), parentId: row.parent_id, timing: JSON.parse(row.timing) as TaskTiming,
    wakeAt: row.wake_at, remind: JSON.parse(row.remind) as Remind, remindedFor: row.reminded_for, state: row.state,
    external: row.external === null ? null : JSON.parse(row.external) as TaskExternal, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export const saveTask = (task: TaskRow) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run(
    `INSERT INTO task (id, title, instructions, created_by, creator_member, assignee_kind, assignee_id, parent_id, timing, wake_at, remind, reminded_for, state, external, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, instructions = excluded.instructions, assignee_kind = excluded.assignee_kind,
       assignee_id = excluded.assignee_id, parent_id = excluded.parent_id, timing = excluded.timing, wake_at = excluded.wake_at,
       remind = excluded.remind, reminded_for = excluded.reminded_for, state = excluded.state, external = excluded.external, updated_at = excluded.updated_at`,
    task.id, task.title, task.instructions, JSON.stringify(task.createdBy), task.creatorMember, task.assignee.kind, assigneeId(task.assignee),
    task.parentId, JSON.stringify(task.timing), task.wakeAt, JSON.stringify(task.remind), task.remindedFor, task.state,
    task.external === null ? null : JSON.stringify(task.external), task.createdAt, task.updatedAt,
  )
})

export const taskRow = (id: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<TaskSql>('SELECT * FROM task WHERE id = ?', id)
  return row === undefined ? undefined : taskFromSql(row)
})

// ------------------------------------------------------------------ who sees what (mc-r2bb, mc-m7gg)

/** The Member whose view a caller has: the person, or the Robot's owner. */
const viewerOf = (caller: TaskCaller): string => (caller.kind === 'member' ? caller.memberId : caller.ownerId)

/**
 * A Member sees a Task he created, one assigned to him, one assigned to a Robot he reaches, and an
 * unassigned one he or one of his Robots created. Whole Home (the admin's switch) sees all.
 */
function visibility(caller: TaskCaller): { readonly where: string; readonly bindings: readonly unknown[] } {
  if (caller.kind === 'member' && caller.wholeHome) return { where: '1 = 1', bindings: [] }
  const member = viewerOf(caller)
  return {
    where: `((t.creator_member = ? AND json_extract(t.created_by, '$.kind') = 'member')
      OR (t.assignee_kind = 'member' AND t.assignee_id = ?)
      OR (t.assignee_kind = 'robot' AND t.assignee_id IN (SELECT id FROM robot WHERE status != 'deleted' AND (owner_id = ? OR sharing = 'home')))
      OR (t.assignee_kind = 'nobody' AND t.creator_member = ?))`,
    bindings: [member, member, member, member],
  }
}

/** The Task, when the caller may see it; otherwise not found, as if it did not exist. */
export const visibleTask = (caller: TaskCaller, id: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const { where, bindings } = visibility(caller)
  const row = yield* sql.first<TaskSql>(`SELECT t.* FROM task t WHERE t.id = ? AND ${where}`, id, ...bindings)
  if (row === undefined) return yield* Effect.fail(notFound('no such Task'))
  return taskFromSql(row)
})

// ------------------------------------------------------------------ views

const attemptsOf = (ids: readonly string[]) => Effect.gen(function* () {
  const sql = yield* Sql
  const rows = ids.length === 0 ? [] : yield* sql.all<{ task_id: string; robot_id: string; started_at: number; finished_at: number | null; outcome: AttemptOutcome; first_line: string }>(
    'SELECT task_id, robot_id, started_at, finished_at, outcome, first_line FROM task_attempt WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY started_at DESC, id DESC',
    JSON.stringify(ids),
  )
  const byTask = new Map<string, Attempt[]>()
  for (const row of rows) {
    const list = byTask.get(row.task_id) ?? []
    if (list.length < ATTEMPTS_KEPT) list.push({ robotId: row.robot_id, startedAt: row.started_at, finishedAt: row.finished_at, outcome: row.outcome, firstLine: row.first_line })
    byTask.set(row.task_id, list)
  }
  return byTask
})

const childCounts = (ids: readonly string[]) => Effect.gen(function* () {
  const sql = yield* Sql
  const rows = ids.length === 0 ? [] : yield* sql.all<{ parent_id: string; n: number }>(
    'SELECT parent_id, COUNT(*) AS n FROM task WHERE parent_id IN (SELECT value FROM json_each(?)) GROUP BY parent_id', JSON.stringify(ids),
  )
  return new Map(rows.map((row) => [row.parent_id, row.n]))
})

/** Tasks as callers see them, with their attempts, children and overdue mark. */
export const taskViews = (rows: readonly TaskRow[], now = Date.now()) => Effect.gen(function* () {
  const ids = rows.map((row) => row.id)
  const [attempts, children] = [yield* attemptsOf(ids), yield* childCounts(ids)]
  return rows.map((row): TaskView => {
    const tried = attempts.get(row.id) ?? []
    return {
      id: row.id, title: row.title, instructions: row.instructions, createdBy: row.createdBy, assignee: row.assignee, parentId: row.parentId,
      timing: row.timing, remind: row.remind, state: row.state, external: row.external, createdAt: row.createdAt, updatedAt: row.updatedAt,
      attempts: tried, children: children.get(row.id) ?? 0, overdue: overdue(row.state, row.assignee, row.timing, tried, now),
    }
  })
})

const view = (row: TaskRow) => Effect.map(taskViews([row]), (views) => views[0]!)

export interface TaskFilter {
  /** Open by default (mc-m6ff). */
  readonly state?: TaskState | 'all'
  /** Words in the title. */
  readonly q?: string
  readonly parentId?: string
  readonly assignee?: TaskAssignee
  /** Rows of one group come together across pages (mc-m5ee). */
  readonly group?: 'assignee' | 'parent' | 'time'
  /** 1-based. */
  readonly page?: number
}

/** The moment a Task is about: its start, next occurrence or deadline. */
const MOMENT = "COALESCE(json_extract(t.timing, '$.at'), json_extract(t.timing, '$.next'), json_extract(t.timing, '$.deadline'))"

/** One page of the Tasks a caller sees, open ones first, then by their moment (mc-m3cc, mc-m5ee). */
export const listTasks = (caller: TaskCaller, filter: TaskFilter) => Effect.gen(function* () {
  const sql = yield* Sql
  const { where, bindings } = visibility(caller)
  const conditions = [where]
  const values: unknown[] = [...bindings]
  const state = filter.state ?? 'open'
  if (state !== 'all') { conditions.push('t.state = ?'); values.push(state) }
  const words = (filter.q ?? '').trim()
  if (words !== '') { conditions.push("t.title LIKE ? ESCAPE '\\'"); values.push(`%${words.replace(/[\\%_]/g, (character) => `\\${character}`)}%`) }
  if (filter.parentId !== undefined) { conditions.push('t.parent_id = ?'); values.push(filter.parentId) }
  if (filter.assignee !== undefined) { conditions.push('t.assignee_kind = ? AND t.assignee_id IS ?'); values.push(filter.assignee.kind, assigneeId(filter.assignee)) }
  const grouping = filter.group === 'assignee' ? 't.assignee_kind, t.assignee_id, ' : filter.group === 'parent' ? 'COALESCE(t.parent_id, t.id), t.parent_id IS NOT NULL, ' : ''
  const page = Number.isInteger(filter.page) && filter.page! >= 1 ? filter.page! : 1
  const rows = yield* sql.all<TaskSql>(
    `SELECT t.* FROM task t WHERE ${conditions.join(' AND ')}
     ORDER BY CASE t.state WHEN 'open' THEN 0 ELSE 1 END, ${grouping}${MOMENT} IS NULL, ${MOMENT}, t.updated_at DESC, t.id
     LIMIT ? OFFSET ?`,
    ...values, TASK_PAGE_SIZE + 1, (page - 1) * TASK_PAGE_SIZE,
  )
  const tasks = yield* taskViews(rows.slice(0, TASK_PAGE_SIZE).map(taskFromSql))
  return { tasks, next: rows.length > TASK_PAGE_SIZE ? page + 1 : null } as TaskPage
})

export const getTask = (caller: TaskCaller, id: string) => Effect.flatMap(visibleTask(caller, id), view)

// ------------------------------------------------------------------ rules for a change

const memberRow = (id: string) => Effect.gen(function* () {
  const sql = yield* Sql
  return yield* sql.first<{ name: string; status: string }>('SELECT name, status FROM member WHERE id = ?', id)
})

/**
 * Whom a caller may give a Task (mc-r3cc, mc-a2bb): a Member gives it to an active Member or a Robot he
 * reaches; a Robot to its owner, its owner's Robots, itself, and another Member who accepts Tasks from the
 * Robots of its owner.
 */
const mayAssign = (ports: TaskPorts, caller: TaskCaller, assignee: TaskAssignee): Effect.Effect<void, DurableError, Sql> => Effect.gen(function* () {
  const sql = yield* Sql
  if (assignee.kind === 'nobody') return
  if (assignee.kind === 'member') {
    const person = yield* memberRow(assignee.memberId)
    if (person === undefined || person.status !== 'active') return yield* Effect.fail(invalid('That person is not an active Member of this Home.'))
    if (caller.kind === 'member' || assignee.memberId === caller.ownerId) return
    const owner = (yield* memberRow(caller.ownerId))?.name ?? 'your owner'
    if (!(yield* ports.acceptsFrom(assignee.memberId)).includes(caller.ownerId)) {
      return yield* Effect.fail(invalid(`${person.name} does not accept Tasks from the Robots of ${owner}: their setting "Accept tasks from the Robots of…" does not name ${owner}. Give the Task to ${owner} instead, or ask ${person.name} to turn that setting on.`))
    }
    return
  }
  const robot = yield* sql.first<{ owner_id: string; sharing: string }>("SELECT owner_id, sharing FROM robot WHERE id = ? AND status != 'deleted'", assignee.robotId)
  if (robot === undefined) return yield* Effect.fail(invalid('No such Robot.'))
  if (caller.kind === 'member') {
    if (robot.owner_id !== caller.memberId && robot.sharing !== 'home') return yield* Effect.fail(invalid('You cannot reach that Robot.'))
    return
  }
  if (robot.owner_id !== caller.ownerId) return yield* Effect.fail(invalid("A Robot gives Tasks only to its owner, its owner's Robots and itself."))
})

/** A Robot keeps at most 50 scheduled or recurring Tasks open (mc-s6ff). */
const withinLimit = (assignee: TaskAssignee, timing: TaskTiming, except: string | null) => Effect.gen(function* () {
  if (assignee.kind !== 'robot' || timing.kind === 'unscheduled') return
  const sql = yield* Sql
  const count = (yield* sql.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM task WHERE assignee_kind = 'robot' AND assignee_id = ? AND state = 'open' AND json_extract(timing, '$.kind') != 'unscheduled' AND id IS NOT ?",
    assignee.robotId, except,
  ))?.n ?? 0
  if (count >= MAX_TIMED_TASKS) return yield* Effect.fail(invalid(`A Robot may have at most ${MAX_TIMED_TASKS} scheduled or recurring Tasks. Cancel one before you create another.`))
})

/** A parent the caller sees, never the Task itself or one of its descendants. */
const validParent = (caller: TaskCaller, parentId: string | null, self: string | null) => Effect.gen(function* () {
  if (parentId === null) return
  if (parentId === self) return yield* Effect.fail(invalid('A Task cannot be its own parent.'))
  yield* visibleTask(caller, parentId).pipe(Effect.mapError(() => invalid('No such parent Task.')))
  let current: string | null = parentId
  for (let depth = 0; current !== null && depth < 1000; depth += 1) {
    if (current === self) return yield* Effect.fail(invalid('A Task cannot sit under one of its own children.'))
    current = (yield* taskRow(current))?.parentId ?? null
  }
})

const timingFor = (ports: TaskPorts, caller: TaskCaller, input: TaskInput['timing'], now: number) => Effect.gen(function* () {
  const zone = yield* ports.zoneOf(viewerOf(caller))
  const parsed = parseTiming(input, zone, now)
  if (!parsed.ok) return yield* Effect.fail(invalid(parsed.message))
  return parsed.value
})

/** Reminding is for a person; a Task for a Robot or nobody keeps none. */
const remindFor = (assignee: TaskAssignee, remind: Remind): Remind => (assignee.kind === 'member' ? remind : { kind: 'none' })

const commit = (ports: TaskPorts, change: TaskChange) => Effect.gen(function* () {
  yield* saveTask(change.after)
  yield* ports.changed(change)
  return yield* view(change.after)
})

// ------------------------------------------------------------------ changes

export const createTask = (ports: TaskPorts, caller: TaskCaller, input: TaskInput, now = Date.now()) => Effect.gen(function* () {
  const timing = yield* timingFor(ports, caller, input.timing, now)
  yield* mayAssign(ports, caller, input.assignee)
  yield* withinLimit(input.assignee, timing, null)
  const parentId = input.parentId ?? null
  yield* validParent(caller, parentId, null)
  const task: TaskRow = {
    id: `t-${crypto.randomUUID()}`, title: input.title, instructions: input.instructions ?? '', createdBy: caller.actor, creatorMember: viewerOf(caller),
    assignee: input.assignee, parentId, timing, wakeAt: wakeAt(timing, 'open'), remind: remindFor(input.assignee, input.remind ?? { kind: 'none' }), remindedFor: null,
    state: 'open', external: input.external ?? null, createdAt: now, updatedAt: now,
  }
  return yield* commit(ports, { action: 'created', before: null, after: task, actor: caller.actor })
})

export const updateTask = (ports: TaskPorts, caller: TaskCaller, id: string, patch: TaskPatch, now = Date.now()) => Effect.gen(function* () {
  const before = yield* visibleTask(caller, id)
  const timing = patch.timing === undefined ? before.timing : yield* timingFor(ports, caller, patch.timing, now)
  if (patch.timing !== undefined) yield* withinLimit(before.assignee, timing, id)
  const parentId = patch.parentId === undefined ? before.parentId : patch.parentId
  if (parentId !== before.parentId) yield* validParent(caller, parentId, id)
  const after: TaskRow = {
    ...before,
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.instructions === undefined ? {} : { instructions: patch.instructions }),
    ...(patch.external === undefined ? {} : { external: patch.external }),
    ...(patch.remind === undefined ? {} : { remind: remindFor(before.assignee, patch.remind), remindedFor: null }),
    parentId, timing,
    wakeAt: patch.timing === undefined ? before.wakeAt : wakeAt(timing, before.state),
    ...(patch.timing === undefined ? {} : { remindedFor: null }),
    updatedAt: now,
  }
  return yield* commit(ports, { action: 'updated', before, after, actor: caller.actor })
})

/**
 * Done (mc-w4dd): an unscheduled or scheduled Task is done; a recurring one has its occurrence handled and
 * moves to the next (mc-s2bb), and stays open; it ends only when it is cancelled.
 */
export const finishTask = (ports: TaskPorts, caller: TaskCaller, id: string, now = Date.now()) => Effect.gen(function* () {
  const before = yield* visibleTask(caller, id)
  if (before.state !== 'open') return yield* Effect.fail(conflict(`This Task is already ${before.state}.`))
  if (before.timing.kind === 'recurring') {
    const timing = advanced(before.timing, now)
    return yield* commit(ports, { action: 'done', before, after: { ...before, timing, wakeAt: wakeAt(timing, 'open'), remindedFor: null, updatedAt: now }, actor: caller.actor })
  }
  return yield* commit(ports, { action: 'done', before, after: { ...before, state: 'done', wakeAt: null, updatedAt: now }, actor: caller.actor })
})

export const cancelTask = (ports: TaskPorts, caller: TaskCaller, id: string, now = Date.now()) => Effect.gen(function* () {
  const before = yield* visibleTask(caller, id)
  if (before.state !== 'open') return yield* Effect.fail(conflict(`This Task is already ${before.state}.`))
  return yield* commit(ports, { action: 'cancelled', before, after: { ...before, state: 'cancelled', wakeAt: null, updatedAt: now }, actor: caller.actor })
})

/** Pause keeps a recurring Task and its rule but stops its occurrences; resume skips what it missed (mc-t3cc). */
export const pauseTask = (ports: TaskPorts, caller: TaskCaller, id: string, pause: boolean, now = Date.now()) => Effect.gen(function* () {
  const before = yield* visibleTask(caller, id)
  if (before.timing.kind !== 'recurring') return yield* Effect.fail(invalid('Only a recurring Task can be paused.'))
  if (before.state !== 'open') return yield* Effect.fail(conflict(`This Task is already ${before.state}.`))
  const timing = pausedTiming(before.timing, pause, now)
  return yield* commit(ports, { action: pause ? 'paused' : 'resumed', before, after: { ...before, timing, wakeAt: wakeAt(timing, 'open'), updatedAt: now }, actor: caller.actor })
})

/**
 * Give the Task to another doer (mc-n2bb): never while a Robot works on it. `working` names the Robot whose
 * running Turn serves the Task, as the Robots report it to the registry.
 */
export const assignTask = (ports: TaskPorts, caller: TaskCaller, id: string, assignee: TaskAssignee, now = Date.now()) => Effect.gen(function* () {
  const before = yield* visibleTask(caller, id)
  const sql = yield* Sql
  const working = yield* sql.first<{ id: string }>("SELECT id FROM robot WHERE json_extract(turn, '$.task.id') = ? LIMIT 1", id)
  if (working !== undefined) return yield* Effect.fail(conflict('A Robot is working on this Task now. Interrupt it or wait until its Turn ends, then assign the Task.'))
  yield* mayAssign(ports, caller, assignee)
  yield* withinLimit(assignee, before.timing, id)
  const after: TaskRow = { ...before, assignee, remind: remindFor(assignee, before.remind), remindedFor: null, updatedAt: now }
  return yield* commit(ports, { action: 'assigned', before, after, actor: caller.actor })
})

/**
 * A Robot was deleted or a Member removed (mc-t8hh): their open Tasks become unassigned, not deleted.
 * @returns the Tasks that changed.
 */
export const orphanTasks = (assignee: Exclude<TaskAssignee, { kind: 'nobody' }>, now = Date.now()) => Effect.gen(function* () {
  const sql = yield* Sql
  const rows = yield* sql.all<TaskSql>("SELECT * FROM task WHERE assignee_kind = ? AND assignee_id = ? AND state = 'open'", assignee.kind, assigneeId(assignee))
  yield* sql.run("UPDATE task SET assignee_kind = 'nobody', assignee_id = NULL, remind = ?, updated_at = ? WHERE assignee_kind = ? AND assignee_id = ? AND state = 'open'", JSON.stringify({ kind: 'none' }), now, assignee.kind, assigneeId(assignee))
  return rows.map(taskFromSql)
})
