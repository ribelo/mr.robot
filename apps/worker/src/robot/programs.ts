/**
 * The Robot's own state changes as Effect programs (ticket 23, robot-naul): Routines, Robot
 * messages, Mr. Robot's coordination and the lifecycle. The Robot Durable Object provides
 * the services and runs them; DSH's agent loop and the browser stay at its boundary.
 */
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type { DirectoryEntry } from '../agent/tools/messaging.ts'
import type { RoutineSchedule, RoutineView } from '@mr-robot/protocol'
import { HOME_ID, type Env } from '../env.ts'
import { conflict, invalid, notFound } from '../platform/durable.ts'
import { cronOf, describeSchedule, nextRun, validateSchedule } from './schedule.ts'
import type { RobotStore, RoutineRow, WakeupKind } from './store.ts'
import type { Sender, Attachment } from '@mr-robot/protocol'

export const MAX_CHAIN_HOPS = 8
export const MAX_QUEUED_WAKEUPS = 32

export interface WakeInput {
  readonly kind: WakeupKind
  readonly sender: Sender
  readonly text: string
  readonly attachments?: readonly Attachment[]
  readonly payload?: Record<string, unknown>
}

/** A message between Robots, as the platform carries it (robot-mv15). */
export interface RobotMessage {
  readonly id: string
  readonly kind: 'request' | 'reply'
  readonly from: { readonly robotId: string; readonly ownerId: string; readonly name: string; readonly avatarColor: string }
  readonly text: string
  readonly requestId: string
  readonly chain: { readonly id: string; readonly hops: number }
}

export type ReceiveResult = { readonly accepted: true } | { readonly accepted: false; readonly reason: 'unavailable' | 'queue-full' | 'chain-limit' }

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
  /** Close a browser kept open for screen notifications. */
  stopWatching(): Effect.Effect<void>
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

/** Queue a Wake-up and make sure the queue is being drained. */
export const wake = (input: WakeInput) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  if ((yield* config).status === 'deleted') return yield* invalid('robot is deleted')
  const id = store.enqueue(input.kind, input.sender, input.text, { ...input.payload, attachments: input.attachments ?? [] }, Date.now())
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

export function routineView(robotId: string, routine: RoutineRow, runs: RoutineView['runs']): RoutineView {
  return {
    id: routine.id, name: routine.name, prompt: routine.prompt, schedule: routine.schedule, timeZone: routine.timeZone,
    nextRun: routine.nextRun, lastRun: routine.lastRun, paused: routine.paused, robotId,
    summary: describeSchedule(routine.schedule, routine.timeZone),
    cron: cronOf(routine.schedule, routine.timeZone),
    runs,
  }
}

const view = (routine: RoutineRow) => Effect.gen(function* () {
  const store = yield* RobotState
  return routineView((yield* config).id, routine, store.routineRuns(routine.id))
})

const routinesChanged = Effect.gen(function* () {
  const platform = yield* RobotPlatform
  yield* platform.rearm()
})

const schedule = (input: RoutineSchedule, timeZone: string, now: number) => Effect.try({
  try: () => validateSchedule(input, timeZone, now),
  catch: (error) => invalid(error instanceof Error ? error.message : String(error)),
})

export const createRoutine = (input: { name: string; prompt: string; schedule: RoutineSchedule }) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const now = Date.now()
  const valid = yield* schedule(input.schedule, current.timeZone, now)
  if (input.name.trim() === '' || input.prompt.trim() === '') return yield* invalid('a Routine needs a name and a prompt')
  const routine: RoutineRow = {
    id: `rt-${crypto.randomUUID().slice(0, 8)}`,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    schedule: valid,
    timeZone: current.timeZone,
    nextRun: nextRun(valid, current.timeZone, now, now),
    lastRun: null,
    paused: false,
    createdAt: now,
  }
  store.saveRoutine(routine)
  yield* routinesChanged
  return yield* view(routine)
})

export const updateRoutine = (id: string, input: { name?: string; prompt?: string; schedule?: RoutineSchedule }) => Effect.gen(function* () {
  const store = yield* RobotState
  const existing = store.routine(id)
  if (existing === undefined) return yield* notFound(`no Routine ${id}`)
  const now = Date.now()
  const valid = input.schedule === undefined ? existing.schedule : yield* schedule(input.schedule, existing.timeZone, now)
  const routine: RoutineRow = {
    ...existing,
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(input.prompt === undefined ? {} : { prompt: input.prompt.trim() }),
    schedule: valid,
    nextRun: input.schedule === undefined ? existing.nextRun : nextRun(valid, existing.timeZone, now, now),
    ...(input.schedule === undefined ? {} : { createdAt: now }),
  }
  store.saveRoutine(routine)
  yield* routinesChanged
  return yield* view(routine)
})

