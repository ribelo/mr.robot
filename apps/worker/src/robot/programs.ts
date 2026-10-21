/**
 * The Robot's own state changes as Effect programs (ticket 23, robot-naul): Task Wake-ups, Robot
 * messages, Mr. Robot's coordination and the lifecycle. The Robot Durable Object provides
 * the services and runs them; DSH's agent loop and the browser stay at its boundary.
 */
import * as Context from 'effect/Context'
import { IDLE_PLAN } from '../plugins/idle.ts'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import type { DirectoryEntry } from '../agent/tools/messaging.ts'
import type { HostAccessByFacet, NotificationKind, ProposalView, ReviewView, RobotSettings, SettingsPatch, WorkDetails, WorkspaceSetting } from '@mr-robot/protocol'
import { HOST_ACCESS, parseHostAccess } from './host-access.ts'
import { WORK_DETAILS, WORKSPACE, WORKSPACE_CWD, type CheckedWorkspace } from './workspace-setting.ts'
import type { MemberFileName } from '../member/member.ts'
import { currentMonth } from '../space/space.ts'
import { SPACE_ID, type Env } from '../env.ts'
import { chainOf, modelOf, withModel } from './chain.ts'
import { conflict, invalid, notFound } from '../platform/durable.ts'
import { chiefGrants, type ProposalRow, type RobotConfig, type RobotStore, type WakeupKind } from './store.ts'
import { setupGrants } from '../agent/catalog.ts'
import { effectiveSpendLimit, emptyGrants, GRANT_FIELDS, grantSetFrom, overlayGrants, usableNames, type GrantItemRef, type GrantSet, type SpaceSpendLimit } from '@mr-robot/protocol'
import { THREAD_PAUSE_AT, timeLabel, type AskAnswerLabel } from '../agent/sources.ts'
import type { Identity, ModelChoice, RobotStatus, Sharing } from '@mr-robot/protocol'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Chapter } from './chapters.ts'
import { chapterSeed } from '../agent/chapter-seed.ts'
import type { GrantsForm, TasksForm } from '../definitions/definition.ts'
import { coldChapter } from './cold-chapters.ts'
import { readStoredEvents, storedHeader, storedLength, storeSession } from '../agent/session-log.ts'
import type { RewindView } from '@mr-robot/protocol'
import type { Sender, Attachment } from '@mr-robot/protocol'
import { causedByOwner, deliveryOf, robotMessageDelivery } from './delivery.ts'
import { SubagentStore } from './subagent-store.ts'
import { withDistinctNames } from '../places/host-names.ts'
import { JOB_CHECK_MS } from '../places/jobs.ts'
import { afterReturn, gateTask, heldHosts, outageNotice, taskHostFacets, type KnownHost, type TaskGate } from './hosts-gate.ts'
import { DEFAULT_IDLE_FLOOR_TOKENS, idleSettings, type IdleStep } from './idle.ts'

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
  /** The owner sent it as a follow-up on purpose (Ctrl+Enter, ao-q2z4): it waits for its own Turn. */
  readonly followup?: boolean
}

/** A message between Robots, as the platform carries it (robot-mv15). */
interface MessageCommon {
  readonly id: string
  /** `avatarSeed` is absent in messages queued before avatar seeds existed: the sender's id is its seed. */
  readonly from: { readonly robotId: string; readonly ownerId: string; readonly name: string; readonly avatarColor: string; readonly avatarSeed?: string }
  readonly text: string
  readonly requestId: string
  readonly chain: { readonly id: string; readonly hops: number }
  /** A question for the recipient to answer, not work to do (v1.15, gb-l1x1). */
  readonly question?: boolean
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
  /** Re-plan the alarm (Tasks, outbox, heartbeat). */
  rearm(): Effect.Effect<void>
  /** The earliest moment a registered duty has planned (duties.ts). */
  dutiesNext(): Effect.Effect<number | undefined>
  /** Tell open views and the Space that something visible changed. */
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
  seedWorkspace(files: ReadonlyArray<{ readonly path: string; readonly body: Uint8Array }>): Effect.Effect<void>
  /** A Turn is running or about to run. */
  working(): Effect.Effect<boolean>
  /** Dispose the DSH agent so the next Turn composes over the current live session. */
  releaseAgent(): Effect.Effect<void>
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

/**
 * The events of a chapter's session or of a Subagent's, from R2 when the chapter is cold (v1.19, ec-aly5): cold is slower to open,
 * never gone.
 */
export const logOf = (sessionId: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const owner = store.chapters.get(sessionId) !== undefined ? sessionId : new SubagentStore(store.sql).get(sessionId)?.parentSession
  const chapter = owner === undefined ? undefined : store.chapters.get(owner)
  const cold = chapter === undefined ? undefined : yield* Effect.promise(() => coldChapter(platform.env.FILES, (store.config()?.id ?? ''), chapter))
  if (cold === undefined) return readStoredEvents(store.sql, sessionId)
  return [...(sessionId === cold.sessionId ? cold.events : cold.subagents[sessionId] ?? [])]
})

/** Whether a session's events are in R2: its chapter (or the chapter its Subagent ran in) is cold. */
export function isCold(store: RobotStore, sessionId: string): boolean {
  const owner = store.chapters.get(sessionId) !== undefined ? sessionId : new SubagentStore(store.sql).get(sessionId)?.parentSession
  const state = owner === undefined ? undefined : store.chapters.get(owner)?.state
  return state?.kind === 'closed' && state.cold
}

// ------------------------------------------------------------------ wake-ups and lifecycle (robot-qo06)

/** The latest client ids with their Wake-up ids: a retry comes within seconds, so a short list is enough to accept a send once. */
const RECENT_CLIENT_IDS = 'recent-client-ids'
const RECENT_CLIENT_ID_LIMIT = 200

/** Queue a Wake-up and make sure the queue is being drained. */
export const wake = (input: WakeInput) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.status === 'deleted') return yield* invalid('robot is deleted')
  const recent = store.get<ReadonlyArray<readonly [string, number]>>(RECENT_CLIENT_IDS) ?? []
  const seen = input.clientId === undefined ? undefined : recent.find(([clientId]) => clientId === input.clientId)
  if (seen !== undefined) return seen[1]
  // Any Wake-up ends the idle wait: no warming or idle compaction is due any more (ao-8hi8).
  store.delete(IDLE_PLAN)
  // The owner moved on: a question that asked to go when they did is dismissed, and this message tells the Robot so (gb-nr8s).
  const dismissed = causedByOwner({ kind: input.kind, sender: input.sender, payload: input.payload ?? {} }, current.ownerId) && input.kind !== 'platform' ? store.dismissOnMoveOn(Date.now()) : []
  const id = store.enqueue(input.kind, input.sender, input.text, {
    ...input.payload,
    ...(dismissed.length === 0 ? {} : { dismissedAsks: dismissed.map((row) => ({ askId: row.id, prompt: row.question?.prompt ?? row.purpose })) }),
    attachments: input.attachments ?? [],
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
  }, Date.now(), deliveryOf(input, current.ownerId))
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
  const reachable = yield* promise(() => platform.env.SPACE.getByName(SPACE_ID).reachable(current.ownerId))
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

