/**
 * What the Robot shows (ticket 23, robot-naul): its chat, trajectory, panel, fleet row and
 * registry entry, as Effect programs over the Robot's state. Secrets are masked through the
 * platform; nothing here writes except the registry report.
 */
import * as Effect from 'effect/Effect'
import { effectiveSpendLimit, type HomeSpendLimit } from '@mr-robot/protocol'
import type { ChatItem, Conversation, ConversationPage, ProposalView, ConversationSearchResult, FleetState, GrantSet, ModelChoice, RobotPanel, RobotSummary, ScreenView, TaskView, Trajectory, TrajectoryEvent, TrajectoryExcerpt, UsageView } from '@mr-robot/protocol'
import { readStoredEvents } from '../agent/session-log.ts'
import { HOME_ID } from '../env.ts'
import { currentMonth, type RegistryEntry } from '../home/home.ts'
import { invalid, notFound } from '../platform/durable.ts'
import { homeDefaults, isCold, logOf, proposalView, RobotPlatform, RobotState, settingsWith } from './programs.ts'
import { projectChat, resolveItem, type ResolveInput, type StoredRow } from './projection.ts'
import { formatCursor, parseCursor, type ChatCursor } from './chat-items.ts'
import { chainAccounts, chainOf } from './chain.ts'
import type { RobotConfig, RobotStore, Wakeup } from './store.ts'
import type { Chapter } from './chapters.ts'
import type { BoxView, LastWakeup, RobotTurn, SubagentLine, SubagentView, WakeupCause } from '@mr-robot/protocol'
import { SubagentStore } from './subagent-store.ts'
import { PAGE_TITLES } from '../pages/page.ts'

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
  return new SubagentStore(store.sql).running().map((row): SubagentLine => ({ id: row.id, label: row.label, since: row.startedAt, activity: runningTool(tailEvents(store, row.id, 0)) ?? null }))
})

/** How many of its newest Subagents a Robot lists. */
const SUBAGENTS_SHOWN = 50

