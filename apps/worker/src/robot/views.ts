/**
 * What the Robot shows (ticket 23, robot-naul): its chat, trajectory, panel, fleet row and
 * registry entry, as Effect programs over the Robot's state. Secrets are masked through the
 * platform; nothing here writes except the registry report.
 */
import * as Effect from 'effect/Effect'
import { effectiveSpendLimit, type HomeSpendLimit } from '@mr-robot/protocol'
import type { ChatItem, Conversation, ConversationPage, ConversationSearchResult, FleetState, GrantSet, ModelChoice, RobotPanel, RobotSummary, ScreenView, TaskView, Trajectory, TrajectoryEvent, TrajectoryExcerpt, UsageView } from '@mr-robot/protocol'
import { readStoredEvents } from '../agent/session-log.ts'
import { HOME_ID } from '../env.ts'
import { currentMonth, type RegistryEntry } from '../home/home.ts'
import { invalid, notFound } from '../platform/durable.ts'
import { homeDefaults, proposalView, RobotPlatform, RobotState, settingsWith } from './programs.ts'
import { projectChat } from './projection.ts'
import { chainAccounts, chainOf } from './chain.ts'
import type { RobotConfig, Wakeup } from './store.ts'
import type { BoxView, LastWakeup, RobotTurn, SubagentLine, SubagentView, WakeupCause } from '@mr-robot/protocol'
import { SubagentStore } from './subagent-store.ts'

/** What woke the Robot, as its fleet row names it (mc-w1aa). */
export function causeOf(wakeup: Wakeup): WakeupCause {
  const sender = wakeup.sender
  switch (wakeup.kind) {
    case 'task': {
      const who = typeof wakeup.payload['who'] === 'string' ? wakeup.payload['who'] : undefined
      return { kind: 'task', from: wakeup.payload['by'] === 'member' || wakeup.payload['by'] === 'robot' ? who ?? 'run now' : 'schedule' }
    }
    default:
      return {
        kind: wakeup.kind,
        from: sender.kind === 'member' || sender.kind === 'robot' ? sender.name : sender.kind === 'channel' ? `${sender.channel} ${sender.from}` : wakeup.kind === 'takeover' ? 'takeover' : 'platform',
      }
  }
}

/** The running Subagents as lines of the Robot's row (ao-2fgp, ao-j8t9). */
export const subagentLines = Effect.gen(function* () {
  const store = yield* RobotState
  return new SubagentStore(store.sql).running().map((row): SubagentLine => ({ id: row.id, label: row.label, since: row.startedAt, activity: runningTool(readStoredEvents(store.sql, row.id)) ?? null }))
})

/** A Robot's Subagents of its live Conversation, newest first (the API and the PWA). */
export const subagents = Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  return new SubagentStore(store.sql).of(current.liveSessionId).map((row): SubagentView => ({
    id: row.id, label: row.label, mode: row.mode, model: { provider: row.provider, model: row.model, effort: row.effort }, status: row.status,
    startedAt: row.startedAt, finishedAt: row.finishedAt, result: row.report === null ? null : (row.report.split('\n')[0] ?? '').slice(0, 200),
    activity: row.status === 'running' ? runningTool(readStoredEvents(store.sql, row.id)) ?? null : null,
  }))
})

/** The kv key of the last Turn's cause and subject. */
export const LAST_WAKEUP = 'last-wakeup'

/** The running Turn as the registry row shows it: cause, subject, the tool running now, and since when. */
const runningTurn = Effect.gen(function* () {
  const store = yield* RobotState
  const active = store.activeTurn()
  const wakeup = active === undefined ? undefined : store.wakeup(active.wakeupId)
  if (active === undefined || wakeup === undefined) return null
  const activity = runningTool(readStoredEvents(store.sql, active.sessionId, active.startSeq)) ?? null
  return { wakeup: causeOf(wakeup), task: active.task === null ? null : { id: active.task.id, title: active.task.title }, activity, since: active.startedAt } as RobotTurn
})

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
  // Subagents that run while the Robot's Turn has ended are its work too (ao-j8t9).
  if (store.activeTurn() !== undefined || new SubagentStore(store.sql).running().length > 0) return 'working' as FleetState
  // A failed Turn waiting for "Try again" is a state, not a raw error in the list.
  if (store.get('failed-wakeup') !== undefined) return 'blocked' as FleetState
  if (store.proposals('open').length > 0 || store.get('takeover') !== undefined) return 'waiting for you' as FleetState
  if (current.status === 'setup') return 'setup' as FleetState
  return 'sleeping' as FleetState
})