export const sendRobotMessage = (to: string, text: string, idempotencyKey: string, question = false) => Effect.gen(function* () {
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
  yield* enqueueOutbox(to, { id, kind: 'request', from: yield* sender, text: yield* platform.mask(text), requestId: id, chain: { id: chain.id, hops: chain.hops + 1 }, ...(question ? { question: true } : {}) })
  yield* platform.background(deliverOutbox)
  return { requestId: id, status: question ? 'asked; the answer will arrive as a message' : 'sent; the reply will arrive as a message' }
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
    // The "opened" note may come after the first message: a copy still invited asks the Space, which opens a Thread only when both owners accepted.
    const copy = known.view.state === 'invited'
      ? yield* Effect.promise(() => platform.env.SPACE.getByName(SPACE_ID).threadView(message.threadId, current.id)).pipe(Effect.map((view) => (view === undefined ? known : store.saveThread({ ...view, messageCount: known.view.messageCount }, Date.now()))))
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
      message.kind === 'request' ? { requestId: message.requestId, replyHandle: handle, chain: message.chain, ...(message.question === true ? { question: true } : {}) } : { replyTo: message.requestId, chain: message.chain },
      Date.now(),
      robotMessageDelivery(message.from, message.kind, current.ownerId),
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
  const entry = yield* Effect.tryPromise({ try: () => platform.env.SPACE.getByName(SPACE_ID).createRobot(current.ownerId, brief), catch: (error) => invalid(error instanceof Error ? error.message : String(error)) })
  return { id: entry.id, status: 'created; it is interviewing your owner in its own Conversation and will propose its Grants there' }
})

// ------------------------------------------------------------------ settings and Grants (robot-vqtw)

/** What "the Space's" is for this Robot now: the Space's per-Robot limit and its default reviewer. */
export interface SpaceDefaults {
  readonly robotSpendLimit: SpaceSpendLimit
  readonly defaultReviewer: ModelChoice | null
  readonly defaultDreaming: boolean
  readonly defaultDreamModel: ModelChoice | null
}

export const spaceDefaults = Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const settings = yield* promise(() => platform.env.SPACE.getByName(SPACE_ID).settings())
  return { robotSpendLimit: settings.robotSpendLimit, defaultReviewer: settings.defaultReviewer, defaultDreaming: settings.defaultDreaming, defaultDreamModel: settings.defaultDreamModel } as SpaceDefaults
})

/** The settings, with the Space's defaults already read. */
export const settingsWith = (defaults: SpaceDefaults) => Effect.gen(function* () {
  const space = defaults.robotSpendLimit
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
    spaceSpendLimit: space,
    ...idleSettings(current),
    autoReview: current.autoReview === true,
    requiresHosts: current.requiresHosts === true,
    reviewer: current.reviewer ?? null,
    spaceReviewer: defaults.defaultReviewer,
    dreaming: current.dreaming ?? null,
    dreamModel: current.dreamModel ?? null,
    spaceDreaming: defaults.defaultDreaming,
    spaceDreamModel: defaults.defaultDreamModel,
    subagentModels: store.grantPayload<{ allowedModels?: Array<{ provider: string; model: string }> }>('tool', 'subagents')?.allowedModels ?? [],
    hostAccess: store.get<HostAccessByFacet>(HOST_ACCESS) ?? {},
    workspace: store.get<WorkspaceSetting>(WORKSPACE) ?? null,
    workDetails: store.get<WorkDetails>(WORK_DETAILS) ?? null,
  } as RobotSettings
})

export const settings = Effect.flatMap(spaceDefaults, settingsWith)

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
  const limits = yield* promise(() => platform.env.SPACE.getByName(SPACE_ID).limitsFor(current.ownerId))
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
  note((before.browserBackend ?? null) !== (after.browserBackend ?? null), `changed the browser backend to ${after.browserBackend ?? 'the Space default'}.`)
  note(before.notifications.enabled !== after.notifications.enabled, `switched notifications ${after.notifications.enabled ? 'on' : 'off'}.`)
  note(before.notifications.channels.join(',') !== after.notifications.channels.join(','), `changed notification channels to ${after.notifications.channels.join(', ')}.`)
  note((before.wakeOnScreenNotifications === true) !== (after.wakeOnScreenNotifications === true), `switched waking on screen notifications ${after.wakeOnScreenNotifications === true ? 'on' : 'off'}.`)
  const [idleBefore, idleAfter] = [idleSettings(before), idleSettings(after)]
  note(idleBefore.cacheWarming !== idleAfter.cacheWarming, `switched cache warming ${idleAfter.cacheWarming ? 'on' : 'off'}.`)
  note(idleBefore.idleCompaction !== idleAfter.idleCompaction, `switched idle compaction ${idleAfter.idleCompaction ? 'on' : 'off'}.`)
  note(idleBefore.idleCompactionFloorTokens !== idleAfter.idleCompactionFloorTokens, `changed the idle compaction floor to ${idleAfter.idleCompactionFloorTokens} tokens.`)
  note((before.autoReview === true) !== (after.autoReview === true), `switched Auto review ${after.autoReview === true ? 'on' : 'off'}.`)
  note((before.requiresHosts === true) !== (after.requiresHosts === true), `switched "do not run while any of my Hosts is offline" ${after.requiresHosts === true ? 'on' : 'off'}.`)
  note((before.dreaming ?? null) !== (after.dreaming ?? null), after.dreaming == null ? 'set dreaming to the Space default.' : `switched dreaming ${after.dreaming ? 'on' : 'off'}.`)
  note(JSON.stringify(before.dreamModel ?? null) !== JSON.stringify(after.dreamModel ?? null), after.dreamModel == null ? 'set the dream model to the Space default.' : `set the dream model to ${after.dreamModel.model} (${after.dreamModel.provider}).`)
  note(JSON.stringify(before.reviewer ?? null) !== JSON.stringify(after.reviewer ?? null), after.reviewer == null ? 'set the reviewer to the Space default.' : `set the reviewer to ${after.reviewer.model} (${after.reviewer.provider}), thinking ${after.reviewer.effort}.`)
  return notes
}

/**
 * `workspace` is the Workspace of the patch as the Robot checked it on the Host (Robot.updateSettings): kept or refused; absent when the
 * patch does not name one.
 */