/** A Robot's Subagents of its Conversation, newest first (the API and the PWA). */
export const subagents = Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  return new SubagentStore(store.sql).ofConversation(SUBAGENTS_SHOWN).map((row): SubagentView => ({
    id: row.id, label: row.label, mode: row.mode, model: { provider: row.provider, model: row.model, effort: row.effort }, status: row.status,
    startedAt: row.startedAt, finishedAt: row.finishedAt, result: row.report === null ? null : (row.report.split('\n')[0] ?? '').slice(0, 200),
    activity: row.status === 'running' ? runningTool(tailEvents(store, row.id, 0)) ?? null : null,
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
  const activity = runningTool(tailEvents(store, active.sessionId, active.startSeq)) ?? null
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

/** How many events at the end of a log the running tool is looked for in (the Fleet's activity, v1.19 ec-es5g). */
const ACTIVITY_TAIL = 200

/** The last events of a log from `from` on, oldest first. */
function tailEvents(store: RobotStore, sessionId: string, from: number): ReadonlyArray<{ type: string; data: unknown }> {
  return store.sql.exec<{ event: string }>('SELECT event FROM session_event WHERE session_id = ? AND seq >= ? ORDER BY seq DESC LIMIT ?', sessionId, from, ACTIVITY_TAIL).toArray()
    .reverse().map((row) => JSON.parse(row.event) as { type: string; data: unknown })
}

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

/** What a stored row shows now (v1.19): an Ask, a Thread and a Subagent read as they are. */
function resolver(store: RobotStore): ResolveInput {
  const subagents = new SubagentStore(store.sql)
  return {
    proposal: (id) => {
      const row = store.proposal(id)
      return row === undefined ? undefined : proposalView(row)
    },
    thread: (id) => store.thread(id)?.view,
    delegation: (id) => {
      const row = subagents.get(id)
      if (row === undefined || row.status === 'archived') return undefined
      return { subagentId: row.id, label: row.label, mode: row.mode, model: { provider: row.provider, model: row.model, effort: row.effort }, status: row.status, result: row.report === null ? null : (row.report.split('\n')[0] ?? '').slice(0, 200) }
    },
  }
}

/** Items of the PWA's chat page (v1.19, ec-n0uh). */
export const CHAT_PAGE_SIZE = 50

/**
 * Rows of the Conversation, newest first, older than a cursor (v1.19, ec-yxru): one query per chapter the page reaches, never the
 * history. `more` tells whether older rows exist.
 */
function chatRows(store: RobotStore, input: { readonly before: ChatCursor | null; readonly limit: number; readonly details: boolean }): { rows: Array<{ readonly chapter: Chapter; readonly row: StoredRow }>; more: boolean } {
  const out: Array<{ readonly chapter: Chapter; readonly row: StoredRow }> = []
  let chapter = input.before === null ? store.chapters.latest(1)[0] : store.chapters.onChain(input.before.ordinal) ?? store.chapters.olderThan(input.before.ordinal)
  let position = input.before !== null && chapter?.ordinal === input.before.ordinal ? input.before.position : null
  while (chapter !== undefined && out.length <= input.limit) {
    const reached: Chapter = chapter
    const rows = store.chat.page(reached, input.details ? 'detail' : 'compact', position, input.limit + 1 - out.length, (sessionId) => store.chatInput(sessionId), store.chatSides())
    out.push(...rows.map((row) => ({ chapter: reached, row })))
    chapter = store.chapters.olderThan(reached.ordinal)
    position = null
  }
  return { rows: out.slice(0, input.limit), more: out.length > input.limit }
}

/** The rows as items, newest first: what each shows now, with the Page titles of now (dp-e0rp). */
function itemsOf(store: RobotStore, rows: ReadonlyArray<{ readonly row: StoredRow }>): ChatItem[] {
  const resolve = resolver(store)
  const titles = store.get<Record<string, string>>(PAGE_TITLES) ?? {}
  return rows.flatMap(({ row }) => {
    const item = resolveItem(row.item, resolve)
    if (item === undefined) return []
    return [item.kind !== 'reply' || item.attachments === undefined || !item.attachments.some((file) => file.page !== undefined) ? item
      : { ...item, attachments: item.attachments.map((file) => file.page === undefined || titles[file.path] === undefined ? file : { ...file, page: { ...file.page, title: titles[file.path]! } }) }]
  })
}

/** What one Turn of the live chapter showed, from its first event (the Turn's end reads it, v1.19: never the history). */
export const turnItems = (startSeq: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const live = store.chapters.get(current.liveSessionId)
  if (live === undefined) return [] as ChatItem[]
  const rows: StoredRow[] = []
  for (let before: number | null = null; ;) {
    const page = store.chat.page(live, 'compact', before, 50, (sessionId) => store.chatInput(sessionId), store.chatSides())
    rows.push(...page.filter((row) => row.seq >= startSeq))
    if (page.length < 50 || page.at(-1)!.seq < startSeq) break
    before = page.at(-1)!.position
  }
  return itemsOf(store, rows.map((row) => ({ row }))).reverse()
})

const workingNow = (store: RobotStore) => {
  const active = store.activeTurn()
  // The tool running now is in the Turn's own events, at their tail (ec-es5g).
  const activity = active === undefined ? undefined : runningTool(tailEvents(store, active.sessionId, active.startSeq))
  return { working: active !== undefined, ...(activity === undefined ? {} : { activity }) }
}

/** The whole chat, every chapter (tests and Robot RPC); the PWA reads it a page at a time (chatPage). */
export const conversation = (details = false) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const items: ChatItem[] = []
  for (let before: ChatCursor | null = null; ;) {
    const page = chatRows(store, { before, limit: 500, details })
    items.push(...itemsOf(store, page.rows))
    const oldest = page.rows.at(-1)
    if (!page.more || oldest === undefined) break
    before = { ordinal: oldest.chapter.ordinal, position: oldest.row.position }
  }
  return { canRetry: store.get('failed-wakeup') !== undefined, robotId: current.id, ...workingNow(store), items: items.reverse() } as Conversation
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
    case 'proposal': return { ...item, proposal: maskProposal(item.proposal, mask) }
    default: return item
  }
}

function maskProposal(proposal: ProposalView, mask: (text: string) => string): ProposalView {
  const call = proposal.toolCall
  if (call === undefined) return proposal
  return { ...proposal, purpose: mask(proposal.purpose), toolCall: { ...call, reason: mask(call.reason), arguments: call.arguments.map((argument) => ({ ...argument, value: mask(argument.value) })) } }
}

/** The whole chat as a viewer gets it, secrets masked (robot-4zi6). */
export const conversationView = (details = false) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const mask = yield* platform.masker()
  const view = yield* conversation(details)
  return { ...view, items: view.items.map((item) => maskItem(item, mask)) } as Conversation
})