/** The tool running now: the latest call without a result (a code program's latest inner call wins). */
export function runningTool(events: ReadonlyArray<{ type: string; data: unknown }>): string | undefined {
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
    assistantRepliesBefore: store.voiceFrom(current.liveSessionId),
    notices: store.notices(current.liveSessionId),
    thread: (id) => store.thread(id)?.view,
    avatarSeed: current.identity.avatarSeed,
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
  // One card per delegation (ao-15ui), where the Robot started it; it follows the Subagent's state.
  for (const row of new SubagentStore(store.sql).of(current.liveSessionId).reverse()) {
    const position = items.findIndex((item) => item.seq >= row.parentSeq)
    const card: ChatItem = {
      kind: 'delegation', id: `delegation-${row.id}`, seq: row.parentSeq, at: row.startedAt, subagentId: row.id, label: row.label, mode: row.mode,
      model: { provider: row.provider, model: row.model, effort: row.effort }, status: row.status, result: row.report === null ? null : (row.report.split('\n')[0] ?? '').slice(0, 200),
    }
    items.splice(position < 0 ? items.length : position, 0, card)
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
    case 'delegation': return { ...item, label: mask(item.label), result: item.result === null ? null : mask(item.result) }
    case 'activity': return item.calls === undefined ? item : { ...item, calls: item.calls.map((call) => ({ ...call, args: mask(call.args), result: mask(call.result), inner: call.inner.map((inner) => ({ ...inner, args: mask(inner.args) })) })) }
    // A tool-call Ask shows the stored arguments; a secret value among them is masked like the chat (sk-hx8j).
    case 'question': {
      const call = item.proposal.toolCall
      if (call === undefined) return item
      return { ...item, proposal: { ...item.proposal, purpose: mask(item.proposal.purpose), toolCall: { ...call, reason: mask(call.reason), arguments: call.arguments.map((argument) => ({ ...argument, value: mask(argument.value) })) } } }
    }
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

/** Items on one page of a Conversation read by another Robot (cd-gjhb). */
export const CONVERSATION_PAGE_SIZE = 20
/** A Trajectory excerpt stays within this many characters of event data in all (cd-9te1), and each event's data within the second. */
export const TRAJECTORY_EXCERPT_CHARS = 12_000
export const TRAJECTORY_EVENT_CHARS = 1_500
/** Most events either side of the centre an excerpt may ask for. */
const TRAJECTORY_REACH = 40

/** The chat as a viewer gets it, newest item first, a page at a time (page is 1-based); the same items the PWA shows. */
export const conversationPage = (page: number) => Effect.gen(function* () {
  const view = yield* conversationView(false)
  const number = Number.isInteger(page) && page >= 1 ? page : 1
  const newest = [...view.items].reverse()
  return {
    robotId: view.robotId,
    working: view.working,
    items: newest.slice((number - 1) * CONVERSATION_PAGE_SIZE, number * CONVERSATION_PAGE_SIZE),
    nextPage: newest.length > number * CONVERSATION_PAGE_SIZE ? number + 1 : null,
  } as ConversationPage
})

/**
 * The events of the live log around one chat item (its id, or an event number), secrets masked and
 * cut to TRAJECTORY_EXCERPT_CHARS of event data so a diagnosis never floods the reader's context (cd-9te1).
 */
export const trajectoryAround = (itemId: string, before: number, after: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const mask = yield* (yield* RobotPlatform).masker()
  const item = (yield* conversation()).items.find((entry) => entry.id === itemId)
  const centre = item?.seq ?? (/^\d+$/.test(itemId) ? Number(itemId) : undefined)
  if (centre === undefined) return yield* notFound(`no item "${itemId}" in this Conversation`)
  const reach = (count: number) => Math.min(Math.max(Math.trunc(count), 0), TRAJECTORY_REACH)
  const rows = store.sql.exec<{ event: string }>(
    'SELECT event FROM session_event WHERE session_id = ? AND seq BETWEEN ? AND ? ORDER BY seq',
    current.liveSessionId, Math.max(0, centre - reach(before)), centre + reach(after),
  ).toArray()
  const events: TrajectoryEvent[] = []
  let used = 0
  let truncated = false
  for (const row of rows) {
    const event = JSON.parse(row.event) as { seq: number; type: string; time: number; data: Record<string, unknown> }
    const text = mask(JSON.stringify(event.data))
    const data = text.length > TRAJECTORY_EVENT_CHARS ? `${text.slice(0, TRAJECTORY_EVENT_CHARS)}… (${text.length - TRAJECTORY_EVENT_CHARS} more characters)` : text
    if (used + data.length > TRAJECTORY_EXCERPT_CHARS) {
      truncated = true
      break
    }
    used += data.length
    events.push({ seq: event.seq, type: event.type, time: event.time, turn: typeof event.data['turn'] === 'number' ? event.data['turn'] : null, data })
  }
  return { robotId: current.id, seq: centre, events, truncated } as TrajectoryExcerpt
})

/** Text search over the live Conversation, newest first, paged (cd-ggem); snippets are masked like the chat. */
export const searchConversation = (query: string, page: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const mask = yield* (yield* RobotPlatform).masker()
  const result = yield* Effect.try({
    try: () => store.search.search(current.liveSessionId, query, page),
    catch: (error) => invalid(error instanceof Error ? error.message : String(error)),
  })
  return {
    items: result.hits.map((hit) => ({ id: hit.id, sender: hit.sender ?? current.identity.name, at: hit.at, snippet: mask(hit.snippet) })),
    nextPage: result.nextPage,
  } as ConversationSearchResult
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
  const current = yield* config
  return yield* eventsPage(current.liveSessionId, input)
})