export const updateSettings = (patch: SettingsPatch, by?: string, workspace?: CheckedWorkspace) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const before = yield* config
  if (workspace?.kind === 'refused') return yield* invalid(workspace.message)
  const workspaceBefore = store.get<WorkspaceSetting>(WORKSPACE)
  // The chain is the model setting (v1.10): a plain model change edits its active entry.
  const active = Math.min(store.get<number>('chain-active') ?? 0, chainOf(before).length - 1)
  const chain = patch.chain !== undefined ? [...patch.chain] : patch.model !== undefined ? withModel(chainOf(before), active, patch.model) : undefined
  if (chain !== undefined) {
    if (chain.length === 0) return yield* invalid('a Robot needs at least one model in its chain')
    const refusal = yield* promise(() => platform.env.SPACE.getByName(SPACE_ID).chainRefusal(before.ownerId, chain))
    if (refusal !== null) return yield* invalid(refusal)
  }
  // Roots are checked against the Robot's directory on its Hosts, so its name is chosen now if no Host call chose it yet.
  const hostAccess = patch.hostAccess === undefined ? undefined : parseHostAccess(patch.hostAccess, store.hostDirectory())
  if (hostAccess !== undefined && Result.isFailure(hostAccess)) return yield* invalid(hostAccess.failure.message)
  const nextActive = patch.chain !== undefined ? 0 : active
  store.transaction(() => {
    if (chain !== undefined) store.set('chain-active', nextActive)
    if (patch.grants !== undefined) store.setGrants(grantSetFrom(patch.grants))
    // The Robot's Work details (cw-jy38); null follows the default again.
    if (patch.workDetails !== undefined) {
      if (patch.workDetails === null) store.delete(WORK_DETAILS)
      else store.set(WORK_DETAILS, patch.workDetails)
    }
    // A new Workspace starts the Robot at its root (cw-llvx); none removes both.
    if (workspace?.kind === 'kept') {
      if (workspace.setting === null) store.delete(WORKSPACE)
      else store.set(WORKSPACE, workspace.setting)
      store.delete(WORKSPACE_CWD)
    }
    if (hostAccess !== undefined && Result.isSuccess(hostAccess)) {
      store.set(HOST_ACCESS, hostAccess.success)
      // A mode and roots for a facet that is not usable are not kept.
      store.pruneHostAccess()
    }
    // The subagents grant carries the routes its Subagents may run on (ao-2z4n).
    if (patch.subagentModels !== undefined) store.setGrantPayload('tool', 'subagents', { allowedModels: [...new Map(patch.subagentModels.map((entry) => [`${entry.provider}/${entry.model}`, { provider: entry.provider, model: entry.model }])).values()] })
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
      ...(patch.cacheWarming === undefined ? {} : { cacheWarming: patch.cacheWarming }),
      ...(patch.idleCompaction === undefined ? {} : { idleCompaction: patch.idleCompaction }),
      ...(patch.idleCompactionFloorTokens === undefined ? {} : { idleCompactionFloorTokens: Math.max(0, Math.round(patch.idleCompactionFloorTokens)) }),
      ...(patch.autoReview === undefined ? {} : { autoReview: patch.autoReview }),
      ...(patch.requiresHosts === undefined ? {} : { requiresHosts: patch.requiresHosts }),
      ...(patch.reviewer === undefined ? {} : { reviewer: patch.reviewer }),
      ...(patch.dreaming === undefined ? {} : { dreaming: patch.dreaming }),
      ...(patch.dreamModel === undefined ? {} : { dreamModel: patch.dreamModel }),
      ...(current.kind === 'mr-robot' && patch.sharing !== undefined ? { sharing: 'private' as const } : {}),
    }))
  })
  if (by !== undefined) {
    const after = yield* config
    const notes = [
      ...changeNotes(by, before, after),
      ...(patch.subagentModels === undefined ? [] : [`${by} set the Subagent models to ${patch.subagentModels.length === 0 ? 'none' : patch.subagentModels.map((entry) => `${entry.model} (${entry.provider})`).join(', ')}.`]),
      ...(workspace?.kind !== 'kept' || JSON.stringify(workspaceBefore ?? null) === JSON.stringify(workspace.setting) ? [] : [workspace.setting === null ? `${by} removed the Workspace.` : `${by} set the Workspace to ${workspace.setting.root} on ${workspace.setting.host}.`]),
    ]
    for (const text of notes) store.addNotice(after.liveSessionId, storedLength(store.sql, after.liveSessionId), text, Date.now())
  }
  yield* platform.changed()
  // The Space routes Discord messages by channel, so it hears about the mapping (cn-y1ac).
  if (patch.discordChannel !== undefined) {
    const current = yield* config
    yield* promise(() => platform.env.SPACE.getByName(SPACE_ID).discordChannelChanged(current.id, current.discordChannel ?? null))
  }
  if (patch.spendLimit !== undefined) yield* checkLimits
  if (patch.wakeOnScreenNotifications === false) yield* platform.stopWatching()
  return yield* settings
})

// ------------------------------------------------------------------ proposals and the owner's answers (robot-cobv, robot-vy9z)

export function proposalView(row: ProposalRow): ProposalView {
  return {
    id: row.id, kind: row.kind, revision: row.revision, status: row.status, purpose: row.purpose, grants: row.grants, file: row.file, skill: row.skill,
    ...(row.review === undefined ? {} : { review: row.review }), ...(row.thread === undefined ? {} : { thread: row.thread }), ...(row.help === undefined ? {} : { help: row.help }), ...(row.toolCall === undefined ? {} : { toolCall: row.toolCall }),
    ...(row.question === undefined ? {} : { question: row.question }), ...(row.credential === undefined ? {} : { credential: row.credential }),
    ...(row.requiresHosts === true ? { requiresHosts: true } : {}),
  }
}

/** Who answers an Ask. */
export type Answerer = 'owner' | 'mr-robot'

/**
 * The Asks Mr. Robot answers: none since v1.15 (his help_answer is gone; open help Asks are the owner's to answer). Every Ask is the owner's alone; consent to
 * a tool call above all (sk-iis1). A list of what he may answer, not of what he may not: a new kind of Ask is the owner's
 * until someone decides otherwise.
 */
const MR_ROBOT_ASKS: ReadonlySet<ProposalView['kind']> = new Set()

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

