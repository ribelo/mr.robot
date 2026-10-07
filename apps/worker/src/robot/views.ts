/**
 * What the Robot shows (ticket 23, robot-naul): its chat, trajectory, panel, fleet row and
 * registry entry, as Effect programs over the Robot's state. Secrets are masked through the
 * platform; nothing here writes except the registry report.
 */
import * as Effect from 'effect/Effect'
import type { ChatItem, Conversation, FleetState, GrantSet, ModelChoice, RobotPanel, RobotSummary, RoutineView, ScreenView, Trajectory, TrajectoryEvent, UsageView } from '@mr-robot/protocol'
import { readStoredEvents } from '../agent/session-log.ts'
import { HOME_ID } from '../env.ts'
import { currentMonth, type RegistryEntry } from '../home/home.ts'
import { notFound } from '../platform/durable.ts'
import { proposalView, RobotPlatform, RobotState, routineView, settings } from './programs.ts'
import { projectChat } from './projection.ts'
import type { RobotConfig } from './store.ts'

const config = Effect.gen(function* () {
  const store = yield* RobotState
  const value = store.config()
  if (value === undefined) return yield* notFound('robot is not initialised')
  return value
})

/** The state shown in lists (robot-x26m, robot-n7th). */
export const fleetState = Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  if (current.status === 'paused') return 'paused' as FleetState
  if (current.status === 'blocked') return 'blocked' as FleetState
  if (store.activeTurn() !== undefined) return 'working' as FleetState
  // A failed Turn waiting for "Try again" is a state, not a raw error in the list.
  if (store.get('failed-wakeup') !== undefined) return 'blocked' as FleetState
  if (store.proposals('open').length > 0 || store.get('takeover') !== undefined) return 'waiting for you' as FleetState
  if (current.status === 'setup') return 'setup' as FleetState
  return 'sleeping' as FleetState
})

/** The tool running now: the latest call without a result (a code program's latest inner call wins). */
function runningTool(events: ReadonlyArray<{ type: string; data: unknown }>): string | undefined {
  const open = new Map<string, string>()
  let inner: string | undefined
  for (const event of events) {
    const data = event.data as Record<string, unknown>
    if (event.type === 'tool/call') open.set(String(data['callId']), String(data['name']))
    else if (event.type === 'tool/ptc-dispatch') inner = String(data['name'])
    else if (event.type === 'tool/result') {
      const message = data['message'] as { toolCallId?: string } | undefined
      open.delete(String(message?.toolCallId))
      inner = undefined
    }
  }
  const last = [...open.values()].at(-1)
  return last === undefined ? undefined : last === 'run_code' ? (inner ?? 'code') : last
}

/** The chat (robot-q4b2): the session log projected, with open proposals always shown as questions. */
export const conversation = (details = false) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const events = readStoredEvents(store.sql, current.liveSessionId)
  const items = projectChat({
    details,
    events,
    notices: store.notices(current.liveSessionId),
    proposal: (id) => {
      const row = store.proposal(id)
      return row === undefined ? undefined : proposalView(row)
    },
  })
  // A proposal made inside a code-mode program has no direct tool result to project from (robot-vy9z);
  // answered ones stay too, as the stream's record of the ask (rb-r0oj).
  const shown = new Set(items.flatMap((item) => (item.kind === 'question' ? [item.proposal.id] : [])))
  for (const row of store.proposals().filter((proposal) => proposal.createdAt >= current.createdAt && proposal.status !== 'superseded')) {
    if (shown.has(row.id)) continue
    const position = items.findLastIndex((item) => item.at <= row.createdAt) + 1
    items.splice(position, 0, { kind: 'question', id: `proposal-${row.id}`, seq: items[position - 1]?.seq ?? 0, at: row.createdAt, proposal: proposalView(row) })
  }
  const working = store.activeTurn() !== undefined
  const activity = working ? runningTool(events) : undefined
  return {
    canRetry: store.get('failed-wakeup') !== undefined,
    robotId: current.id,
    working,
    items,
    ...(activity === undefined ? {} : { activity }),
  } as Conversation
})

function maskItem(item: ChatItem, mask: (text: string) => string): ChatItem {
  switch (item.kind) {
    case 'message': return { ...item, text: mask(item.text) }
    case 'reply': return { ...item, text: mask(item.text) }
    case 'notice': return { ...item, text: mask(item.text) }
    case 'thinking': return { ...item, text: mask(item.text) }
    case 'activity': return item.calls === undefined ? item : { ...item, calls: item.calls.map((call) => ({ ...call, args: mask(call.args), result: mask(call.result), inner: call.inner.map((inner) => ({ ...inner, args: mask(inner.args) })) })) }
    default: return item
  }
}

/** The chat as a viewer gets it, secrets masked (robot-4zi6). */
export const conversationView = (details = false) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const mask = yield* platform.masker()
  const view = yield* conversation(details)
  return { ...view, items: view.items.map((item) => maskItem(item, mask)) } as Conversation
})

const trajectoryEvents = (sessionId: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const mask = yield* (yield* RobotPlatform).masker()
  return readStoredEvents(store.sql, sessionId).map((event): TrajectoryEvent => ({
    seq: event.seq,
    type: event.type,
    time: event.time,
    turn: typeof (event.data as { turn?: unknown }).turn === 'number' ? (event.data as { turn: number }).turn : null,
    data: mask(JSON.stringify(event.data)),
  }))
})

/** The full session log of the live Conversation (robot-h5v3), secrets masked. */
export const trajectory = Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  return { robotId: current.id, sessionId: current.liveSessionId, events: yield* trajectoryEvents(current.liveSessionId), rewinds: store.rewinds() } as Trajectory
})