const eventsPage = (sessionId: string, input: { before?: number; after?: number; limit?: number }) => Effect.gen(function* () {
  const store = yield* RobotState
  const mask = yield* (yield* RobotPlatform).masker()
  const limit = Math.min(Math.max(input.limit ?? 400, 1), 2000)
  const rows = input.after !== undefined
    ? store.sql.exec<{ seq: number; event: string }>('SELECT seq, event FROM session_event WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?', sessionId, input.after, limit).toArray()
    : store.sql.exec<{ seq: number; event: string }>('SELECT seq, event FROM session_event WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?', sessionId, input.before ?? Number.MAX_SAFE_INTEGER, limit).toArray().reverse()
  const first = rows[0]?.seq
  // Events cross the RPC boundary as one JSON text (deep JSON types do not survive RPC typing).
  return { events: `[${rows.map((row) => mask(row.event)).join(',')}]`, hasMore: first !== undefined && first > 0 && input.after === undefined, sessionId }
})

const childOf = (childId: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const row = new SubagentStore(store.sql).get(childId)
  if (row === undefined || row.parentSession !== current.liveSessionId) return yield* notFound('no such Subagent')
  return row
})

/** A Subagent's own log, paged like the Robot's (its Trajectory, ao-ce55). */
export const subagentEvents = (childId: string, input: { before?: number; after?: number; limit?: number }) => Effect.gen(function* () {
  const row = yield* childOf(childId)
  return yield* eventsPage(row.id, input)
})

/** A Subagent's own Chat (ao-ce55): its log projected, secrets masked; no proposals, it has no Asks. */
export const subagentConversation = (childId: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const row = yield* childOf(childId)
  const mask = yield* (yield* RobotPlatform).masker()
  const events = readStoredEvents(store.sql, row.id)
  // A Subagent has no say: its assistant text is what it says (its report).
  const items = projectChat({ events, assistantRepliesBefore: Number.POSITIVE_INFINITY, notices: [], avatarSeed: current.identity.avatarSeed, proposal: () => undefined }).map((item) => maskItem(item, mask))
  const working = row.status === 'running'
  const activity = working ? runningTool(events) : undefined
  return { robotId: current.id, working, items, ...(activity === undefined ? {} : { activity }) } as Conversation
})