/** The definition's Tasks note, once. */
function takeDefinitionNote(store: RobotStore): string {
  const note = store.get<string>(DEFINITION_TASKS_NOTE) ?? ''
  store.delete(DEFINITION_TASKS_NOTE)
  return note
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

/** The kv key of the definition a Robot was installed from (v1.18 ticket 05): its title, README, grants.yaml and tasks.yaml. */
export const DEFINITION = 'definition'
/** The kv key of the note the approval's Wake-up carries about the definition's Tasks. */
const DEFINITION_TASKS_NOTE = 'definition-tasks-note'

export interface InstalledDefinition {
  readonly slug: string
  readonly title: string
  readonly readme: string
  readonly grants: GrantsForm
  readonly tasks: TasksForm
  /**
   * The Workspace the Member chose in the Add form (v1.21, cw-nm6y): known to the Robot in setup without a Host call, checked on the Host
   * and kept as the setting when its setup is approved.
   */
  readonly workspace?: { readonly hostId: string; readonly host: string; readonly root: string }
}

/**
 * After setup is approved, a definition's Tasks are created for the Robot, paused (rm-xgau): a recurring one paused, a scheduled one
 * without its moment (only a recurring Task can be paused); the Robot asks its owner once whether to enable them.
 */
const installDefinitionTasks = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  const definition = store.get<InstalledDefinition>(DEFINITION)
  if (definition === undefined || definition.tasks.tasks.length === 0) return
  const space = platform.env.SPACE.getByName(SPACE_ID)
  const caller = { kind: 'robot' as const, robotId: current.id, ownerId: current.ownerId, actor: { kind: 'robot' as const, robotId: current.id, name: current.identity.name, avatarColor: current.identity.avatarColor, avatarSeed: current.identity.avatarSeed } }
  const made: string[] = []
  for (const task of definition.tasks.tasks) {
    const timing = task.timing.kind === 'recurring' ? { kind: 'recurring' as const, schedule: task.timing.schedule, timeZone: task.timing.timeZone } : { kind: 'unscheduled' as const }
    const instructions = task.timing.kind === 'scheduled' ? `${task.instructions}\n\n(The definition planned it for ${task.timing.at}.)` : task.instructions
    const created = yield* Effect.promise(() => space.createTask(caller, { title: task.title, instructions, assignee: { kind: 'robot', robotId: current.id }, timing }).catch(() => undefined))
    if (created === undefined) continue
    if (task.timing.kind === 'recurring') yield* Effect.promise(() => space.pauseTask(caller, created.id, true).catch(() => undefined))
    made.push(`- ${task.title} (${created.id})${task.timing.kind === 'recurring' ? ', paused' : task.timing.kind === 'scheduled' ? `, no moment yet (planned for ${task.timing.at})` : ''}`)
  }
  if (made.length > 0) store.set(DEFINITION_TASKS_NOTE, [`You were installed from the definition "${definition.title}". Its Tasks are yours now and are not running yet:`, ...made, 'Ask your owner once, in one message, which of them to enable. Then resume each chosen one with task_pause (paused false) or give it its moment with task_update. Do not ask again.'].join('\n'))
})

/** What approval does: the stored payload, exactly. */
const apply = (proposal: ProposalRow) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const ownerId = (yield* config).ownerId
  switch (proposal.kind) {
    case 'setup': {
      // Approved items as proposed, files, web and exa at ask unless proposed, the rest deny (sk-3sij).
      const grants = overlayGrants(store.grants(), setupGrants(proposal.grants ?? emptyGrants))
      store.transaction(() => {
        store.setGrants(grants)
        store.updateConfig(() => ({ status: 'active', ...(proposal.requiresHosts === true ? { requiresHosts: true } : {}) }))
      })
      yield* installDefinitionTasks
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
      const visibility = proposal.payload['visibility'] === 'private' ? 'private' : 'space'
      yield* Effect.tryPromise({
        try: () => platform.env.SPACE.getByName(SPACE_ID).publishSkill(ownerId, proposal.skill!.name, proposal.skill!.description, String(proposal.payload['content'] ?? ''), visibility),
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
      // An edit proposed before v1.18 names the file HOME.md (ticket 09).
      if (file.name === 'SPACE.md' || file.name === 'HOME.md') yield* promise(() => platform.env.SPACE.getByName(SPACE_ID).setSpaceMemory(file.content, 'your owner (approved)', null))
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
 * A Thread Ask was answered (v1.9): an invitation goes to the Space, which opens the Thread when both owners accepted
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
  const told = yield* Effect.tryPromise({ try: () => platform.env.SPACE.getByName(SPACE_ID).threadAnswer(ask.id, current.id, approved, ask.scope), catch: (error) => error instanceof Error ? error.message : String(error) }).pipe(Effect.result)
  if (told._tag === 'Failure') store.addNotice(current.liveSessionId, storedLength(store.sql, current.liveSessionId), `Thread "${ask.topic}": ${String(told.failure)}`, Date.now())
})

export const answer = (proposalId: string, revision: number, approve: boolean, approvedIds?: readonly string[], scope?: string, extra: { readonly note?: string; readonly value?: string; readonly values?: readonly string[]; readonly text?: string; readonly by?: Answerer } = {}) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const pending = store.proposal(proposalId)
  if (pending === undefined) return { ok: false, reason: 'not-found' } as AnswerResult
  if (!mayAnswer(pending.kind, extra.by ?? 'owner')) return { ok: false, reason: 'not-yours' } as AnswerResult
  if (pending.kind === 'tool-call') return yield* answerToolCall(pending, revision, approve, extra.note)
  if (pending.kind === 'question') return yield* answerQuestion(pending, revision, approve, { ...(extra.value === undefined ? {} : { value: extra.value }), ...(extra.values === undefined ? {} : { values: extra.values }), ...(extra.text === undefined ? {} : { text: extra.text }) })
  if (pending.kind === 'credential') {
    if (approve) return yield* invalid('save the form to answer a credential request; to refuse it, decline')
    return yield* answerCredential(pending, revision, { declined: true })
  }
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
      : approved ? [approvedNote(answered), takeDefinitionNote(store)].filter((part) => part !== '').join('\n\n') : `Your owner rejected your ${answered.kind} proposal (${answered.purpose}). Do not ask for it again unless they bring it up.`,
    // The chat shows what happened, not the instruction to the model.
    payload: {
      byOwner: true,
      summary: decision !== undefined ? `Review: ${decision.approved.length} approved, ${decision.rejected.length} rejected` : approved ? (answered.kind === 'setup' ? 'Setup approved' : 'Approved') : 'Rejected',
      ...(decision === undefined ? {} : { approved: decision.approved, rejected: decision.rejected }),
    },
  })
  return { ok: true, proposal: proposalView(answered) } as AnswerResult
})

/** A grant item as the owner reads it in a notice. */
function itemLabel(item: GrantItemRef): string {
  switch (item.kind) {
    case 'tool': return `the tool group ${item.name}`
    case 'skill': return `the skill ${item.name}`
    case 'recipient': return `messages to ${item.name}`
    case 'secret': return `the login ${item.name}`
    case 'host': return `the Host grant ${item.name}`
    case 'connection': return item.name.endsWith(':write') ? `writing with the Connection ${item.name.slice(0, -':write'.length)}` : `the Connection ${item.name}`
  }
}

/**
 * "Always allow this" (v1.17, dp-u9z9, dp-2xp4; "This Robot sends on its own" on a draft, dp-ef0p): the items at ask the call waited on are set to
 * allow for this Robot, the Conversation records the change with the Ask it came from, and the stored call is approved. A review denial and a call
 * without the sandbox offer no such answer (dp-kcds). The grant settings lower the items again like any other grant (dp-fjh7).
 */
export const alwaysAllow = (proposalId: string, revision: number, by: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const pending = store.proposal(proposalId)
  if (pending === undefined || pending.kind !== 'tool-call' || pending.toolCall === undefined) return { ok: false, reason: 'not-found' } as AnswerResult
  if (pending.status !== 'open' || pending.revision !== revision) return { ok: false, reason: 'stale' } as AnswerResult
  const items = pending.toolCall.alwaysAllow
  if (items === null) return yield* invalid('this call is decided one at a time: approve or reject it')
  const raised: GrantSet = { ...emptyGrants }
  const levels = items.reduce<GrantSet>((set, item) => ({ ...set, [GRANT_FIELDS[item.kind]]: { ...set[GRANT_FIELDS[item.kind]], [item.name]: 'allow' } }), raised)
  const current = yield* config
  store.transaction(() => {
    store.setGrants(overlayGrants(store.grants(), levels))
    store.addNotice(current.liveSessionId, storedLength(store.sql, current.liveSessionId), `${by} set ${items.map(itemLabel).join(' and ')} to allow for ${current.identity.name}, raised from Ask ${pending.id}.`, Date.now())
  })
  // The composition is rebuilt with the new levels at the next Turn, the one the approval starts.
  store.updateConfig(() => ({}))
  return yield* answerToolCall(pending, revision, true, undefined)
})