/** An archived log, read-only (the rewind archive). */
export const archivedTrajectory = (sessionId: string) => Effect.gen(function* () {
  const store = yield* RobotState
  if (!store.rewinds().some((rewind) => rewind.archivedSessionId === sessionId || rewind.liveSessionId === sessionId)) return [] as TrajectoryEvent[]
  return yield* trajectoryEvents(sessionId)
})

/**
 * The live session's DSH events exactly as stored (every field, including surfaceOp), secrets
 * masked, for the DSH trajectory view. Pages backwards with before, forwards with after.
 */
export const sessionEvents = (input: { before?: number; after?: number; limit?: number }) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const mask = yield* (yield* RobotPlatform).masker()
  const limit = Math.min(Math.max(input.limit ?? 400, 1), 2000)
  const rows = input.after !== undefined
    ? store.sql.exec<{ seq: number; event: string }>('SELECT seq, event FROM session_event WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?', current.liveSessionId, input.after, limit).toArray()
    : store.sql.exec<{ seq: number; event: string }>('SELECT seq, event FROM session_event WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?', current.liveSessionId, input.before ?? Number.MAX_SAFE_INTEGER, limit).toArray().reverse()
  const first = rows[0]?.seq
  // Events cross the RPC boundary as one JSON text (deep JSON types do not survive RPC typing).
  return { events: `[${rows.map((row) => mask(row.event)).join(',')}]`, hasMore: first !== undefined && first > 0 && input.after === undefined, sessionId: current.liveSessionId }
})

export const routineViews = Effect.gen(function* () {
  const store = yield* RobotState
  const id = (yield* config).id
  return store.routines().map((routine): RoutineView => routineView(id, routine, store.routineRuns(routine.id)))
})

const screen = Effect.gen(function* () {
  const store = yield* RobotState
  const saved = store.get<{ path: string; at: number }>('screen')
  if (saved === undefined) return null as ScreenView | null
  const id = (yield* config).id
  return { path: saved.path, at: saved.at, url: `/api/robots/${encodeURIComponent(id)}/screen?at=${saved.at}` } as ScreenView | null
})

const usage = Effect.gen(function* () {
  const store = yield* RobotState
  const month = currentMonth()
  const browser = store.browserUsage(month).map((row) => ({ backend: row.backend, minutes: Math.round(row.ms / 6_000) / 10, costUsd: row.costUsd }))
  const services = store.serviceUsage(month)
  return { month, ...store.usage(month), limitUsd: (yield* config).spendLimitUsd, ...(browser.length === 0 ? {} : { browser }), ...(services.length === 0 ? {} : { services }) } as UsageView
})

interface TakeoverRow { readonly reason: string; readonly claimedBy: string | null }

/** The robot panel (robot-z3ud). */
export const panel = (canEdit: boolean, summary: RobotSummary) => Effect.gen(function* () {
  const store = yield* RobotState
  const takeover = store.get<TakeoverRow>('takeover')
  return {
    summary,
    settings: yield* settings,
    routines: yield* routineViews,
    screen: yield* screen,
    usage: yield* usage,
    canEdit,
    takeover: takeover === undefined ? null : { reason: takeover.reason, claimedBy: takeover.claimedBy },
  } as RobotPanel
})

/** One row of the admin fleet list, from the DO itself (robot-x26m). */
export const adminRow = Effect.gen(function* () {
  const store = yield* RobotState
  const current = store.config()
  if (current === undefined) return null
  return { fleetState: yield* fleetState, status: current.status, grants: store.grants(), model: current.model, usage: yield* usage, routines: yield* routineViews } as { fleetState: FleetState; status: RobotConfig['status']; grants: GrantSet; model: ModelChoice; usage: UsageView; routines: RoutineView[] }
})

export const status = Effect.gen(function* () {
  return { status: (yield* config).status, fleetState: yield* fleetState }
})

function lastLine(items: readonly ChatItem[]): { text: string; at: number } | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (item.kind === 'reply') return { text: item.text, at: item.at }
    if (item.kind === 'message') return { text: item.text, at: item.at }
    // A failure notice is shown in the conversation; the list keeps the last real line.
    if (item.kind === 'notice' && !item.text.startsWith('The Turn failed')) return { text: item.text, at: item.at }
    if (item.kind === 'question') return { text: item.proposal.purpose, at: item.at }
  }
  return undefined
}

/** Report the registry row (last line, state) to the Home. */
export const report = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  const items = (yield* conversation()).items
  const last = store.get('failed-wakeup') !== undefined
    ? { text: 'Could not finish its last task. Open to see why.', at: items.at(-1)?.at ?? Date.now() }
    : lastLine(items)
  const entry: RegistryEntry = {
    id: current.id, ownerId: current.ownerId, kind: current.kind, identity: current.identity, sharing: current.sharing,
    status: current.status, fleetState: yield* fleetState, lastLine: last?.text ?? '', lastAt: last?.at ?? current.createdAt,
  }
  yield* Effect.promise(() => platform.env.HOME.getByName(HOME_ID).robotChanged(entry))
})

/** Run the wake-up whose Turn failed again (the chat's "Try again"). */
export const retry = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const failed = store.get<{ kind: Parameters<typeof store.enqueue>[0]; sender: Parameters<typeof store.enqueue>[1]; text: string; payload: Record<string, unknown> }>('failed-wakeup')
  if (failed === undefined) return false
  store.delete('failed-wakeup')
  store.enqueue(failed.kind, failed.sender, failed.text, failed.payload, Date.now())
  yield* platform.drain()
  yield* platform.changed()
  return true
})
