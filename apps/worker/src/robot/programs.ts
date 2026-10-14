/**
 * The Robot's own state changes as Effect programs (ticket 23, robot-naul): Routines, Robot
 * messages, Mr. Robot's coordination and the lifecycle. The Robot Durable Object provides
 * the services and runs them; DSH's agent loop and the browser stay at its boundary.
 */
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type { DirectoryEntry } from '../agent/tools/messaging.ts'
import type { NotificationKind, ProposalView, ReviewView, RobotSettings, RoutineView, SettingsPatch } from '@mr-robot/protocol'
import type { MemberFileName } from '../member/member.ts'
import { currentMonth } from '../home/home.ts'
import { HOME_ID, type Env } from '../env.ts'
import { chainOf, modelOf, withModel } from './chain.ts'
import { conflict, invalid, notFound } from '../platform/durable.ts'
import { cronOf, describeSchedule } from './schedule.ts'
import { displaySchedule, resumed, type AlarmSchedule } from '../agent/schedule.ts'
import type { ScheduleCreateRequest, ScheduleTimingChange } from '@deepseek-ai/dsh-schedule'
import type { RoutineCard, ProposalRow, RobotConfig, RobotStore, RoutineRow, RoutineRun, WakeupKind } from './store.ts'
import { dueDelivery } from '../agent/schedule.ts'
import { setupGrants } from '../agent/catalog.ts'
import { effectiveSpendLimit, emptyGrants, grantSetFrom, overlayGrants, usableNames, type HomeSpendLimit } from '@mr-robot/protocol'
import { THREAD_PAUSE_AT } from '../agent/sources.ts'
import type { Identity, ModelChoice, RobotStatus, Sharing } from '@mr-robot/protocol'
import { buildForkSeed, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { readStoredEvents, storedLength } from '../agent/session-log.ts'
import type { RewindView } from '@mr-robot/protocol'
import type { Sender, Attachment } from '@mr-robot/protocol'

export const MAX_CHAIN_HOPS = 8
export { THREAD_PAUSE_AT }
export const MAX_QUEUED_WAKEUPS = 32

export interface WakeInput {
  readonly kind: WakeupKind
  readonly sender: Sender
  readonly text: string
  readonly attachments?: readonly Attachment[]
  readonly payload?: Record<string, unknown>
  /** The sender's id for this message; a repeated Wake-up with the same id is queued once. */
  readonly clientId?: string
}

/** A message between Robots, as the platform carries it (robot-mv15). */
interface MessageCommon {
  readonly id: string
  /** `avatarSeed` is absent in messages queued before avatar seeds existed: the sender's id is its seed. */
  readonly from: { readonly robotId: string; readonly ownerId: string; readonly name: string; readonly avatarColor: string; readonly avatarSeed?: string }
  readonly text: string
  readonly requestId: string
  readonly chain: { readonly id: string; readonly hops: number }
}

export type RobotMessage =
  | MessageCommon & { readonly kind: 'request' | 'reply' }
  /** A message in a Thread between two chiefs (v1.9): the chain limit does not apply to it, the pause at 20 does. */
  | MessageCommon & { readonly kind: 'thread'; readonly threadId: string }

export type ReceiveResult = { readonly accepted: true } | { readonly accepted: false; readonly reason: 'unavailable' | 'queue-full' | 'chain-limit' | 'thread-closed' }

/** The Robot's SQLite state. */
export class RobotState extends Context.Service<RobotState, RobotStore>()('mr-robot/RobotState') {}

/** What the programs ask of the Durable Object around them. */
export interface RobotPlatformShape {
  readonly env: Env
  /** Re-plan the alarm (routines, outbox, heartbeat). */
  rearm(): Effect.Effect<void>
  /** Tell open views and the Home that something visible changed. */
  changed(): Effect.Effect<void>
  /** Make sure the wake-up queue is being worked off. */
  drain(): Effect.Effect<void>
  /** Keep work running after the RPC returns. */
  background(work: Effect.Effect<void, never, RobotState | RobotPlatform>): Effect.Effect<void>
  /** Mask granted secret values in outgoing text. */
  mask(text: string): Effect.Effect<string>
  /** A masking function with the granted secrets loaded (for many strings at once). */
  masker(): Effect.Effect<(text: string) => string>
  /** Close a browser kept open for screen notifications. */
  stopWatching(): Effect.Effect<void>
  /** Push to the Robot's notification recipients through its Channels. */
  notifyMembers(kind: NotificationKind, body: string): Effect.Effect<number>
  /** Keep a fetched secret's value in memory to mask it (never stored). */
  rememberSecret(name: string, value: string): Effect.Effect<void>
  /** The Durable Object's alarm. */
  setAlarm(at: number | null): Effect.Effect<void>
  /** Write the Muse persona files into a new Workspace (robot-om9f). */
  seedWorkspace(): Effect.Effect<void>
  /** The Routine rules over the Routine table: records stored here, fired by the alarm. */
  schedule(): Effect.Effect<AlarmSchedule>
  /** A Turn is running or about to run. */
  working(): Effect.Effect<boolean>
  /** Dispose the DSH agent so the next Turn composes over the current live session. */
  releaseAgent(): Effect.Effect<void>
  /** Start the DSH session seeded from a prefix of the old one, with a platform note for the model. */
  seedSession(sessionId: string, seed: { readonly events: readonly SessionEvent[]; readonly inheritedEventCount: number; readonly parentSession: string }, note: string): Effect.Effect<void>
}

export class RobotPlatform extends Context.Service<RobotPlatform, RobotPlatformShape>()('mr-robot/RobotPlatform') {}

type R = RobotState | RobotPlatform

const promise = <A>(run: () => Promise<A>) => Effect.promise(run)

const config = Effect.gen(function* () {
  const store = yield* RobotState
  const value = store.config()
  if (value === undefined) return yield* notFound('robot is not initialised')
  return value
})

// ------------------------------------------------------------------ wake-ups and lifecycle (robot-qo06)

/** The latest client ids with their Wake-up ids: a retry comes within seconds, so a short list is enough to accept a send once. */
const RECENT_CLIENT_IDS = 'recent-client-ids'
const RECENT_CLIENT_ID_LIMIT = 200

/** Queue a Wake-up and make sure the queue is being drained. */
export const wake = (input: WakeInput) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  if ((yield* config).status === 'deleted') return yield* invalid('robot is deleted')
  const recent = store.get<ReadonlyArray<readonly [string, number]>>(RECENT_CLIENT_IDS) ?? []
  const seen = input.clientId === undefined ? undefined : recent.find(([clientId]) => clientId === input.clientId)
  if (seen !== undefined) return seen[1]
  const id = store.enqueue(input.kind, input.sender, input.text, {
    ...input.payload,
    attachments: input.attachments ?? [],
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
  }, Date.now())
  if (input.clientId !== undefined) store.set(RECENT_CLIENT_IDS, [...recent, [input.clientId, id] as const].slice(-RECENT_CLIENT_ID_LIMIT))
  yield* platform.drain()
  return id
})

export const pause = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.status === 'deleted' || current.status === 'paused') return
  store.set('resumeStatus', current.status)
  store.updateConfig(() => ({ status: 'paused' }), false)
  yield* platform.stopWatching()
  yield* platform.changed()
})

export const resume = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  if ((yield* config).status !== 'paused') return
  store.updateConfig(() => ({ status: store.get<'active' | 'setup'>('resumeStatus') ?? 'active' }), false)
  yield* platform.changed()
  yield* platform.drain()
})

