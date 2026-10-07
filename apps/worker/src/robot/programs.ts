/**
 * The Robot's own state changes as Effect programs (ticket 23, robot-naul): Routines, Robot
 * messages, Mr. Robot's coordination and the lifecycle. The Robot Durable Object provides
 * the services and runs them; DSH's agent loop and the browser stay at its boundary.
 */
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type { DirectoryEntry } from '../agent/tools/messaging.ts'
import type { NotificationKind, ProposalView, RobotSettings, RoutineSchedule, RoutineView, SettingsPatch } from '@mr-robot/protocol'
import type { MemberFileName } from '../member/member.ts'
import { currentMonth } from '../home/home.ts'
import { HOME_ID, type Env } from '../env.ts'
import { conflict, invalid, notFound } from '../platform/durable.ts'
import { cronOf, describeSchedule, nextRun, validateSchedule } from './schedule.ts'
import type { ProposalRow, RobotStore, RoutineRow, WakeupKind } from './store.ts'
import { buildForkSeed, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { readStoredEvents, storedLength } from '../agent/session-log.ts'
import type { RewindView } from '@mr-robot/protocol'
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
  /** Push to the Robot's notification recipients through its Channels. */
  notifyMembers(kind: NotificationKind, body: string): Effect.Effect<number>
  /** Keep a fetched secret's value in memory to mask it (never stored). */
  rememberSecret(name: string, value: string): Effect.Effect<void>
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

// ------------------------------------------------------------------ settings and Grants (robot-vqtw)

export const settings = Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  return {
    identity: current.identity,
    sharing: current.sharing,
    model: current.model,
    contextBudget: current.contextBudget,
    codeMode: current.codeMode,
    wakeOnScreenNotifications: current.wakeOnScreenNotifications === true,
    compactionInstruction: current.compactionInstruction,
    grants: store.grants(),
    notifications: current.notifications,
    spendLimitUsd: current.spendLimitUsd,
  } as RobotSettings
})

/** Mr. Robot's recipients follow what his Member can reach (robot-70kf). */
export const setRecipients = (robotIds: readonly string[]) => Effect.gen(function* () {
  const store = yield* RobotState
  const grants = store.grants()
  if (grants.recipients.length === robotIds.length && grants.recipients.every((id) => robotIds.includes(id))) return
  store.setGrants({ ...grants, recipients: [...robotIds] })
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
  const robotLimit = current.spendLimitUsd ?? limits.robotDefaultUsd
  const spent = store.usage(currentMonth()).costUsd
  const reason = robotLimit !== null && spent >= robotLimit
    ? `This Robot reached its monthly spend limit (${usd(spent)} of ${usd(robotLimit)}).`
    : limits.memberUsd !== null && limits.memberSpentUsd >= limits.memberUsd
      ? `Your Robots reached your monthly spend limit (${usd(limits.memberSpentUsd)} of ${usd(limits.memberUsd)}).`
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
export const updateSettings = (patch: SettingsPatch) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  store.transaction(() => {
    if (patch.grants !== undefined) store.setGrants(patch.grants)
    store.updateConfig((current) => ({
      ...(patch.identity === undefined ? {} : { identity: patch.identity }),
      ...(patch.sharing === undefined ? {} : { sharing: patch.sharing }),
      ...(patch.model === undefined ? {} : { model: patch.model }),
      ...(patch.contextBudget === undefined ? {} : { contextBudget: Math.max(8_000, Math.round(patch.contextBudget)) }),
      ...(patch.codeMode === undefined ? {} : { codeMode: patch.codeMode }),
      ...(patch.wakeOnScreenNotifications === undefined ? {} : { wakeOnScreenNotifications: patch.wakeOnScreenNotifications }),
      ...(patch.compactionInstruction === undefined ? {} : { compactionInstruction: patch.compactionInstruction }),
      ...(patch.notifications === undefined ? {} : { notifications: { ...patch.notifications, channels: [...new Set(['pwa', ...patch.notifications.channels])] } }),
      ...(patch.spendLimitUsd === undefined ? {} : { spendLimitUsd: patch.spendLimitUsd }),
      ...(current.kind === 'mr-robot' && patch.sharing !== undefined ? { sharing: 'private' as const } : {}),
    }))
  })
  yield* platform.changed()
  if (patch.spendLimitUsd !== undefined) yield* checkLimits
  if (patch.wakeOnScreenNotifications === false) yield* platform.stopWatching()
  return yield* settings
})