/**
 * A new version of an open draft (v1.17): the owner's edit in the card (dp-qbt7) or the Robot's draft_revise (dp-5ixt). The stored call's
 * body and subject change, the version joins the history, and the revision moves on, so Send sends exactly the version on the card.
 */
export const reviseDraft = (proposalId: string, revision: number, body: string, subject: string | undefined, by: 'owner' | 'robot') => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const pending = store.proposal(proposalId)
  if (pending === undefined || pending.kind !== 'tool-call') return { ok: false, reason: 'not-found' } as AnswerResult
  if (pending.toolCall?.draft == null) return yield* invalid('this Ask is not a draft')
  const revised = store.reviseDraft(proposalId, revision, body, subject, by, Date.now())
  if (revised === undefined) return { ok: false, reason: 'stale' } as AnswerResult
  yield* platform.changed()
  return { ok: true, proposal: proposalView(revised) } as AnswerResult
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
      ? [answered.toolCall?.draft?.revisions.at(-1)?.by === 'owner' ? 'Your owner edited the message before it went; what went is the stored call as they left it.' : '', text === '' ? '' : `Your owner's note: ${text}`].filter((line) => line !== '').join('\n')
      : `The call did not run.${text === '' ? ' Your owner gave no reason.' : ''} Do not repeat it unless your owner asks; tell them in one line what you do instead.`,
    payload: { byOwner: true, summary: `${approve ? 'Approved' : 'Rejected'}: ${tool}`, toolCallAnswer: wakeup },
  })
  return { ok: true, proposal: proposalView(answered) } as AnswerResult
})

/** What the owner chose for a question: an option by value, several values (multi-select), their own words. */
export interface QuestionChoice {
  readonly value?: string
  readonly values?: readonly string[]
  readonly text?: string
}

type QuestionAnswerValue = NonNullable<NonNullable<ProposalView['question']>['answer']>

/**
 * The answer a choice gives a question, or the reason it is refused (pure). A single-select question takes one option or the owner's words; a
 * multi-select question takes every chosen option (at least one) with the owner's words alongside when allowed, or the words alone (dp-xz6h).
 */
export function questionAnswerOf(question: NonNullable<ProposalView['question']>, choice: QuestionChoice): { readonly answer: QuestionAnswerValue } | { readonly refused: string } {
  const custom = choice.text?.trim() ?? ''
  const unknown = [...(choice.value === undefined ? [] : [choice.value]), ...(choice.values ?? [])].find((value) => !question.options.some((option) => option.value === value))
  if (unknown !== undefined) return { refused: `"${unknown}" is not one of the options of this question` }
  if (custom !== '' && !question.allowCustom) return { refused: 'this question takes one of its options, not your own words' }
  if (question.multiSelect) {
    const chosen = new Set([...(choice.values ?? []), ...(choice.value === undefined ? [] : [choice.value])])
    const selected = question.options.filter((option) => chosen.has(option.value)).map((option) => ({ value: option.value, label: option.label }))
    if (selected.length === 0 && custom === '') return { refused: question.allowCustom ? 'choose at least one option or write your answer' : 'choose at least one option' }
    return { answer: selected.length === 0 ? { kind: 'custom', text: custom } : { kind: 'selected', selected, text: custom === '' ? null : custom } }
  }
  if (choice.values !== undefined && choice.values.length > 1) return { refused: 'this question takes one answer' }
  const value = choice.value ?? choice.values?.[0]
  const option = value === undefined ? undefined : question.options.find((entry) => entry.value === value)
  if (option !== undefined) return { answer: { kind: 'option', value: option.value, label: option.label } }
  if (custom !== '') return { answer: { kind: 'custom', text: custom } }
  return { refused: question.allowCustom ? 'answer with an option or write your answer' : 'answer with one of the options' }
}

/** What the Robot reads of an answer: the label names the choice, the text carries the values and the owner's words. */
function questionWake(askId: string, answer: QuestionAnswerValue): { readonly label: AskAnswerLabel; readonly text: string } {
  switch (answer.kind) {
    case 'option': return { label: { askId, kind: 'option', label: answer.label, value: answer.value }, text: answer.value }
    case 'selected': return {
      label: { askId, kind: 'selected', labels: answer.selected.map((option) => option.label), values: answer.selected.map((option) => option.value), withText: answer.text !== null },
      text: [answer.selected.map((option) => option.value).join(', '), ...(answer.text === null ? [] : [answer.text])].join('\n'),
    }
    case 'custom': return { label: { askId, kind: 'custom' }, text: answer.text }
    case 'dismissed': return { label: { askId, kind: 'dismissed' }, text: 'Your owner chose not to answer. Do not ask it again; decide yourself, or leave it.' }
  }
}

/**
 * The owner's answer to a question Ask (v1.15, gb-1lfb, gb-ewfe; v1.17 dp-xz6h, dp-f8z1): an option (by value), several options for a multi-select
 * question, their own words when the question allows them, or a dismissal. One answer per Ask, compare-and-swap on the revision. It wakes the Robot
 * as a steer carrying the Ask id and every chosen value.
 */
const answerQuestion = (pending: ProposalRow, revision: number, approve: boolean, choice: QuestionChoice) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const store = yield* RobotState
  const question = pending.question
  if (question === undefined) return { ok: false, reason: 'not-found' } as AnswerResult
  const decided = approve ? questionAnswerOf(question, choice) : { answer: { kind: 'dismissed', reason: 'owner' } as QuestionAnswerValue }
  if ('refused' in decided) return yield* invalid(decided.refused)
  const answered = store.answerQuestion(pending.id, revision, decided.answer, Date.now())
  if (answered === undefined) return { ok: false, reason: 'stale' } as AnswerResult
  yield* platform.changed()
  const told = questionWake(answered.id, decided.answer)
  yield* wake({
    kind: 'platform',
    sender: { kind: 'platform' },
    text: told.text,
    payload: { byOwner: true, summary: decided.answer.kind === 'dismissed' ? 'Dismissed a question' : 'Answered a question', askAnswer: told.label },
  })
  return { ok: true, proposal: proposalView(answered) } as AnswerResult
})

/**
 * The owner declined a credential request, or saved it (saveCredential below calls this with the entry). One answer per Ask. It wakes the
 * Robot as a steer: with the entry's name, or with the refusal (gb-923q, gb-7dl9).
 */