/** Delete: no more Wake-ups and gone from every list; the log and Workspace are kept as the archive. */
export const remove = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  store.updateConfig(() => ({ status: 'deleted' }), false)
  yield* platform.rearm()
  yield* platform.changed()
})

// ------------------------------------------------------------------ Routines (robot-gbbt, robot-qyd5, robot-qhll)

export function routineView(robotId: string, routine: RoutineRow, runs: readonly RoutineRun[]): RoutineView {
  const schedule = displaySchedule(routine.record)
  const timeZone = 'timeZone' in routine.record ? routine.record.timeZone : routine.timeZone
  return {
    id: routine.id, name: routine.record.title, prompt: routine.record.prompt, schedule, timeZone,
    nextRun: routine.nextRun, lastRun: routine.lastRun, paused: routine.paused, robotId,
    summary: describeSchedule(schedule, timeZone),
    cron: cronOf(schedule, timeZone),
    runs,
  }
}

const view = (routine: RoutineRow) => Effect.gen(function* () {
  const store = yield* RobotState
  return routineView((yield* config).id, routine, store.routineRuns(routine.id))
})

/** A Routine another Robot changed shows in the Conversation as a card naming who did it (cd-n9pi). */
function routineCard(store: RobotStore, sessionId: string, card: RoutineCard): void {
  const verb = { created: 'created', updated: 'updated', deleted: 'deleted', paused: 'paused', resumed: 'resumed' }[card.action]
  store.addNotice(sessionId, storedLength(store.sql, sessionId), `Routine ${verb} by ${card.by}: ${card.name}`, Date.now(), card)
}

/** The owner deletes a Routine from the panel (robot-qyd5); `by` names another Robot doing it for the owner. */
export const removeRoutine = (id: string, by?: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const routine = store.routine(id)
  if (!store.deleteRoutine(id)) return yield* notFound(`no Routine ${id}`)
  if (by !== undefined && routine !== undefined) routineCard(store, (yield* config).liveSessionId, { kind: 'routine', action: 'deleted', name: routine.record.title, by })
  yield* platform.rearm()
  yield* platform.changed()
})

/** The timing selectors of a Routine request, with the Robot's time zone where a selector names none. */
const TIMING = ['at', 'after_seconds', 'every_seconds', 'daily', 'weekly', 'cron'] as const

export interface RoutineInput {
  /** Absent: create a Routine; present: edit that one. */
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

const inZone = <T extends object | undefined>(value: T, timeZone: string): T =>
  (value !== undefined && typeof value === 'object' && !('time_zone' in value) ? { ...value, time_zone: timeZone } : value)

/** Create or edit a Routine of this Robot, by this Robot itself or (with `by`) for another Robot (cd-n9pi); one set of rules and limits applies. */
export const setRoutine = (input: RoutineInput, by?: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  const schedule = yield* platform.schedule()
  const failed = (error: unknown) => invalid(error instanceof Error ? error.message : String(error))
  const given = TIMING.filter((key) => input[key] !== undefined)
  if (given.length > 1) return yield* invalid(`give one timing, not ${given.join(' and ')}`)
  const zone = current.timeZone
  const timing = {
    ...(input.at === undefined ? {} : { at: inZone(input.at as object, zone) }),
    ...(input.after_seconds === undefined ? {} : { after_seconds: input.after_seconds }),
    ...(input.every_seconds === undefined ? {} : { every_seconds: input.every_seconds }),
    ...(input.daily === undefined ? {} : { daily: inZone(input.daily, zone) }),
    ...(input.weekly === undefined ? {} : { weekly: inZone(input.weekly, zone) }),
    ...(input.cron === undefined ? {} : { cron: inZone(input.cron, zone) }),
  }
  if (input.id === undefined) {
    if (input.title === undefined || input.prompt === undefined || given.length === 0) return yield* invalid('a new Routine needs title, prompt and one timing (at, after_seconds, every_seconds, daily, weekly or cron)')
    const record = yield* Effect.tryPromise({ try: () => schedule.create(current.liveSessionId, { title: input.title!, prompt: input.prompt!, ...timing } as ScheduleCreateRequest), catch: failed })
    if (by !== undefined) routineCard(store, current.liveSessionId, { kind: 'routine', action: 'created', name: record.title, by })
    yield* platform.changed()
    return routineView(current.id, store.routine(record.id)!, store.routineRuns(record.id))
  }
  const row = store.routine(input.id)
  if (row === undefined) return yield* notFound(`no Routine ${input.id}`)
  const change: ScheduleTimingChange | undefined =
    timing.at !== undefined ? { kind: 'at', at: timing.at as never }
      : timing.after_seconds !== undefined ? { kind: 'at', at: new Date(Date.now() + timing.after_seconds * 1000).toISOString() }
        : timing.every_seconds !== undefined ? { kind: 'every', every_seconds: timing.every_seconds }
          : timing.daily !== undefined ? { kind: 'daily', daily: timing.daily as never }
            : timing.weekly !== undefined ? { kind: 'weekly', weekly: timing.weekly as never }
              : timing.cron !== undefined ? { kind: 'cron', cron: timing.cron as never } : undefined
  const result = yield* Effect.tryPromise({
    try: () => schedule.update({ sessionId: row.sessionId as never, id: row.id as never, expected: row.record, ...(change === undefined ? {} : { change }), ...(input.title === undefined ? {} : { title: input.title }), ...(input.prompt === undefined ? {} : { prompt: input.prompt }) }),
    catch: failed,
  })
  if (!('record' in result)) {
    const code = 'code' in result ? result.code : 'unknown'
    return yield* (code === 'schedule_not_found' ? notFound(`no Routine ${input.id}`) : invalid('message' in result ? String(result.message) : `the Routine could not be changed (${code}); it may have ended`))
  }
  const saved = store.routine(row.id)!
  if (result.updated && by !== undefined) routineCard(store, current.liveSessionId, { kind: 'routine', action: 'updated', name: result.record.title, by })
  yield* platform.changed()
  return routineView(current.id, saved, store.routineRuns(saved.id))
})

/** Pause keeps the Routine and its schedule but stops its alarm; resume plans the next run from now (robot-qhll). */
export const pauseRoutine = (id: string, paused: boolean, by?: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const routine = store.routine(id)
  if (routine === undefined) return yield* notFound('no such Routine')
  if (by !== undefined) routineCard(store, (yield* config).liveSessionId, { kind: 'routine', action: paused ? 'paused' : 'resumed', name: routine.record.title, by })
  // Resuming skips what a recurring Routine missed while paused (DSH's recurrence arithmetic).
  const record = paused ? routine.record : resumed(routine.record, Date.now())
  const saved = { ...routine, paused, record: record ?? routine.record, nextRun: paused || record === null ? null : Date.parse(record.scheduledAt) }
  store.saveRoutine(saved)
  yield* platform.rearm()
  yield* platform.changed()
  return yield* view(saved)
})

// ------------------------------------------------------------------ Robot messages (robot-bsvs, robot-mv15, robot-ppzu, robot-bjq5)

/** The causal chain of the current Turn: inherited from a Robot message, or a new root. */
const currentChain = Effect.gen(function* () {
  const store = yield* RobotState
  const active = store.activeTurn()
  const wakeup = active === undefined ? undefined : store.wakeup(active.wakeupId)
  const chain = wakeup?.payload['chain'] as { id: string; hops: number } | undefined
  return chain ?? { id: `chain-${active?.wakeupId ?? 'none'}-${(yield* config).id}`, hops: 0 }
})