// ------------------------------------------------------------------ proposals and the owner's answers (robot-cobv, robot-vy9z)

export function proposalView(row: ProposalRow): ProposalView {
  return { id: row.id, kind: row.kind, revision: row.revision, status: row.status, purpose: row.purpose, grants: row.grants, file: row.file, skill: row.skill }
}

function approvedNote(proposal: ProposalRow): string {
  switch (proposal.kind) {
    case 'setup': return 'Your owner approved your setup. You are active now with exactly the Grants you proposed. Say hello in one line and tell them what happens next.'
    case 'grants': return `Your owner approved your Grant proposal (${proposal.purpose}). The new Grants are available from now on.`
    default: return `Your owner approved your ${proposal.kind} proposal (${proposal.purpose}).`
  }
}

const NO_GRANTS = { tools: [], skills: [], recipients: [], secrets: [] }

/** What approval does: the stored payload, exactly. */
const apply = (proposal: ProposalRow) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const ownerId = (yield* config).ownerId
  switch (proposal.kind) {
    case 'setup': {
      const grants = proposal.grants ?? NO_GRANTS
      store.transaction(() => {
        store.setGrants(grants)
        store.updateConfig(() => ({ status: 'active' }))
      })
      return
    }
    case 'grants': {
      const current = store.grants()
      const add = proposal.grants ?? NO_GRANTS
      store.setGrants({ tools: [...current.tools, ...add.tools], skills: [...current.skills, ...add.skills], recipients: [...current.recipients, ...add.recipients], secrets: [...current.secrets, ...add.secrets] })
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
    case 'member-file': {
      if (proposal.file === null) return
      yield* promise(() => platform.env.MEMBER.getByName(ownerId).writeFile(proposal.file!.name as MemberFileName, proposal.file!.content))
      return
    }
  }
})

export type AnswerResult =
  | { readonly ok: true; readonly proposal: ProposalView }
  | { readonly ok: false; readonly reason: 'stale' | 'not-found' }

/**
 * Answer a Grant proposal or question. Compare-and-swap on the revision: an answer to a
 * superseded or already-answered proposal fails. Approval applies the stored payload exactly.
 */
export const answer = (proposalId: string, revision: number, approve: boolean) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  if (store.proposal(proposalId) === undefined) return { ok: false, reason: 'not-found' } as AnswerResult
  const answered = store.answerProposal(proposalId, revision, approve, Date.now())
  if (answered === undefined) return { ok: false, reason: 'stale' } as AnswerResult
  if (approve) yield* apply(answered)
  yield* platform.changed()
  yield* wake({
    kind: 'platform',
    sender: { kind: 'platform' },
    text: approve ? approvedNote(answered) : `Your owner rejected your ${answered.kind} proposal (${answered.purpose}). Do not ask for it again unless they bring it up.`,
    // The chat shows what happened, not the instruction to the model.
    payload: { summary: approve ? (answered.kind === 'setup' ? 'Setup approved' : 'Approved') : 'Rejected' },
  })
  return { ok: true, proposal: proposalView(answered) } as AnswerResult
})

// ------------------------------------------------------------------ secrets (robot-0bde)

/** secret.get: a granted name only, resolved from the owner or the Home. */
export const secret = (name: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const granted = store.grants().secrets
  if (!granted.includes(name)) return yield* invalid(`The secret "${name}" is not granted to you. Granted: ${granted.join(', ') || 'none'}. Ask with propose_grants.`)
  const ownerId = (yield* config).ownerId
  const value = yield* promise(() => platform.env.HOME.getByName(HOME_ID).resolveSecret(ownerId, name))
  if (value === null) return yield* notFound(`The secret "${name}" no longer exists`)
  yield* platform.rememberSecret(name, value)
  return value
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