export const answerCredential = (pending: ProposalRow, revision: number, result: { readonly entry: string } | { readonly declined: true }) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const store = yield* RobotState
  const answered = store.answerCredential(pending.id, revision, result, Date.now())
  if (answered === undefined) return { ok: false, reason: 'stale' } as AnswerResult
  yield* platform.changed()
  const service = pending.credential?.service ?? 'the service'
  yield* wake({
    kind: 'platform',
    sender: { kind: 'platform' },
    text: 'entry' in result
      ? `${answered.credential?.credential === 'login' ? 'Use it with login_fill on its login page.' : 'Read it with secret_get.'} It is granted to you; you have not seen the password${answered.credential?.credential === 'login' ? ' and never will' : ''}.${store.mayUse('tool', 'secrets') ? '' : ' You do not have the logins tools yet: ask for the secrets tool group with propose_grants.'}`
      : `Your owner does not want to give you access to ${service}. Do not ask again unless they bring it up; tell them in one line what you do instead.`,
    payload: { byOwner: true, summary: 'entry' in result ? `Saved ${result.entry} for ${service}` : `Declined access to ${service}`, askAnswer: 'entry' in result ? { askId: answered.id, kind: 'credential-saved', entry: result.entry } : { askId: answered.id, kind: 'credential-declined' } },
  })
  return { ok: true, proposal: proposalView(answered) } as AnswerResult
})

/** Who answers a help Ask: the owner (by name) or Mr. Robot (by his configured name). */
export type HelpAnswerer = { readonly by: 'owner' | 'mr-robot'; readonly name: string }

export type HelpAnswerResult =
  | { readonly ok: true; readonly proposal: ProposalView }
  | { readonly ok: false; readonly reason: 'not-found' | 'empty' }
  /** The Ask is of another kind: the help route answers the help requests left open from before v1.15 only (sk-iis1). */
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
      ...(answerer.by === 'owner' ? { byOwner: true } : {}),
    },
  })
  return { ok: true, proposal: proposalView(answered) } as HelpAnswerResult
})

// ------------------------------------------------------------------ secrets (robot-0bde)

/** secret.get: a granted name only, resolved from the owner or the Space. */
export const secret = (name: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  if (!store.mayUse('secret', name)) return yield* invalid(`The secret "${name}" is not granted to you. Granted: ${usableNames(store.effectiveGrants().secrets).join(', ') || 'none'}. Ask with propose_grants.`)
  const ownerId = (yield* config).ownerId
  const entry = yield* promise(() => platform.env.SPACE.getByName(SPACE_ID).resolveLogin(ownerId, name))
  if (entry === null) return yield* notFound(`The secret "${name}" no longer exists`)
  // A website login is filled into the page, not read (rb-e1ic); only entries marked "allow reading" give their value.
  if (!entry.allowRead) return yield* invalid(`"${name}" is a website login: use login_fill on its login page instead of reading it.`)
  yield* platform.rememberSecret(name, entry.password)
  return entry.password
})

// ------------------------------------------------------------------ rewind (robot-0q6a, robot-acr3; v1.19 ec-i74p, ec-utsf)

/** The kv key of the label the next Wake-up carries after a Rewind (ec-utsf). */
export const REWIND_LABEL = 'rewind-label'
/** At most this many tool names in the label. */
const LABEL_TOOLS = 12

/**
 * Rewind (v1.19, ec-i74p): open a new chapter seeded with what the model saw at `atSeq` of a chapter of the Conversation, the live one
 * or an older one. The seed is real history only, no note (ec-utsf); every chapter after the point leaves the Conversation, superseded and
 * readable. That external effects since the point still stand rides as the label of the next Wake-up. There is no undo: the superseded
 * chapters are what is kept.
 */
export const rewind = (atSeq: number, ordinal?: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  if (yield* platform.working()) return yield* conflict('the Robot is working; rewind when it is done')
  const target = ordinal === undefined ? store.chapters.get(current.liveSessionId) : store.chapters.byOrdinal(ordinal)
  if (target === undefined) return yield* notFound(`no chapter ${ordinal ?? ''} in this Conversation`)
  if (target.state.kind === 'closed' && target.state.superseded) return yield* conflict('that chapter was superseded by a Rewind; it can be read, not rewound to')
  const events = yield* logOf(target.sessionId)
  if (!Number.isInteger(atSeq) || atSeq < target.firstSeq || atSeq >= events.length) return yield* invalid(`no event ${atSeq} of its own in this chapter`)
  const header = storedHeader(store.sql, target.sessionId)
  if (header === undefined) return yield* notFound('that chapter has no log')
  const seed = chapterSeed(events.slice(0, atSeq + 1))
  const now = Date.now()
  const sessionId = `s-${crypto.randomUUID()}`
  const nextHeader = { ...header, id: SessionId(sessionId), createdAt: now, isSeeded: true, parentSession: SessionId(target.sessionId) }
  const refused = Result.try(() => Session.create(SessionId(sessionId), seed.events, nextHeader, SessionLogOffset(seed.inheritedEventCount)))
  if (Result.isFailure(refused)) return yield* conflict(`that point cannot start a chapter: ${String(refused.failure)}`)
  const later = store.chapters.chain().filter((chapter) => chapter.ordinal > target.ordinal)
  const label = rewindLabel(timeLabel(events[atSeq]!.time, current.timeZone), yield* toolsSince(store, events, atSeq, target, later))
  const record = { id: `rw-${crypto.randomUUID().slice(0, 8)}`, atSeq, archivedSessionId: target.sessionId, liveSessionId: sessionId, at: now }
  const liveEvents = current.liveSessionId === target.sessionId ? events : readStoredEvents(store.sql, current.liveSessionId)
  yield* platform.releaseAgent()
  store.transaction(() => {
    storeSession(store.sql, nextHeader, seed.inheritedEventCount, seed.events)
    store.search.track(sessionId, seed.inheritedEventCount)
    store.addRewind(record)
    store.chapters.close(current.liveSessionId, 'rewind', now, liveEvents)
    store.chapters.branch(target.sessionId, atSeq, now)
    store.openChapter(sessionId, { sessionId: target.sessionId, seq: atSeq }, seed.inheritedEventCount, now, seed.events.length)
    store.set(REWIND_LABEL, label)
    store.delete('chapter-compacted')
    store.updateConfig(() => ({ liveSessionId: sessionId }))
  })
  store.addNotice(sessionId, storedLength(store.sql, sessionId), `Rewound to ${timeLabel(events[atSeq]!.time, current.timeZone).slice(1, -1)}. What came after is kept, greyed, in the Trajectory.`, now)
  yield* platform.changed()
  return { ...record, undone: false } as RewindView
})

/**
 * The tools used after the point (v1.20.1, v1.19-review #1, #6): in the chapter after it, in every chapter the Rewind supersedes, and in the
 * Subagents that ran in them. Each log is read where it is, SQLite or a cold chapter's object in R2, so a cold chapter is not silent; a
 * program's inner calls count by their own names, and run_code itself is not an effect.
 */