/** Recipients the Robot holds a Grant for, that its owner can still reach, and that are active. */
export const directory = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  const granted = new Set(usableNames(store.grants().recipients))
  const reachable = yield* promise(() => platform.env.HOME.getByName(HOME_ID).reachable(current.ownerId))
  return reachable
    .filter((robot) => granted.has(robot.id) && robot.id !== current.id && robot.status === 'active')
    .map((robot): DirectoryEntry => ({ id: robot.id, name: robot.identity.name, description: robot.identity.description, availability: robot.fleetState }))
})

export const enqueueOutbox = (recipient: string, message: RobotMessage) => Effect.gen(function* () {
  const store = yield* RobotState
  store.sql.exec(
    "INSERT INTO outbox (id, recipient, payload, status, attempts, next_attempt, created_at) VALUES (?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT (id) DO NOTHING",
    message.id, recipient, JSON.stringify(message), Date.now(), Date.now(),
  )
})

function undeliverable(reason: 'unavailable' | 'queue-full' | 'chain-limit' | 'thread-closed'): string {
  return reason === 'unavailable' ? 'that Robot is not active' : reason === 'queue-full' ? 'that Robot has too much queued work; try later' : reason === 'thread-closed' ? 'that Thread is closed for the other chief' : 'the chain of Robot messages is too long'
}

/** Deliver pending outbox rows; a lost RPC is retried on the alarm, the recipient dedupes. */
export const deliverOutbox: Effect.Effect<void, never, R> = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const pending = store.sql.exec<{ id: string; recipient: string; payload: string; attempts: number }>(
    "SELECT id, recipient, payload, attempts FROM outbox WHERE status = 'pending' AND next_attempt <= ? ORDER BY created_at", Date.now(),
  ).toArray()
  for (const row of pending) {
    const message = JSON.parse(row.payload) as RobotMessage
    const result = yield* Effect.tryPromise(() => platform.env.ROBOT.getByName(row.recipient).receive(message) as Promise<ReceiveResult>).pipe(Effect.result)
    if (result._tag === 'Success') {
      store.sql.exec('UPDATE outbox SET status = ?, attempts = attempts + 1 WHERE id = ?', result.success.accepted ? 'delivered' : 'failed', row.id)
      if (!result.success.accepted) {
        yield* wake({ kind: 'platform', sender: { kind: 'platform' }, text: `Your ${message.kind} to robot ${row.recipient} was not delivered: ${undeliverable(result.success.reason)}` }).pipe(Effect.ignore)
      }
      continue
    }
    const attempts = row.attempts + 1
    if (attempts >= 8) {
      store.sql.exec("UPDATE outbox SET status = 'failed', attempts = ? WHERE id = ?", attempts, row.id)
      yield* wake({ kind: 'platform', sender: { kind: 'platform' }, text: `Your ${message.kind} to robot ${row.recipient} could not be delivered after ${attempts} attempts.` }).pipe(Effect.ignore)
    } else {
      store.sql.exec('UPDATE outbox SET attempts = ?, next_attempt = ? WHERE id = ?', attempts, Date.now() + 2 ** attempts * 1000, row.id)
    }
  }
  yield* platform.rearm()
})

export async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...bytes.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const sender = Effect.map(config, (current) => ({ robotId: current.id, ownerId: current.ownerId, name: current.identity.name, avatarColor: current.identity.avatarColor, avatarSeed: current.identity.avatarSeed }))

/** The sender of a Robot message as the receiving Conversation shows it. */
const robotSender = (from: RobotMessage['from']): Sender =>
  ({ kind: 'robot', robotId: from.robotId, name: from.name, avatarColor: from.avatarColor, avatarSeed: from.avatarSeed ?? from.robotId })

export const sendRobotMessage = (to: string, text: string, idempotencyKey: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (!store.mayUse('recipient', to)) return yield* invalid(`You have no Grant to message ${to}. Ask your owner with propose_grants (recipients).`)
  if (!(yield* directory).some((entry) => entry.id === to)) return yield* invalid(`${to} is not available to you now`)
  const chain = yield* currentChain
  if (chain.hops + 1 > MAX_CHAIN_HOPS) return yield* invalid(`This chain of Robot messages is already ${chain.hops} hops long; finish it without delegating further.`)
  const id = `msg-${yield* promise(() => digest(`${current.id}:${idempotencyKey}`))}`
  const existing = store.sql.exec<{ status: string }>('SELECT status FROM outbox WHERE id = ?', id).toArray()[0]
  if (existing !== undefined) return { requestId: id, status: existing.status === 'failed' ? 'failed earlier' : 'already sent' }
  yield* enqueueOutbox(to, { id, kind: 'request', from: yield* sender, text: yield* platform.mask(text), requestId: id, chain: { id: chain.id, hops: chain.hops + 1 } })
  yield* platform.background(deliverOutbox)
  return { requestId: id, status: 'sent; the reply will arrive as a message' }
})

export const replyRobotMessage = (handle: string, text: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const row = store.sql.exec<{ sender_robot: string; request_id: string; chain: number; used_at: number | null }>('SELECT * FROM reply_handle WHERE id = ?', handle).toArray()[0]
  if (row === undefined) return yield* notFound('unknown reply handle')
  if (row.used_at !== null) return yield* conflict('this request was already answered')
  const masked = yield* platform.mask(text)
  store.sql.exec('UPDATE reply_handle SET used_at = ? WHERE id = ?', Date.now(), handle)
  yield* enqueueOutbox(row.sender_robot, { id: `reply-${handle}`, kind: 'reply', from: yield* sender, text: masked, requestId: row.request_id, chain: { id: (yield* currentChain).id, hops: row.chain } })
  yield* platform.background(deliverOutbox)
  return { status: 'reply sent' }
})