const screen = Effect.gen(function* () {
  const store = yield* RobotState
  const saved = store.get<{ path: string; at: number }>('screen')
  if (saved === undefined) return null as ScreenView | null
  const id = (yield* config).id
  return { path: saved.path, at: saved.at, url: `/api/robots/${encodeURIComponent(id)}/screen?at=${saved.at}` } as ScreenView | null
})

/** This month's usage and the spend limit in effect; `home` is the Home's per-Robot limit. */
const usage = (home: HomeSpendLimit) => Effect.gen(function* () {
  const store = yield* RobotState
  const month = currentMonth()
  const browser = store.browserUsage(month).map((row) => ({ backend: row.backend, minutes: Math.round(row.ms / 6_000) / 10, costUsd: row.costUsd }))
  const services = store.serviceUsage(month)
  const box = store.boxUsage(month)
  return { month, ...store.usage(month), breakdown: store.costBreakdown(month), ...(box.ms === 0 ? {} : { boxMinutes: Math.round(box.ms / 6_000) / 10 }), limit: effectiveSpendLimit((yield* config).spendLimit, home), ...(browser.length === 0 ? {} : { browser }), ...(services.length === 0 ? {} : { services }) } as UsageView
})

interface TakeoverRow { readonly reason: string; readonly claimedBy: string | null }

type StoredBox = { readonly state: BoxView['state']; readonly since?: number; readonly lastCommandAt?: number }

/** The Box as the panel shows it (ao-9q18): off, booting, running or stopping, since when and its last command. */
function boxView(stored: StoredBox | undefined): BoxView {
  return stored === undefined || stored.state === 'off' ? { state: 'off', since: null, lastCommandAt: null } : { state: stored.state, since: stored.since ?? null, lastCommandAt: stored.lastCommandAt ?? null }
}

/** The robot panel (robot-z3ud). */
export const panel = (canEdit: boolean, summary: RobotSummary, tasks: readonly TaskView[]) => Effect.gen(function* () {
  const store = yield* RobotState
  const takeover = store.get<TakeoverRow>('takeover')
  const home = yield* homeDefaults
  return {
    summary,
    settings: yield* settingsWith(home),
    tasks,
    screen: yield* screen,
    usage: yield* usage(home.robotSpendLimit),
    canEdit,
    takeover: takeover === undefined ? null : { reason: takeover.reason, claimedBy: takeover.claimedBy },
    ...(store.config()?.kind === 'mr-robot' ? { threads: store.threads().map((copy) => copy.view) } : {}),
    ...(store.mayUse('tool', 'box') ? { box: boxView(store.get<StoredBox>('box')) } : {}),
    // Requests for help still waiting, oldest first (sk-fmvh).
    help: store.proposals('open').flatMap((row) => row.kind === 'help' && row.help !== undefined ? [{ id: row.id, text: row.help.need, urgent: row.help.urgent, created: row.help.created, escalated: row.help.escalated }] : []),
  } as RobotPanel
})

/** One row of the admin fleet list, from the DO itself (robot-x26m); `home` is the Home's per-Robot limit. */
export const adminRow = (home: HomeSpendLimit) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = store.config()
  if (current === undefined) return null
  return { fleetState: yield* fleetState, status: current.status, grants: store.grants(), model: current.model, usage: yield* usage(home) } as { fleetState: FleetState; status: RobotConfig['status']; grants: GrantSet; model: ModelChoice; usage: UsageView }
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
    // Only an open Ask is news for the list; an answered one is history.
    if (item.kind === 'question' && item.proposal.status === 'open') return { text: `Waiting for you: ${item.proposal.purpose}`, at: item.at }
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
    accounts: chainAccounts(chainOf(current)),
    turn: yield* runningTurn,
    lastWakeup: store.get<LastWakeup>(LAST_WAKEUP) ?? null,
    subagents: yield* subagentLines,
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