export const deleteRoutine = (id: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const existing = store.routine(id)
  if (existing === undefined) return yield* notFound(`no Routine ${id}`)
  const shown = yield* view(existing)
  store.deleteRoutine(id)
  yield* routinesChanged
  return shown
})

export const listRoutines = Effect.gen(function* () {
  const store = yield* RobotState
  return yield* Effect.forEach(store.routines(), view)
})

/** The owner deletes a Routine from the panel (robot-qyd5). */
export const removeRoutine = (id: string) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  yield* deleteRoutine(id)
  yield* platform.changed()
})

/** Pause keeps the Routine and its schedule but stops its alarm; resume plans the next run from now (robot-qhll). */
export const pauseRoutine = (id: string, paused: boolean) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const routine = store.routine(id)
  if (routine === undefined) return yield* notFound('no such Routine')
  const saved = { ...routine, paused, nextRun: paused ? null : nextRun(routine.schedule, routine.timeZone, Date.now(), routine.createdAt) }
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
  const granted = new Set(store.grants().recipients)
  const reachable = yield* promise(() => platform.env.HOME.getByName(HOME_ID).reachable(current.ownerId))
  return reachable
    .filter((robot) => granted.has(robot.id) && robot.id !== current.id && robot.status === 'active')
    .map((robot): DirectoryEntry => ({ id: robot.id, name: robot.identity.name, description: robot.identity.description, availability: robot.fleetState }))
})

const enqueueOutbox = (recipient: string, message: RobotMessage) => Effect.gen(function* () {
  const store = yield* RobotState
  store.sql.exec(
    "INSERT INTO outbox (id, recipient, payload, status, attempts, next_attempt, created_at) VALUES (?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT (id) DO NOTHING",
    message.id, recipient, JSON.stringify(message), Date.now(), Date.now(),
  )
})

function undeliverable(reason: 'unavailable' | 'queue-full' | 'chain-limit'): string {
  return reason === 'unavailable' ? 'that Robot is not active' : reason === 'queue-full' ? 'that Robot has too much queued work; try later' : 'the chain of Robot messages is too long'
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

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...bytes.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const sender = Effect.map(config, (current) => ({ robotId: current.id, ownerId: current.ownerId, name: current.identity.name, avatarColor: current.identity.avatarColor }))

export const sendRobotMessage = (to: string, text: string, idempotencyKey: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (!store.hasGrant('recipient', to)) return yield* invalid(`You have no Grant to message ${to}. Ask your owner with propose_grants (recipients).`)
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
  if (message.kind === 'request' && message.chain.hops > MAX_CHAIN_HOPS) return { accepted: false, reason: 'chain-limit' } as ReceiveResult
  if (store.pendingWakeups() >= MAX_QUEUED_WAKEUPS) return { accepted: false, reason: 'queue-full' } as ReceiveResult
  const handle = message.kind === 'request' ? `rh-${crypto.randomUUID()}` : undefined
  store.transaction(() => {
    store.sql.exec('INSERT INTO intake (key, sender, received_at) VALUES (?, ?, ?)', message.id, message.from.robotId, Date.now())
    if (handle !== undefined) store.sql.exec('INSERT INTO reply_handle (id, sender_robot, request_id, chain) VALUES (?, ?, ?, ?)', handle, message.from.robotId, message.requestId, message.chain.hops)
    store.enqueue(
      'robot',
      { kind: 'robot', robotId: message.from.robotId, name: message.from.name, avatarColor: message.from.avatarColor },
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

export const configureRobot = (id: string, change: { name?: string; title?: string; description?: string }) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.kind !== 'mr-robot') return yield* invalid('only Mr. Robot configures Robots')
  const entry = yield* promise(() => platform.env.HOME.getByName(HOME_ID).entry(id))
  if (entry === undefined || entry.ownerId !== current.ownerId || entry.kind !== 'robot' || entry.status === 'deleted') return yield* invalid(`${id} is not one of your owner's Robots`)
  const identity = { ...entry.identity, ...Object.fromEntries(Object.entries(change).filter(([, value]) => typeof value === 'string' && value.trim() !== '')) }
  const settings = yield* promise(() => platform.env.ROBOT.getByName(id).updateSettings({ identity }))
  return { id, identity: settings.identity as unknown }
})