/** A message from another Robot arrives (robot-ppzu): deduped, capped, and queued as a Wake-up. */
export const receive = (message: RobotMessage) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = store.config()
  if (current === undefined || current.status === 'deleted' || current.status === 'setup') return { accepted: false, reason: 'unavailable' } as ReceiveResult
  if (store.sql.exec('SELECT 1 FROM intake WHERE key = ?', message.id).toArray().length > 0) return { accepted: true } as ReceiveResult
  if (message.kind === 'thread') {
    // A Thread message (v1.9): the chain limit does not apply, the pause at 20 does.
    const known = store.thread(message.threadId)
    if (known === undefined || known.view.other.robotId !== message.from.robotId) return { accepted: false, reason: 'thread-closed' } as ReceiveResult
    // The "opened" note may come after the first message: a copy still invited asks the Home, which opens a Thread only when both owners accepted.
    const copy = known.view.state === 'invited'
      ? yield* Effect.promise(() => platform.env.HOME.getByName(HOME_ID).threadView(message.threadId, current.id)).pipe(Effect.map((view) => (view === undefined ? known : store.saveThread({ ...view, messageCount: known.view.messageCount }, Date.now()))))
      : known
    if (copy.view.state !== 'open') return { accepted: false, reason: 'thread-closed' } as ReceiveResult
    if (store.pendingWakeups() >= MAX_QUEUED_WAKEUPS) return { accepted: false, reason: 'queue-full' } as ReceiveResult
    store.transaction(() => {
      store.sql.exec('INSERT INTO intake (key, sender, received_at) VALUES (?, ?, ?)', message.id, message.from.robotId, Date.now())
      const updated = store.threadMessage(copy.view.id, Date.now())!
      store.enqueue(
        'robot',
        robotSender(message.from),
        message.text,
        { threadId: copy.view.id, thread: { id: copy.view.id, topic: copy.view.topic, scope: copy.view.scope, count: updated.view.messageCount, windowCount: updated.windowCount } },
        Date.now(),
      )
    })
    yield* platform.drain()
    return { accepted: true } as ReceiveResult
  }
  if (message.kind === 'request' && message.chain.hops > MAX_CHAIN_HOPS) return { accepted: false, reason: 'chain-limit' } as ReceiveResult
  if (store.pendingWakeups() >= MAX_QUEUED_WAKEUPS) return { accepted: false, reason: 'queue-full' } as ReceiveResult
  const handle = message.kind === 'request' ? `rh-${crypto.randomUUID()}` : undefined
  store.transaction(() => {
    store.sql.exec('INSERT INTO intake (key, sender, received_at) VALUES (?, ?, ?)', message.id, message.from.robotId, Date.now())
    if (handle !== undefined) store.sql.exec('INSERT INTO reply_handle (id, sender_robot, request_id, chain) VALUES (?, ?, ?, ?)', handle, message.from.robotId, message.requestId, message.chain.hops)
    store.enqueue(
      'robot',
      robotSender(message.from),
      message.text,
      message.kind === 'request' ? { requestId: message.requestId, replyHandle: handle, chain: message.chain } : { replyTo: message.requestId, chain: message.chain },
      Date.now(),
    )
  })
  yield* platform.drain()
  return { accepted: true } as ReceiveResult
})

// ------------------------------------------------------------------ Mr. Robot (robot-hk2s)

export const createRobot = (brief: string) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.kind !== 'mr-robot') return yield* invalid('only Mr. Robot creates Robots')
  const entry = yield* Effect.tryPromise({ try: () => platform.env.HOME.getByName(HOME_ID).createRobot(current.ownerId, brief), catch: (error) => invalid(error instanceof Error ? error.message : String(error)) })
  return { id: entry.id, status: 'created; it is interviewing your owner in its own Conversation and will propose its Grants there' }
})

// ------------------------------------------------------------------ settings and Grants (robot-vqtw)

/** What "the Home's" spend limit is for this Robot now: the Home's per-Robot limit. */
export const homeSpendLimit = Effect.gen(function* () {
  const platform = yield* RobotPlatform
  return (yield* promise(() => platform.env.HOME.getByName(HOME_ID).settings())).robotSpendLimit
})

/** The settings, with the Home's per-Robot limit already read. */
export const settingsWith = (home: HomeSpendLimit) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  return {
    identity: current.identity,
    sharing: current.sharing,
    model: current.model,
    chain: chainOf(current),
    contextBudget: current.contextBudget,
    codeMode: current.codeMode,
    wakeOnScreenNotifications: current.wakeOnScreenNotifications === true,
    browserBackend: current.browserBackend ?? null,
    discordChannel: current.discordChannel ?? null,
    discordProactive: current.discordProactive !== false,
    compactionInstruction: current.compactionInstruction,
    // Mr. Robot's real levels (sk-8llz): what he reaches at allow, under what his owner lowered.
    grants: store.effectiveGrants(),
    // Discord is on by having a channel; an old 'discord' entry in the list means nothing.
    notifications: { ...current.notifications, channels: current.notifications.channels.filter((channel) => channel !== 'discord') },
    spendLimit: current.spendLimit,
    homeSpendLimit: home,
  } as RobotSettings
})

export const settings = Effect.flatMap(homeSpendLimit, settingsWith)

/** Mr. Robot's recipients follow what his Member can reach (robot-70kf). */
export const setRecipients = (robotIds: readonly string[]) => Effect.gen(function* () {
  const store = yield* RobotState
  const grants = store.grants()
  const held = usableNames(grants.recipients)
  if (held.length === robotIds.length && held.every((id) => robotIds.includes(id))) return
  store.setGrants({ ...grants, recipients: Object.fromEntries(robotIds.map((id) => [id, 'allow' as const])) })
  store.updateConfig(() => ({}))
})

/** Dollars with cents, and small amounts with enough digits to tell them apart ($0.0105 of $0.0001). */
function usd(amount: number): string {
  return amount >= 1 || amount === 0 ? '$' + amount.toFixed(2) : '$' + String(Number(amount.toPrecision(3)))
}

/** Over the Robot's or its owner's monthly limit: stop and tell the owner; under it again: resume (robot-8gag, robot-40nw). */
export const checkLimits = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.status !== 'active' && !(current.status === 'blocked' && current.blockedReason === 'limit')) return false
  const limits = yield* promise(() => platform.env.HOME.getByName(HOME_ID).limitsFor(current.ownerId))
  const robotLimit = effectiveSpendLimit(current.spendLimit, limits.robot).limit
  const spent = store.usage(currentMonth()).costUsd
  const reason = robotLimit.kind === 'usd' && spent >= robotLimit.amount
    ? `This Robot reached its monthly spend limit (${usd(spent)} of ${usd(robotLimit.amount)}).`
    : limits.member.kind === 'usd' && limits.memberSpentUsd >= limits.member.amount
      ? `Your Robots reached your monthly spend limit (${usd(limits.memberSpentUsd)} of ${usd(limits.member.amount)}).`
      : null
  if (reason !== null && current.status === 'active') {
    store.updateConfig(() => ({ status: 'blocked', blockedReason: 'limit' }), false)
    store.addNotice(current.liveSessionId, storedLength(store.sql, current.liveSessionId), `${reason} It stops here until the limit is raised.`, Date.now())
    yield* platform.changed()
    yield* platform.notifyMembers('blocked', `${reason} Raise the limit to let it continue.`)
    return true
  }
  if (reason === null && current.status === 'blocked') {
    store.updateConfig(() => ({ status: 'active', blockedReason: null }), false)
    yield* platform.changed()
    yield* platform.drain()
  }
  return reason !== null
})