const toolsSince = (store: RobotStore, targetEvents: readonly SessionEvent[], atSeq: number, target: Chapter, later: readonly Chapter[]) => Effect.gen(function* () {
  const names = (events: readonly SessionEvent[], from: number) => events.flatMap((event) => {
    if (event.seq <= from || (event.type !== 'tool/call' && event.type !== 'tool/ptc-dispatch')) return []
    const name = (event.data as { name?: unknown }).name
    return typeof name === 'string' && name !== 'run_code' ? [name] : []
  })
  const subagents = new SubagentStore(store.sql)
  const found: string[] = [...names(targetEvents, atSeq)]
  // A Subagent of the target chapter started after the point counts; so does every Subagent of a later chapter.
  for (const child of subagents.of(target.sessionId)) if (child.parentSeq > atSeq) found.push(...names(yield* logOf(child.id), -1))
  for (const chapter of later) {
    found.push(...names(yield* logOf(chapter.sessionId), -1))
    for (const child of subagents.of(chapter.sessionId)) found.push(...names(yield* logOf(child.id), -1))
  }
  return [...new Set(found)]
})

/** The next Wake-up's label after a Rewind (ec-utsf). */
function rewindLabel(when: string, tools: readonly string[]): string {
  const used = tools.length === 0 ? 'no tool was used since then' : `you used ${tools.slice(0, LABEL_TOOLS).join(', ')}${tools.length > LABEL_TOOLS ? ` and ${tools.length - LABEL_TOOLS} more` : ''}; check the real state before you repeat or contradict anything`
  return `[Rewound to ${when.slice(1, -1)}: external effects since then stand: ${used}]`
}

/**
 * Rewind to before Turn n of a chapter (the live one by default): before the inbox events that delivered its message too, so the
 * message is gone with the Turn (it is not delivered again).
 */
export const rewindBeforeTurn = (turn: number, ordinal?: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const live = (yield* config).liveSessionId
  const chapter = ordinal === undefined ? store.chapters.get(live) : store.chapters.byOrdinal(ordinal)
  if (chapter === undefined) return yield* notFound(`no chapter ${ordinal ?? ''} in this Conversation`)
  const events = yield* logOf(chapter.sessionId)
  // The chapter's own Turns: its seed carries a closed Turn of the chapter before.
  const first = chapter.firstSeq
  const start = events.findIndex((event) => event.seq >= first && event.type === 'turn/start' && (event.data as { turn?: number }).turn === turn)
  if (start < 0) return yield* notFound(`no Turn ${turn} in this chapter`)
  let at = start
  while (at > first && events[at - 1]!.type === 'agent/inbox/spliced') at -= 1
  return yield* rewind(Math.max(first, events[at]!.seq - 1), chapter.ordinal)
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
  /** Installed from a definition (v1.18 ticket 05): its files go into the Workspace; setup asks only what belongs to the owner. */
  readonly definition?: InstalledDefinition & { readonly files: ReadonlyArray<{ readonly path: string; readonly body: Uint8Array }> }
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
    // Mr. Robot, talked to all day, keeps his cache warm; other Robots compact while idle (ao-jlr0, ao-f4sp).
    // Mr. Robot, talked to all day, keeps his cache warm and closes the chapter after the third warming (v1.20, dm-zyxz).
    cacheWarming: init.kind === 'mr-robot', idleCompaction: true, idleCompactionFloorTokens: DEFAULT_IDLE_FLOOR_TOKENS,
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'space' }, timeZone: init.timeZone,
    liveSessionId: `s-${crypto.randomUUID()}`, revision: 1, createdAt: Date.now(),
  }
  store.transaction(() => {
    store.saveConfig(config)
    // Its Conversation's first chapter (v1.19).
    store.openChapter(config.liveSessionId, null, 0, config.createdAt)
    // A Robot made since v1.15 always had say: no Conversation of it shows assistant text as replies (gb-psyl).
    store.set('voice-upgraded', true)
    // And it can ask its chief from the start (gb-qmnc).
    if (init.kind === 'robot') store.setGrants(chiefGrants(init.ownerId))
    store.set('owner', { id: init.ownerId, name: init.ownerName, ...(init.ownerNickname === undefined ? {} : { nickname: init.ownerNickname }) })
    if (init.brief !== undefined) store.set('brief', init.brief)
    if (init.definition !== undefined) {
      const { files: _files, ...definition } = init.definition
      store.set(DEFINITION, definition)
    }
  })
  yield* platform.seedWorkspace(init.definition?.files ?? [])
  yield* platform.changed()
  if (init.status === 'setup') {
    yield* wake({ kind: 'platform', sender: { kind: 'platform' }, text: 'Setup started. Greet your owner and begin the interview.', payload: { summary: 'Setup started' } })
  }
  return config
})

/** The kv key of the one moment the Robot keeps of its Tasks: when its earliest due Task wakes it (mc-s1aa). */
export const NEXT_DUE = 'next-due'
/** The kv key of the moment an owner Turn that has said nothing gets its one steer (v1.15, gb-0skq). */
export { QUIET_DUE } from '../plugins/say.ts'
/** The kv key of the idle plan (idle.ts): the moments left for warming or idle compaction. */
export { IDLE_PLAN }

/** The Space planned this Robot's earliest due Task. */
export const setNextDue = (at: number | null) => Effect.gen(function* () {
  const store = yield* RobotState
  if (store.config() === undefined) return
  if (at === null) store.delete(NEXT_DUE)
  else store.set(NEXT_DUE, at)
  yield* (yield* RobotPlatform).rearm()
})

/**
 * The moment came: the Space hands out the due Tasks and moves them on; each becomes one Task Wake-up. A Task
 * whose earlier Wake-up is still queued or running is skipped, so a Task cannot flood its Robot (cd-d14a).
 */
export const fireTasks = (now: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const due = store.get<number>(NEXT_DUE)
  if (due === undefined || due > now) return
  const current = yield* config
  const space = platform.env.SPACE.getByName(SPACE_ID)
  const answer = yield* promise(() => space.dueTasks(current.id))
  for (const task of answer.tasks) {
    if (store.taskQueued(task.id)) yield* promise(() => space.taskSkipped(task.id, current.id, 'The previous run had not finished.'))
    else yield* startOrHold(task, now)
  }
  if (answer.nextDue === null) store.delete(NEXT_DUE)
  else store.set(NEXT_DUE, answer.nextDue)
})

// ------------------------------------------------------------------ a Robot that waits for its Hosts (v1.16 ticket 05)

/** The kv key of the scheduled Tasks held back until a Host of the Robot comes back (ob-e271). */
export const PARKED_TASKS = 'parked-tasks'
/** The kv key of the Hosts whose outage the owner was told of already (ob-qgpy). */
const HOST_OUTAGES = 'host-outages'
/** While a Task is parked the alarm looks again at least this often, in case the Host's online event was lost. */
export const PARK_RECHECK_MS = 5 * 60_000

interface ParkedTask {
  readonly id: string
  readonly title: string
  readonly instructions: string
  readonly deadline: number | null
  /** When the Space handed the occurrence out: the Space drops it once a Turn on the Task started after this (parkedOccurrence). */
  readonly takenAt: number
}