/**
 * One page of the chat as the PWA shows it (v1.19, ec-n0uh): the newest items, or the ones older than a cursor, oldest first, with
 * the cursor of the page before them (null at the start of the Conversation) and every open Ask, wherever it is (rb-dat4).
 */
export const chatPage = (before: string | null, details: boolean) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const mask = yield* (yield* RobotPlatform).masker()
  const cursor = before === null ? null : parseCursor(before)
  if (cursor === undefined) return yield* invalid('before is not a cursor of this chat')
  const page = chatRows(store, { before: cursor, limit: CHAT_PAGE_SIZE, details })
  const oldest = page.rows.at(-1)
  return {
    canRetry: store.get('failed-wakeup') !== undefined,
    robotId: current.id,
    ...workingNow(store),
    items: itemsOf(store, page.rows).reverse().map((item) => maskItem(item, mask)),
    before: page.more && oldest !== undefined ? formatCursor({ ordinal: oldest.chapter.ordinal, position: oldest.row.position }) : null,
    asks: store.proposals('open').map((row) => maskProposal(proposalView(row), mask)),
  } as Conversation
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
  const store = yield* RobotState
  const current = yield* config
  const mask = yield* (yield* RobotPlatform).masker()
  const number = Number.isInteger(page) && page >= 1 ? page : 1
  let cursor: ChatCursor | null = null
  let rows: ReturnType<typeof chatRows> = { rows: [], more: false }
  for (let index = 1; index <= number; index += 1) {
    rows = chatRows(store, { before: cursor, limit: CONVERSATION_PAGE_SIZE, details: false })
    const oldest = rows.rows.at(-1)
    if (oldest === undefined) break
    cursor = { ordinal: oldest.chapter.ordinal, position: oldest.row.position }
    if (!rows.more && index < number) {
      rows = { rows: [], more: false }
      break
    }
  }
  return {
    robotId: current.id,
    working: workingNow(store).working,
    items: itemsOf(store, rows.rows).map((item) => maskItem(item, mask)),
    nextPage: rows.more ? number + 1 : null,
  } as ConversationPage
})

/**
 * The events of the log around one chat item (its id, or an event number of the live chapter), secrets masked and cut to
 * TRAJECTORY_EXCERPT_CHARS of event data so a diagnosis never floods the reader's context (cd-9te1).
 */
export const trajectoryAround = (itemId: string, before: number, after: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const mask = yield* (yield* RobotPlatform).masker()
  let found = store.chat.find(itemId)
  // A chapter not folded yet (written before v1.19) is looked through in memory, newest first.
  for (const chapter of found === undefined ? [...store.chapters.chain()].reverse() : []) {
    if (store.chat.current(chapter.sessionId)) continue
    const row = store.chat.page(chapter, 'detail', null, Number.MAX_SAFE_INTEGER, (sessionId) => store.chatInput(sessionId), store.chatSides()).find((entry) => entry.item.id === itemId)
    if (row !== undefined) {
      found = { seq: row.seq, sessionId: chapter.sessionId }
      break
    }
  }
  found ??= /^\d+$/.test(itemId) ? { seq: Number(itemId), sessionId: current.liveSessionId } : undefined
  if (found === undefined) return yield* notFound(`no item "${itemId}" in this Conversation`)
  const centre = found.seq
  const reach = (count: number) => Math.min(Math.max(Math.trunc(count), 0), TRAJECTORY_REACH)
  const from = Math.max(0, centre - reach(before))
  const to = centre + reach(after)
  const rows = isCold(store, found.sessionId)
    ? (yield* logOf(found.sessionId)).filter((event) => event.seq >= from && event.seq <= to).map((event) => ({ event: JSON.stringify(event) }))
    : store.sql.exec<{ event: string }>('SELECT event FROM session_event WHERE session_id = ? AND seq BETWEEN ? AND ? ORDER BY seq', found.sessionId, from, to).toArray()
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
  const mask = yield* (yield* RobotPlatform).masker()
  return (yield* logOf(sessionId)).map((event): TrajectoryEvent => ({
    seq: event.seq,
    type: event.type,
    time: event.time,
    turn: typeof (event.data as { turn?: unknown }).turn === 'number' ? (event.data as { turn: number }).turn : null,
    data: mask(JSON.stringify(event.data)),
  }))
})