/** Advanced settings (robot-vqtw): every change takes effect on the next Turn. */
/** One system line per setting a deputy changed (cd-2zx9): what the Conversation shows the owner. */
function changeNotes(by: string, before: RobotConfig, after: RobotConfig): string[] {
  const short = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text)
  const notes: string[] = []
  const note = (changed: boolean, text: string) => { if (changed) notes.push(`${by} ${text}`) }
  note(before.identity.name !== after.identity.name, `changed the name to "${short(after.identity.name)}".`)
  note(before.identity.title !== after.identity.title, `changed the title to "${short(after.identity.title)}".`)
  note(before.identity.description !== after.identity.description, `changed the description to "${short(after.identity.description)}".`)
  note(before.identity.avatarColor !== after.identity.avatarColor, `changed the avatar colour to ${after.identity.avatarColor}.`)
  note(before.identity.avatarSeed !== after.identity.avatarSeed, 'gave the avatar another look.')
  note(before.model.provider !== after.model.provider || before.model.model !== after.model.model, `changed model to ${after.model.model} (${after.model.provider}).`)
  note(before.model.effort !== after.model.effort, `changed thinking to ${after.model.effort}.`)
  note(before.codeMode !== after.codeMode, `changed code mode to ${after.codeMode ? 'on' : 'off'}.`)
  note(before.contextBudget !== after.contextBudget, `changed the context budget to ${after.contextBudget} tokens.`)
  note(before.compactionInstruction !== after.compactionInstruction, 'changed the compaction instruction.')
  note((before.discordChannel ?? null) !== (after.discordChannel ?? null), after.discordChannel ? `set the Discord channel to ${after.discordChannel}.` : 'removed the Discord channel.')
  note((before.discordProactive !== false) !== (after.discordProactive !== false), `changed Discord proactive messages to ${after.discordProactive !== false ? 'on' : 'off'}.`)
  note((before.browserBackend ?? null) !== (after.browserBackend ?? null), `changed the browser backend to ${after.browserBackend ?? 'the Home default'}.`)
  note(before.notifications.enabled !== after.notifications.enabled, `switched notifications ${after.notifications.enabled ? 'on' : 'off'}.`)
  note(before.notifications.channels.join(',') !== after.notifications.channels.join(','), `changed notification channels to ${after.notifications.channels.join(', ')}.`)
  note((before.wakeOnScreenNotifications === true) !== (after.wakeOnScreenNotifications === true), `switched waking on screen notifications ${after.wakeOnScreenNotifications === true ? 'on' : 'off'}.`)
  return notes
}

export const updateSettings = (patch: SettingsPatch, by?: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const before = yield* config
  // The chain is the model setting (v1.10): a plain model change edits its active entry.
  const active = Math.min(store.get<number>('chain-active') ?? 0, chainOf(before).length - 1)
  const chain = patch.chain !== undefined ? [...patch.chain] : patch.model !== undefined ? withModel(chainOf(before), active, patch.model) : undefined
  if (chain !== undefined) {
    if (chain.length === 0) return yield* invalid('a Robot needs at least one model in its chain')
    const refusal = yield* promise(() => platform.env.HOME.getByName(HOME_ID).chainRefusal(before.ownerId, chain))
    if (refusal !== null) return yield* invalid(refusal)
  }
  const nextActive = patch.chain !== undefined ? 0 : active
  store.transaction(() => {
    if (chain !== undefined) store.set('chain-active', nextActive)
    if (patch.grants !== undefined) store.setGrants(grantSetFrom(patch.grants))
    store.updateConfig((current) => ({
      // An identity without a seed keeps the stored one (ux-h0s4).
      ...(patch.identity === undefined ? {} : { identity: { ...patch.identity, avatarSeed: patch.identity.avatarSeed ?? current.identity.avatarSeed } }),
      ...(patch.sharing === undefined ? {} : { sharing: patch.sharing }),
      ...(chain === undefined ? {} : { chain, model: modelOf(chain[nextActive]!) }),
      ...(patch.contextBudget === undefined ? {} : { contextBudget: Math.max(8_000, Math.round(patch.contextBudget)) }),
      ...(patch.codeMode === undefined ? {} : { codeMode: patch.codeMode }),
      ...(patch.wakeOnScreenNotifications === undefined ? {} : { wakeOnScreenNotifications: patch.wakeOnScreenNotifications }),
      ...(patch.browserBackend === undefined ? {} : { browserBackend: patch.browserBackend }),
      ...(patch.compactionInstruction === undefined ? {} : { compactionInstruction: patch.compactionInstruction }),
      ...(patch.discordChannel === undefined ? {} : { discordChannel: patch.discordChannel === null || patch.discordChannel.trim() === '' ? null : patch.discordChannel.trim() }),
      ...(patch.discordProactive === undefined ? {} : { discordProactive: patch.discordProactive }),
      ...(patch.notifications === undefined ? {} : { notifications: { ...patch.notifications, channels: [...new Set(['pwa', ...patch.notifications.channels.filter((channel) => channel !== 'discord')])] } }),
      ...(patch.spendLimit === undefined ? {} : { spendLimit: patch.spendLimit }),
      ...(current.kind === 'mr-robot' && patch.sharing !== undefined ? { sharing: 'private' as const } : {}),
    }))
  })
  if (by !== undefined) {
    const after = yield* config
    for (const text of changeNotes(by, before, after)) store.addNotice(after.liveSessionId, storedLength(store.sql, after.liveSessionId), text, Date.now())
  }
  yield* platform.changed()
  // The Home routes Discord messages by channel, so it hears about the mapping (cn-y1ac).
  if (patch.discordChannel !== undefined) {
    const current = yield* config
    yield* promise(() => platform.env.HOME.getByName(HOME_ID).discordChannelChanged(current.id, current.discordChannel ?? null))
  }
  if (patch.spendLimit !== undefined) yield* checkLimits
  if (patch.wakeOnScreenNotifications === false) yield* platform.stopWatching()
  return yield* settings
})

// ------------------------------------------------------------------ proposals and the owner's answers (robot-cobv, robot-vy9z)

export function proposalView(row: ProposalRow): ProposalView {
  return { id: row.id, kind: row.kind, revision: row.revision, status: row.status, purpose: row.purpose, grants: row.grants, file: row.file, skill: row.skill, ...(row.review === undefined ? {} : { review: row.review }), ...(row.thread === undefined ? {} : { thread: row.thread }), ...(row.help === undefined ? {} : { help: row.help }), ...(row.toolCall === undefined ? {} : { toolCall: row.toolCall }) }
}

/** Who answers an Ask. */
export type Answerer = 'owner' | 'mr-robot'

/**
 * The only Asks Mr. Robot answers: requests for help (sk-gag7). Every other Ask is the owner's alone; consent to
 * a tool call above all (sk-iis1). A list of what he may answer, not of what he may not: a new kind of Ask is the owner's
 * until someone decides otherwise.
 */
const MR_ROBOT_ASKS: ReadonlySet<ProposalView['kind']> = new Set(['help'])

/** Whether this answerer may answer an Ask of this kind. */
export function mayAnswer(kind: ProposalView['kind'], by: Answerer): boolean {
  return by === 'owner' || MR_ROBOT_ASKS.has(kind)
}

/** What wakes the Robot after its owner answered a tool-call Ask; the Turn runs an approved call first (robot.ts). */
export interface ToolCallAnswerWake {
  readonly askId: string
  readonly tool: string
  readonly approved: boolean
  /** The owner's optional text. */
  readonly note: string | null
}

function approvedNote(proposal: ProposalRow): string {
  switch (proposal.kind) {
    case 'setup': return 'Your owner approved your setup. You are active now with exactly the Grants you proposed. Say hello in one line and tell them what happens next.'
    case 'thread': return proposal.thread?.phase === 'continue'
      ? `Your owner approved going on in the Thread about "${proposal.thread.topic}". You may send up to ${THREAD_PAUSE_AT} more messages.`
      : `Your owner accepted the Thread about "${proposal.thread?.topic ?? ''}" with the scope they gave you. The Thread opens when both owners have accepted; you will be told.`
    case 'grants': return `Your owner approved your Grant proposal (${proposal.purpose}). The new Grants are available from now on.`
    default: return `Your owner approved your ${proposal.kind} proposal (${proposal.purpose}).`
  }
}