/** Hold a due occurrence back; one parked occurrence per Task, the newest. Read and written in one synchronous step. */
const park = (store: RobotStore, task: ParkedTask): void => {
  const parked = store.get<readonly ParkedTask[]>(PARKED_TASKS) ?? []
  store.set(PARKED_TASKS, [...parked.filter((other) => other.id !== task.id), { id: task.id, title: task.title, instructions: task.instructions, deadline: task.deadline, takenAt: task.takenAt }])
}

/**
 * Take a parked occurrence off the list, in one synchronous step after the awaits that decided it: false when it is gone already
 * (another release, the alarm or a Host's online event, took it meanwhile), so only one of them acts on it. Occurrences parked
 * meanwhile stay.
 */
const unpark = (store: RobotStore, task: ParkedTask): boolean => {
  const parked = store.get<readonly ParkedTask[]>(PARKED_TASKS) ?? []
  const left = parked.filter((other) => other.id !== task.id || other.takenAt !== task.takenAt)
  if (left.length === parked.length) return false
  if (left.length === 0) store.delete(PARKED_TASKS)
  else store.set(PARKED_TASKS, left)
  return true
}

/** The Hosts the Robot's owner reaches and whether each is online; null when the Space cannot say. */
const knownHosts = (ownerId: string) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const hosts = yield* promise(() => platform.env.SPACE.getByName(SPACE_ID).hostsFor(ownerId).catch(() => null))
  // Named as the Robot calls them, so a failed Task names the Host it waited for (deep review P14b).
  return hosts === null ? null : withDistinctNames(hosts).map((host): KnownHost => ({ id: host.id, name: host.name, online: host.online }))
})

/**
 * The Hosts that count for the Robot (taskHostFacets), as they are now; a Host that returned leaves the list of reported outages.
 * Null when the setting is off, or when the Space cannot say: then nothing is held back, so a missing answer never stops the Robot.
 */
const hostsNow = Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  if (current.requiresHosts !== true) return null
  const known = yield* knownHosts(current.ownerId)
  if (known === null) return null
  const reported = store.get<readonly string[]>(HOST_OUTAGES) ?? []
  const left = afterReturn(reported, known)
  if (left.length !== reported.length) store.set(HOST_OUTAGES, left)
  return heldHosts(taskHostFacets(current.kind, store.grants().hosts), known)
})

/** What a due Task does now (hosts-gate.ts). */
const gateOf = (task: ParkedTask & { readonly recurring: boolean }, now: number) => Effect.map(hostsNow, (held): TaskGate => (held === null ? { kind: 'run' } : gateTask({ requiresHosts: true, task, held, now })))

/** The Attempt ends as failed with the Host named, no Turn runs; the owner hears once per Host outage (ob-qgpy). */
const failWithoutTurn = (task: ParkedTask, gate: Extract<TaskGate, { kind: 'fail' }>) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  const space = platform.env.SPACE.getByName(SPACE_ID)
  const started = yield* promise(() => space.attemptStarted(task.id, current.id))
  if (started !== null) yield* promise(() => space.attemptFinished(started.attemptId, 'failed', gate.line))
  const { fresh, reported } = outageNotice(gate.offline, store.get<readonly string[]>(HOST_OUTAGES) ?? [])
  if (fresh.length === 0) return
  store.set(HOST_OUTAGES, reported)
  yield* platform.notifyMembers('needs you', `did not run the Task "${task.title}": ${gate.line} Start the Mr. Robot app on that computer.`)
})

/** A due Task becomes a Wake-up that starts its Turn. */
const enqueueScheduled = (store: RobotStore, task: ParkedTask, now: number): void => {
  store.enqueue('task', { kind: 'task', taskId: task.id, name: task.title }, task.instructions, { taskId: task.id, by: 'schedule' }, now)
}

/** One due Task: it starts a Turn, ends failed, or waits for its Host. */
const startOrHold = (task: ParkedTask & { readonly recurring: boolean }, now: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const gate = yield* gateOf(task, now)
  switch (gate.kind) {
    case 'run':
      enqueueScheduled(store, task, now)
      return
    case 'fail':
      return yield* failWithoutTurn(task, gate)
    case 'park':
      return park(store, task)
  }
})

/**
 * A Host came back, or the alarm looks again: each parked Task runs when every Host of the Robot is online and its deadline
 * has not passed, fails when the deadline passed, and otherwise waits on (ob-e271). Also clears the outages of Hosts that returned.
 */
export const releaseParked = (now: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const parked = store.get<readonly ParkedTask[]>(PARKED_TASKS) ?? []
  // With nothing parked the outage list still follows the Hosts, so the next outage is told again.
  if (parked.length === 0) {
    if ((store.get<readonly string[]>(HOST_OUTAGES) ?? []).length > 0) yield* hostsNow
    return
  }
  const current = yield* config
  const space = (yield* RobotPlatform).env.SPACE.getByName(SPACE_ID)
  for (const entry of parked) {
    // A cancelled, finished, reassigned, rescheduled or already run Task gets no Turn; an edited text is taken as it is now.
    const task = yield* promise(() => space.parkedOccurrence(entry.id, current.id, entry.takenAt))
    if (task === null) {
      unpark(store, entry)
      continue
    }
    const gate = yield* gateOf(task, now)
    if (gate.kind === 'park' || !unpark(store, entry)) continue
    // Released after its deadline it fails, as the deadline alarm would have failed it.
    if (gate.kind === 'run' && task.deadline !== null && now >= task.deadline) yield* failWithoutTurn(task, { kind: 'fail', line: 'The deadline passed before the Task could run.', offline: [] })
    else if (gate.kind === 'fail') yield* failWithoutTurn(task, gate)
    else if (!store.taskQueued(task.id)) enqueueScheduled(store, task, now)
  }
})

/** The next alarm: the core's (a heartbeat while work runs, the earliest Task, a parked Task's check or deadline) and the duties' earliest. */
export const rearm = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const config = store.config()
  if (config === undefined || config.status === 'deleted') return yield* platform.setAlarm(null)
  const runnable = config.status === 'active' || config.status === 'setup'
  const taskDue = store.get<number>(NEXT_DUE)
  // A scheduled Task waits for its Host until its deadline; the alarm also looks again now and then (v1.16 ticket 05).
  const parkedTasks = store.get<readonly ParkedTask[]>(PARKED_TASKS) ?? []
  const parkedDeadline = parkedTasks.flatMap((task) => (task.deadline === null ? [] : [task.deadline]))
  const duty = yield* platform.dutiesNext()
  const candidates = [
    ...(taskDue === undefined ? [] : [taskDue]),
    ...(parkedTasks.length === 0 ? [] : [Date.now() + PARK_RECHECK_MS]),
    ...parkedDeadline,
    // Running Subagents keep the heartbeat too: after a restart the alarm resumes them (ao-ij3i).
    ...(store.activeTurn() !== undefined || (store.pendingWakeups() > 0 && runnable) || new SubagentStore(store.sql).running().length > 0 ? [Date.now() + HEARTBEAT_MS] : []),
    ...(duty === undefined ? [] : [duty]),
  ]
  yield* platform.setAlarm(candidates.length === 0 ? null : Math.min(...candidates))
})