/** A chapter by its ordinal, or the live one (v1.19). */
const chapterOf = (ordinal: number | undefined) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const chapter = ordinal === undefined ? store.chapters.get(current.liveSessionId) : store.chapters.byOrdinal(ordinal)
  if (chapter === undefined) return yield* notFound(`no chapter ${ordinal ?? 'live'} in this Conversation`)
  return chapter
})

/**
 * One chapter's whole log (robot-h5v3, v1.19 ec-mwvo, ec-elhb), the live one by default, secrets masked, with the list of every
 * chapter: an old chapter reads its own events only.
 */
export const trajectory = (ordinal?: number) => Effect.gen(function* () {
  const store = yield* RobotState
  const current = yield* config
  const chapter = yield* chapterOf(ordinal)
  return {
    robotId: current.id, sessionId: chapter.sessionId, chapter: chapter.ordinal, chapters: store.chapters.views(),
    events: yield* trajectoryEvents(chapter.sessionId), rewinds: store.rewinds(),
  } as Trajectory
})


/**
 * The live session's DSH events exactly as stored (every field, including surfaceOp), secrets
 * masked, for the DSH trajectory view. Pages backwards with before, forwards with after.
 */
export const sessionEvents = (input: { before?: number; after?: number; limit?: number; chapter?: number }) => Effect.gen(function* () {
  return yield* eventsPage((yield* chapterOf(input.chapter)).sessionId, input)
})

const eventsPage = (sessionId: string, input: { before?: number; after?: number; limit?: number }) => Effect.gen(function* () {
  const store = yield* RobotState
  const mask = yield* (yield* RobotPlatform).masker()
  const limit = Math.min(Math.max(input.limit ?? 400, 1), 2000)
  // A cold chapter's log is one object: it is paged in memory (ec-aly5).
  const cold = isCold(store, sessionId) ? (yield* logOf(sessionId)).map((event) => ({ seq: event.seq, event: JSON.stringify(event) })) : undefined
  const rows = cold !== undefined
    ? (input.after !== undefined ? cold.filter((row) => row.seq > input.after!).slice(0, limit) : cold.filter((row) => row.seq < (input.before ?? Number.MAX_SAFE_INTEGER)).slice(-limit))
    : input.after !== undefined
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
  // A Subagent belongs to the chapter it ran in (v1.19, ec-h8ib); every chapter's stay readable.
  if (row === undefined || store.chapters.get(row.parentSession) === undefined) return yield* notFound('no such Subagent')
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
  const events = yield* logOf(row.id)
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
function boxView(stored: StoredBox | undefined, jobs: ReadonlyArray<{ id: string; command: string; startedAt: number }>): BoxView {
  const running = jobs.length === 0 ? {} : { jobs: jobs.map(({ id, command, startedAt }) => ({ id, command: command.slice(0, 200), startedAt })) }
  return stored === undefined || stored.state === 'off' ? { state: 'off', since: null, lastCommandAt: null, ...running } : { state: stored.state, since: stored.since ?? null, lastCommandAt: stored.lastCommandAt ?? null, ...running }
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
    ...(store.mayUse('tool', 'box') ? { box: boxView(store.get<StoredBox>('box'), store.runningJobs('box').filter((job) => !job.foreground)) } : {}),
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
    if (item.kind === 'proposal' && item.proposal.status === 'open') return { text: `Waiting for you: ${item.proposal.purpose}`, at: item.at }
  }
  return undefined
}

/** Report the registry row (last line, state) to the Home. */
export const report = Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  // The last line is among the newest items (v1.19): a few pages at most, never the history.
  let newest: ChatItem | undefined
  let line: { text: string; at: number } | undefined
  for (let page = 0, before: ChatCursor | null = null; page < 3 && line === undefined; page += 1) {
    const rows = chatRows(store, { before, limit: 30, details: false })
    const items = itemsOf(store, rows.rows)
    newest ??= items[0]
    line = lastLine([...items].reverse())
    const oldest = rows.rows.at(-1)
    if (!rows.more || oldest === undefined) break
    before = { ordinal: oldest.chapter.ordinal, position: oldest.row.position }
  }
  const last = store.get('failed-wakeup') !== undefined
    ? { text: 'Could not finish its last task. Open to see why.', at: newest?.at ?? Date.now() }
    : line
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