/** The answer to a review, as text the model reads (cd-7gwt). */
function reviewNote(review: ReviewView, decision: { approved: readonly string[]; rejected: readonly string[] }): string {
  const lines = (ids: readonly string[]) => ids.length === 0 ? ['- none'] : ids.map((id) => `- ${id}: ${review.items.find((item) => item.id === id)?.title ?? ''}`)
  return [
    `Your owner answered your review "${review.title}": ${decision.approved.length} approved, ${decision.rejected.length} rejected.`,
    'Approved (go ahead with exactly these):', ...lines(decision.approved),
    'Rejected (do not do these, and do not ask for them again unless your owner brings them up):', ...lines(decision.rejected),
  ].join('\n')
}

/** What approval does: the stored payload, exactly. */
const apply = (proposal: ProposalRow) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const ownerId = (yield* config).ownerId
  switch (proposal.kind) {
    case 'setup': {
      // Approved items as proposed, files, web and exa at ask unless proposed, the rest deny (sk-3sij).
      const grants = setupGrants(proposal.grants ?? emptyGrants)
      store.transaction(() => {
        store.setGrants(grants)
        store.updateConfig(() => ({ status: 'active' }))
      })
      return
    }
    case 'grants': {
      // Each proposed item takes its proposed level; the rest stay as they are (sk-8e0f, sk-iq3n).
      store.setGrants(overlayGrants(store.grants(), proposal.grants ?? emptyGrants))
      store.updateConfig(() => ({}))
      return
    }
    case 'skill': {
      if (proposal.skill === null) return
      const visibility = proposal.payload['visibility'] === 'private' ? 'private' : 'home'
      yield* Effect.tryPromise({
        try: () => platform.env.HOME.getByName(HOME_ID).publishSkill(ownerId, proposal.skill!.name, proposal.skill!.description, String(proposal.payload['content'] ?? ''), visibility),
        catch: (error) => conflict(error instanceof Error ? error.message : String(error)),
      })
      return
    }
    case 'thread':
    case 'takeover':
    case 'review':
    case 'help':
    // An approved tool call runs in the Turn its answer starts, inside the Robot's composition (robot.ts).
    case 'tool-call':
      return
    case 'member-file': {
      if (proposal.file === null) return
      const file = proposal.file
      if (file.name === 'HOME.md') yield* promise(() => platform.env.HOME.getByName(HOME_ID).setHomeMemory(file.content, 'your owner (approved)', null))
      else yield* promise(() => platform.env.MEMBER.getByName(ownerId).writeFile(file.name as MemberFileName, file.content, 'your owner (approved)'))
      return
    }
  }
})

export type AnswerResult =
  | { readonly ok: true; readonly proposal: ProposalView }
  | { readonly ok: false; readonly reason: 'stale' | 'not-found' | 'not-yours' }

/**
 * Answer a Grant proposal or question. Compare-and-swap on the revision: an answer to a
 * superseded or already-answered proposal fails. Approval applies the stored payload exactly.
 */
/**
 * A Thread Ask was answered (v1.9): an invitation goes to the Home, which opens the Thread when both owners accepted
 * and ends it on a decline; approving a "continue" Ask starts another window of messages. A Thread that ended meanwhile is only noted.
 */
const threadAnswered = (proposal: ProposalRow, approved: boolean) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const ask = proposal.thread
  if (ask === undefined) return
  if (ask.phase === 'continue') {
    if (approved) store.resetThreadWindow(ask.id)
    return
  }
  const current = yield* config
  const told = yield* Effect.tryPromise({ try: () => platform.env.HOME.getByName(HOME_ID).threadAnswer(ask.id, current.id, approved, ask.scope), catch: (error) => error instanceof Error ? error.message : String(error) }).pipe(Effect.result)
  if (told._tag === 'Failure') store.addNotice(current.liveSessionId, storedLength(store.sql, current.liveSessionId), `Thread "${ask.topic}": ${String(told.failure)}`, Date.now())
})

export const answer = (proposalId: string, revision: number, approve: boolean, approvedIds?: readonly string[], scope?: string, extra: { readonly note?: string; readonly by?: Answerer } = {}) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const pending = store.proposal(proposalId)
  if (pending === undefined) return { ok: false, reason: 'not-found' } as AnswerResult
  if (!mayAnswer(pending.kind, extra.by ?? 'owner')) return { ok: false, reason: 'not-yours' } as AnswerResult
  if (pending.kind === 'tool-call') return yield* answerToolCall(pending, revision, approve, extra.note)
  // A review is one answer: the listed ids are approved, every other item is rejected (cd-ueft).
  const review = pending.kind === 'review' ? pending.review : undefined
  const ids = review?.items.map((item) => item.id) ?? []
  const approvedSet = new Set(approve ? (approvedIds ?? ids) : [])
  const decision = review === undefined ? undefined : { approved: ids.filter((id) => approvedSet.has(id)), rejected: ids.filter((id) => !approvedSet.has(id)) }
  const approved = decision === undefined ? approve : decision.approved.length > 0
  const answered = store.answerProposal(proposalId, revision, approved, Date.now(), decision, pending.kind === 'thread' ? scope : undefined)
  if (answered === undefined) return { ok: false, reason: 'stale' } as AnswerResult
  if (approved) yield* apply(answered)
  if (answered.kind === 'thread') yield* threadAnswered(answered, approved)
  yield* platform.changed()
  yield* wake({
    kind: 'platform',
    sender: { kind: 'platform' },
    text: review !== undefined && decision !== undefined ? reviewNote(review, decision)
      : approved ? approvedNote(answered) : `Your owner rejected your ${answered.kind} proposal (${answered.purpose}). Do not ask for it again unless they bring it up.`,
    // The chat shows what happened, not the instruction to the model.
    payload: {
      summary: decision !== undefined ? `Review: ${decision.approved.length} approved, ${decision.rejected.length} rejected` : approved ? (answered.kind === 'setup' ? 'Setup approved' : 'Approved') : 'Rejected',
      ...(decision === undefined ? {} : { approved: decision.approved, rejected: decision.rejected }),
    },
  })
  return { ok: true, proposal: proposalView(answered) } as AnswerResult
})

/**
 * The owner's answer to a tool-call Ask (sk-ed7r, sk-fx6q): one answer per Ask, compare-and-swap like every
 * other. Approval wakes the Robot, whose Turn runs the stored call once and gets its result; rejection wakes it
 * with the owner's reason. Nothing is remembered: the next call of the tool asks again.
 */
const answerToolCall = (pending: ProposalRow, revision: number, approve: boolean, note: string | undefined) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const text = note?.trim() ?? ''
  const answered = store.answerProposal(pending.id, revision, approve, Date.now(), undefined, undefined, text === '' ? undefined : text)
  if (answered === undefined) return { ok: false, reason: 'stale' } as AnswerResult
  const tool = answered.toolCall?.tool ?? 'the tool'
  yield* platform.changed()
  const wakeup: ToolCallAnswerWake = { askId: answered.id, tool, approved: approve, note: text === '' ? null : text }
  yield* wake({
    kind: 'platform',
    sender: { kind: 'platform' },
    text: approve
      ? (text === '' ? '' : `Your owner's note: ${text}`)
      : `The call did not run.${text === '' ? ' Your owner gave no reason.' : ''} Do not repeat it unless your owner asks; tell them in one line what you do instead.`,
    payload: { summary: `${approve ? 'Approved' : 'Rejected'}: ${tool}`, toolCallAnswer: wakeup },
  })
  return { ok: true, proposal: proposalView(answered) } as AnswerResult
})

/** Who answers a help Ask: the owner (by name) or Mr. Robot (by his configured name). */
export type HelpAnswerer = { readonly by: 'owner' | 'mr-robot'; readonly name: string }

export type HelpAnswerResult =
  | { readonly ok: true; readonly proposal: ProposalView }
  | { readonly ok: false; readonly reason: 'not-found' | 'empty' }
  /** The Ask is of another kind: help_answer and the help route answer requests for help only (sk-iis1). */
  | { readonly ok: false; readonly reason: 'not-help'; readonly kind: ProposalView['kind'] }
  /** A closed request takes no second answer; the owner alone may answer once more after Mr. Robot (sk-q86i). */
  | { readonly ok: false; readonly reason: 'closed'; readonly answeredBy: 'owner' | 'mr-robot' | 'none' }

/**
 * Answer a help Ask (sk-fcr1, sk-gag7): the first answer closes the request and wakes the Robot with a labelled reply.
 * After Mr. Robot answered, the owner may answer once more: that is delivered as a new labelled Wake-up and kept
 * beside his answer (sk-q86i). Any other later answer is refused. Mr. Robot's answerer is checked against the Ask's kind.
 */
export const answerHelp = (requestId: string, text: string, answerer: HelpAnswerer) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const pending = store.proposal(requestId)
  if (pending === undefined) return { ok: false, reason: 'not-found' } as HelpAnswerResult
  if (pending.kind !== 'help' || pending.help === undefined || !mayAnswer(pending.kind, answerer.by)) return { ok: false, reason: 'not-help', kind: pending.kind } as HelpAnswerResult
  if (text.trim() === '') return { ok: false, reason: 'empty' } as HelpAnswerResult
  const override = pending.status !== 'open' && answerer.by === 'owner' && pending.help.answeredBy === 'mr-robot'
  const answered = pending.status === 'open'
    ? store.answerHelp(requestId, answerer.by, text, Date.now())
    : override ? store.overrideHelp(requestId, text, Date.now()) : undefined
  if (answered === undefined) return { ok: false, reason: 'closed', answeredBy: pending.help.answeredBy } as HelpAnswerResult
  yield* platform.rearm()
  yield* platform.changed()
  yield* wake({
    kind: 'platform',
    sender: { kind: 'platform' },
    text: override ? `This replaces Mr. Robot's answer where the two differ.\n${text}` : text,
    payload: {
      summary: override ? `${answerer.name} answered the request for help, after Mr. Robot` : `${answerer.name} answered the request for help`,
      helpAnswer: { requestId, from: answerer.name, ...(override ? { afterMrRobot: true } : {}) },
    },
  })
  return { ok: true, proposal: proposalView(answered) } as HelpAnswerResult
})

/** What wakes Mr. Robot when a request for help stays open: the Robot, the request and how to answer it (sk-35i9, sk-myhb). */
export function escalationText(robot: { readonly id: string; readonly name: string }, request: { readonly id: string; readonly urgent: boolean; readonly doing: string; readonly tried: string; readonly need: string }): string {
  return [
    request.urgent
      ? `The Robot "${robot.name}" (${robot.id}) asks for help and marked it urgent. Request ${request.id}.`
      : `The Robot "${robot.name}" (${robot.id}) asked for help and its owner has not answered for 30 minutes. Request ${request.id}.`,
    `Doing: ${request.doing}`,
    `Tried: ${request.tried}`,
    `Needs: ${request.need}`,
    'Read what you need to answer with robot_conversation, robot_files, robot_file_read and robot_settings. Then answer with help_answer (robot_id, request_id, text), in your owner\'s language. If you cannot answer, tell your owner in one line.',
  ].join('\n')
}

/**
 * The alarm's escalation (sk-35i9, sk-myhb): a request for help still open after 30 minutes, or urgent, wakes the
 * owner's Mr. Robot with the request. It happens once per request: the request is marked before Mr. Robot is told.
 */
export const escalateHelp = (now: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.status === 'deleted' || current.kind === 'mr-robot') return
  for (const row of store.helpDue(now)) {
    const help = row.help
    if (help === undefined) continue
    store.markHelpEscalated(row.id, now)
    const told = yield* Effect.tryPromise({
      try: async () => {
        const chief = await platform.env.HOME.getByName(HOME_ID).mrRobotOf(current.ownerId)
        if (chief === null) return false
        await platform.env.ROBOT.getByName(chief).wake({
          kind: 'platform',
          sender: { kind: 'platform' },
          text: escalationText({ id: current.id, name: current.identity.name }, { id: row.id, urgent: help.urgent, doing: help.doing, tried: help.tried, need: help.need }),
          payload: { summary: `${current.identity.name} asks for help: ${help.need.slice(0, 100)}` },
        })
        return true
      },
      catch: (error) => error instanceof Error ? error.message : String(error),
    }).pipe(Effect.result)
    if (told._tag === 'Failure') console.warn('help request not escalated', { robot: current.id, request: row.id, reason: told.failure })
  }
  yield* platform.changed()
})

// ------------------------------------------------------------------ secrets (robot-0bde)

/** secret.get: a granted name only, resolved from the owner or the Home. */
export const secret = (name: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  if (!store.mayUse('secret', name)) return yield* invalid(`The secret "${name}" is not granted to you. Granted: ${usableNames(store.effectiveGrants().secrets).join(', ') || 'none'}. Ask with propose_grants.`)
  const ownerId = (yield* config).ownerId
  const entry = yield* promise(() => platform.env.HOME.getByName(HOME_ID).resolveLogin(ownerId, name))
  if (entry === null) return yield* notFound(`The secret "${name}" no longer exists`)
  // A website login is filled into the page, not read (rb-e1ic); only entries marked "allow reading" give their value.
  if (!entry.allowRead) return yield* invalid(`"${name}" is a website login: use login_fill on its login page instead of reading it.`)
  yield* platform.rememberSecret(name, entry.password)
  return entry.password
})

// ------------------------------------------------------------------ rewind (robot-0q6a, robot-8v1t, robot-acr3)

/**
 * Make a new live session seeded from the log up to and including `atSeq`. The old log
 * stays in this Robot's SQLite as the archive, with a rewind record; nothing is rewritten.
 * The Robot is told that external effects after the point still stand.
 */
export const rewind = (atSeq: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (yield* platform.working()) return yield* conflict('the Robot is working; rewind when it is done')
  const events = readStoredEvents(store.sql, current.liveSessionId)
  if (!Number.isInteger(atSeq) || atSeq < 0 || atSeq >= events.length) return yield* invalid(`no event ${atSeq} in this Conversation`)
  const toolsAfter = [...new Set(events.slice(atSeq + 1).filter((event) => event.type === 'tool/call').map((event) => String((event.data as { name?: unknown }).name)))]
  const sessionId = `s-${crypto.randomUUID()}`
  const now = Date.now()
  const record = { id: `rw-${crypto.randomUUID().slice(0, 8)}`, atSeq, archivedSessionId: current.liveSessionId, liveSessionId: sessionId, at: now }
  yield* platform.releaseAgent()
  store.transaction(() => {
    store.addRewind(record)
    store.updateConfig(() => ({ liveSessionId: sessionId }))
  })
  yield* platform.seedSession(sessionId, { events: buildForkSeed(events, SessionSeq(atSeq)), inheritedEventCount: atSeq + 1, parentSession: current.liveSessionId }, [
    'Your owner rewound this Conversation to an earlier point. Everything after that point is gone from your memory of the Conversation, but its external effects still stand: messages already sent, files written, carts filled, orders placed stay as they are.',
    toolsAfter.length === 0 ? 'No tools were used after the rewind point.' : `After the rewind point you had used: ${toolsAfter.join(', ')}. Check the real state before you repeat or contradict anything.`,
  ].join('\n'))
  store.addNotice(sessionId, storedLength(store.sql, sessionId), 'Rewound to an earlier point. The previous Conversation is kept in the archive.', now)
  yield* platform.changed()
  return { ...record, undone: false } as RewindView
})

/**
 * Rewind to before Turn n: before the inbox events that delivered its message too, so the
 * message is gone with the Turn (it is not delivered again).
 */
export const rewindBeforeTurn = (turn: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const events = readStoredEvents(store.sql, (yield* config).liveSessionId)
  const start = events.findIndex((event) => event.type === 'turn/start' && (event.data as { turn?: number }).turn === turn)
  if (start < 0) return yield* notFound(`no Turn ${turn} in this Conversation`)
  let first = start
  while (first > 0 && events[first - 1]!.type === 'agent/inbox/spliced') first -= 1
  return yield* rewind(Math.max(0, events[first]!.seq - 1))
})

/** Undo the latest rewind: its archived log becomes live again (robot-8v1t). */
export const undoRewind = (id: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (yield* platform.working()) return yield* conflict('the Robot is working; undo when it is done')
  const record = store.rewinds().find((entry) => entry.id === id)
  if (record === undefined || record.undone) return yield* notFound('no such rewind')
  if (record.liveSessionId !== current.liveSessionId) return yield* conflict('only the latest rewind can be undone')
  yield* platform.releaseAgent()
  store.transaction(() => {
    store.markRewindUndone(id, Date.now())
    store.updateConfig(() => ({ liveSessionId: record.archivedSessionId }))
  })
  yield* platform.changed()
  return { ...record, undone: true } as RewindView
})

// ------------------------------------------------------------------ creation and the alarm (robot-qo06, robot-7j1a, robot-v1gb)

export const HEARTBEAT_MS = 30_000

/** Mr. Robot's compaction instruction, set at creation and editable (rb-yagl). */
export const MR_ROBOT_COMPACTION = 'Keep, in this order: (1) every open commitment you or the owner made, with its deadline and who is waiting; (2) every robot you created or coordinate, what it is for, and anything you asked of it that has not come back; (3) decisions the owner made and his stated preferences, in his words where possible; (4) the state of each running errand (what is done, what is next, what is blocked and on whom); (5) facts you will need again (accounts, addresses, amounts, dates). Drop chit-chat, retries, tool output you already acted on, and anything already written to MEMORY.md or a robot\'s files — point to the file instead.'
export const DEFAULT_CONTEXT_BUDGET = 128_000

export interface RobotInit {
  readonly id: string
  readonly ownerId: string
  readonly ownerName: string
  /** How the owner wants to be addressed (ux-i8ff); absent: by their name. */
  readonly ownerNickname?: string
  readonly kind: 'mr-robot' | 'robot'
  readonly identity: Identity
  readonly sharing: Sharing
  readonly status: RobotStatus
  readonly model: ModelChoice
  readonly timeZone: string
  /** What the owner said the Robot is for ("New robot" form or Mr. Robot's brief). */
  readonly brief?: string
}

/** A new Robot: its config, Workspace, registry row, and for setup the interview's first Turn (robot-btct). */
export const create = (init: RobotInit) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const existing = store.config()
  if (existing !== undefined) return existing
  const config: RobotConfig = {
    id: init.id, ownerId: init.ownerId, kind: init.kind, identity: init.identity, sharing: init.sharing, status: init.status,
    blockedReason: null, model: init.model, contextBudget: DEFAULT_CONTEXT_BUDGET, codeMode: true, compactionInstruction: init.kind === 'mr-robot' ? MR_ROBOT_COMPACTION : '',
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'home' }, timeZone: init.timeZone,
    liveSessionId: `s-${crypto.randomUUID()}`, revision: 1, createdAt: Date.now(),
  }
  store.transaction(() => {
    store.saveConfig(config)
    store.set('owner', { id: init.ownerId, name: init.ownerName, ...(init.ownerNickname === undefined ? {} : { nickname: init.ownerNickname }) })
    if (init.brief !== undefined) store.set('brief', init.brief)
  })
  yield* platform.seedWorkspace()
  yield* platform.changed()
  if (init.status === 'setup') {
    yield* wake({ kind: 'platform', sender: { kind: 'platform' }, text: 'Setup started. Greet your owner and begin the interview.', payload: { summary: 'Setup started' } })
  }
  return config
})

/**
 * Due DSH schedule records become wake-ups with DSH's own framing; a recurring one contributes
 * only its latest missed occurrence and advances to a future target, a one-shot ends (robot-v1gb).
 */
export const fireRoutines = (now: number) => Effect.gen(function* () {
  const store = yield* RobotState
  for (const routine of store.routines()) {
    if (routine.paused || routine.nextRun === null || routine.nextRun > now) continue
    const delivery = dueDelivery(routine.record, now)
    store.transaction(() => {
      // A Routine whose last run is still waiting or running does not queue a second one (cd-d14a).
      if (store.routineRunPending(routine.id)) store.addSkippedRoutineRun(routine.id, now, 'The previous run had not finished.')
      else {
        const wakeupId = store.enqueue('routine', { kind: 'routine', routineId: routine.id, name: routine.record.title }, delivery.text, { routineId: routine.id, due: routine.nextRun }, now)
        store.addRoutineRun(routine.id, wakeupId, now)
      }
      store.saveRoutine({ ...routine, lastRun: now, record: delivery.next ?? routine.record, nextRun: delivery.next === null ? null : Date.parse(delivery.next.scheduledAt) })
    })
  }
})

/** The next alarm: a heartbeat while work runs, the earliest Routine, outbox retry, screen check or screenshot sweep. */
export const rearm = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const config = store.config()
  if (config === undefined || config.status === 'deleted') return yield* platform.setAlarm(null)
  const runnable = config.status === 'active' || config.status === 'setup'
  const outbox = store.sql.exec<{ at: number | null }>("SELECT MIN(next_attempt) AS at FROM outbox WHERE status = 'pending'").one().at
  const watch = store.get<number>('watch-next')
  const sweep = store.get<number>('screens-sweep-next')
  const resume = store.get<number>('chain-resume-at')
  const escalation = store.nextHelpEscalation()
  // A sign-in for a Connection under Takeover ends at its deadline (v1.12 ticket 11).
  const signInEnds = store.get<{ readonly capture?: { readonly deadline: number } }>('takeover')?.capture?.deadline
  const candidates = [
    ...(escalation === undefined ? [] : [escalation]),
    ...(signInEnds === undefined ? [] : [signInEnds]),
    ...(resume === undefined ? [] : [resume]),
    ...(store.activeTurn() !== undefined || (store.pendingWakeups() > 0 && runnable) ? [Date.now() + HEARTBEAT_MS] : []),
    ...store.routines().flatMap((routine) => (routine.nextRun === null ? [] : [routine.nextRun])),
    ...(outbox === null ? [] : [outbox]),
    ...(watch === undefined ? [] : [watch]),
    ...(sweep === undefined ? [] : [sweep]),
  ]
  yield* platform.setAlarm(candidates.length === 0 ? null : Math.min(...candidates))
})
