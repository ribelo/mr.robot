/**
 * The simple chat view of a Conversation (robot-q4b2), projected from the same session log the Trajectory shows (robot-frf5): one
 * fold over its events, which stores the chat as they are written (v1.19, ec-2sra, chat-items.ts) and projects a log at once.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Attachment, ChatItem, ToolCallView, ProposalView, Sender, TaskAction, ThreadView } from '@mr-robot/protocol'
import { JOIN_SEPARATOR, MEMBER_TIME_LABEL } from '../agent/sources.ts'
import { DISMISSED_TRAILER, sayOf } from '../agent/say.ts'
import type { NoticeRow, StoredRoutineCard } from './store.ts'

interface ContentBlock { readonly type: string; readonly text?: string }
interface MessageLike { readonly id: string; readonly content: readonly ContentBlock[]; readonly source?: Record<string, unknown> }

/** Tools whose use the chat already shows in their own way (a 👍 on the message, what was said as a reply). */
const HIDDEN_TOOLS = new Set(['react', 'say'])

/**
 * Routine tools of Conversations stored before v1.13, and the schedule tools before them: read-only, so their
 * cards still render, as the Task cards they now are (mc-c2bb). A deleted Routine reads as a cancelled Task.
 */
const LEGACY_ROUTINE_TOOLS: Record<string, TaskAction> = {
  routine_create: 'created',
  routine_update: 'updated',
  routine_delete: 'cancelled',
  routine_pause: 'paused',
  schedule_create: 'created',
  schedule_update: 'updated',
  schedule_delete: 'cancelled',
}

/** The card of a stored Routine tool call; a call about another Robot (robot_id) has none here. */
function routineAction(name: string, args: Record<string, unknown>): TaskAction | undefined {
  if (args['robot_id'] !== undefined) return undefined
  if (name === 'routine_set') return args['id'] === undefined ? 'created' : 'updated'
  if (name === 'routine_pause') return args['paused'] === false ? 'resumed' : 'paused'
  return LEGACY_ROUTINE_TOOLS[name]
}

/** A Routine card notice stored before v1.13, as the Task card it now is. */
const ROUTINE_CARD_ACTIONS: Record<StoredRoutineCard['action'], TaskAction> = { created: 'created', updated: 'updated', deleted: 'cancelled', paused: 'paused', resumed: 'resumed' }
/**
 * The card a Task tool call shows in the Conversation of the Robot that made it (mc-c1aa). A call with robot_id
 * works as another Robot; the Space tells that Robot's Conversation, not this one.
 */
function taskAction(name: string, args: Record<string, unknown>): TaskAction | undefined {
  if (args['robot_id'] !== undefined) return undefined
  switch (name) {
    case 'task_create': return 'created'
    case 'task_update': return 'updated'
    case 'task_assign': return 'assigned'
    case 'task_done': return 'done'
    case 'task_cancel': return 'cancelled'
    case 'task_pause': return args['paused'] === false ? 'resumed' : 'paused'
    default: return undefined
  }
}

// need_help stays for the logs written before v1.15.
const QUESTION_TOOLS = new Set(['propose_grants', 'propose_member_file_edit', 'propose_skill', 'propose_review', 'request_takeover', 'setup_complete', 'need_help', 'ask', 'request_credential'])

/** Which work-details level shows a stored row: both, Compact only, or Standard and above (pl-6eir). */
export type ChatRowView = 'both' | 'compact' | 'detail'

type ItemOf<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>
/**
 * A chat item as stored (v1.19, ec-2sra): what changes after it is written (an Ask's state, a Thread's, a Subagent's) is stored as a
 * reference and read when the chat is shown.
 */
export type StoredItem =
  | Exclude<ChatItem, { kind: 'proposal' | 'thread' | 'delegation' | 'working' }>
  | { readonly kind: 'proposal'; readonly id: string; readonly seq: number; readonly at: number; readonly proposalId: string }
  | { readonly kind: 'thread'; readonly id: string; readonly seq: number; readonly at: number; readonly event: ItemOf<'thread'>['event']; readonly threadId: string; readonly text: string }
  | { readonly kind: 'delegation'; readonly id: string; readonly seq: number; readonly at: number; readonly subagentId: string }

export interface StoredRow {
  /** Its place in its chapter's chat, from 0. */
  readonly position: number
  /** The event it was folded from; a row added beside the log (a notice, an Ask, a delegation) has the log's length then. */
  readonly seq: number
  readonly view: ChatRowView
  readonly item: StoredItem
}

/** Where the fold reads and writes the rows of one chapter: the chat_item table, or an array. */
export interface ChatRows {
  get(position: number): StoredRow | undefined
  put(row: StoredRow): void
}

/** The fold's memory between events of one chapter (stored beside its rows). */
export interface ChatFold {
  readonly next: number
  /** Tool calls whose result has not come yet. */
  readonly calls: Readonly<Record<string, { readonly name: string; readonly args: Record<string, unknown> }>>
  /** Code mode: the inner calls of a program whose result has not come yet. */
  readonly inner: Readonly<Record<string, ReadonlyArray<{ readonly name: string; readonly args: Record<string, unknown>; /** v1.22: the id and title its result named (a Task it created). */ readonly made?: { readonly id?: string; readonly title?: string } }>>>
  /** The owner's last message, which a react marks. */
  readonly lastMember: number | null
  /** The last row Compact shows, and the last row Standard and above show: a step's activity merges into it. */
  readonly lastCompact: number | null
  readonly lastDetail: number | null
  /** Asks that already have a row in this chapter. */
  readonly proposals: readonly string[]
}

export const EMPTY_FOLD: ChatFold = { next: 0, calls: {}, inner: {}, lastMember: null, lastCompact: null, lastDetail: null, proposals: [] }

export interface FoldInput {
  /**
   * Assistant text before this event is a reply (v1.15, gb-psyl): the Conversation of a Robot from before the upgrade, which
   * had no say. From it on, only what the Robot said is a reply. Zero for a Robot that always had say; Infinity for a Subagent, which has none.
   */
  readonly assistantRepliesBefore: number
  /** This chief's copy of a Thread (v1.9), for labelling the messages it sent. */
  readonly thread?: (id: string) => ThreadView | undefined
  /** This Robot's avatar seed: the messages it sent in a Thread show its avatar (ux-n1mw). */
  readonly avatarSeed: string
}

/** A row beside the log: a notice, an Ask or a delegation, where it happens. */
export function foldSide(fold: ChatFold, rows: ChatRows, item: StoredItem): ChatFold {
  rows.put({ position: fold.next, seq: item.seq, view: 'both', item })
  return {
    ...fold,
    next: fold.next + 1,
    lastCompact: fold.next,
    lastDetail: fold.next,
    proposals: item.kind === 'proposal' ? [...fold.proposals, item.proposalId] : fold.proposals,
  }
}

/** The stored notice row of a notice, its card kept as a reference to what it shows. */
export function noticeItem(notice: Pick<NoticeRow, 'id' | 'at' | 'text' | 'card'>, seq: number): StoredItem {
  const card = notice.card
  if (card === undefined) return { kind: 'notice', id: notice.id, seq, at: notice.at, text: notice.text }
  if (card.kind === 'thread') return { kind: 'thread', id: notice.id, seq, at: notice.at, event: card.event, threadId: card.threadId, text: notice.text }
  if (card.kind === 'task') return { kind: 'task', id: notice.id, seq, at: notice.at, action: card.action, taskId: card.taskId, title: card.title, by: card.by }
  return { kind: 'task', id: notice.id, seq, at: notice.at, action: ROUTINE_CARD_ACTIONS[card.action], taskId: null, title: card.name, by: card.by }
}

/** Fold one event of a chapter into its rows (the same fold stores the chat as events arrive and projects a log at once). */
export function foldEvent(start: ChatFold, event: SessionEvent, rows: ChatRows, input: FoldInput): ChatFold {
  let fold = start
  const put = (item: StoredItem, view: ChatRowView = 'both'): number => {
    const position = fold.next
    rows.put({ position, seq: event.seq, view, item })
    fold = { ...fold, next: position + 1, lastCompact: view === 'detail' ? fold.lastCompact : position, lastDetail: view === 'compact' ? fold.lastDetail : position }
    return position
  }
  const replace = (position: number, item: StoredItem) => {
    const row = rows.get(position)
    if (row !== undefined) rows.put({ ...row, item })
  }
  const react = (emoji: string) => {
    const target = fold.lastMember === null ? undefined : rows.get(fold.lastMember)?.item
    if (target?.kind === 'message') replace(fold.lastMember!, { ...target, reaction: emoji })
  }
  /** The step's tools merge into the last row the level shows when it is an activity; else a new activity row. */
  const activity = (last: number | null, view: 'compact' | 'detail', id: string, tools: readonly string[], calls?: readonly ToolCallView[]) => {
    const previous = last === null ? undefined : rows.get(last)
    if (previous?.item.kind === 'activity') {
      replace(previous.position, { ...previous.item, tools: [...previous.item.tools, ...tools], ...(calls === undefined && previous.item.calls === undefined ? {} : { calls: [...(previous.item.calls ?? []), ...(calls ?? [])] }) })
      return
    }
    put({ kind: 'activity', id, seq: event.seq, at: event.time, tools: [...tools], ...(calls === undefined ? {} : { calls: [...calls] }) }, view)
  }
  // A message this chief sent in a Thread is shown labelled with the chief's own name (ch-iy16).
  const sentMessage = (args: Record<string, unknown>, id: string, result: Record<string, unknown> | undefined) => {
    if (result !== undefined && result['sent'] !== true) return
    const view = input.thread?.(String(args['thread_id'] ?? result?.['threadId'] ?? ''))
    if (view === undefined || typeof args['text'] !== 'string') return
    put({ kind: 'message', id: 'thread-' + id, seq: event.seq, at: event.time, sender: { kind: 'robot', robotId: view.self.robotId, name: view.self.label, avatarColor: view.self.avatarColor, avatarSeed: input.avatarSeed }, text: args['text'], attachments: [], reaction: null, thread: { id: view.id, topic: view.topic } })
  }

  const data = event.data as Record<string, unknown>
  const said = sayOf(event)
  if (said !== undefined) {
    put({ kind: 'reply', id: said.id, seq: event.seq, at: event.time, text: said.text, ...(said.attachments.length === 0 ? {} : { attachments: said.attachments }), ...(said.fallback === true ? { fallback: true } : {}) })
    return fold
  }
  switch (event.type) {
    case 'user/message': {
      const message = data as unknown as MessageLike
      if (message.source?.['kind'] === 'compact-checkpoint') {
        // DSH's compaction checkpoint is for the model; the chat keeps the full history.
        put({ kind: 'notice', id: message.id, seq: event.seq, at: event.time, text: 'Earlier conversation condensed to fit the context budget.' })
        break
      }
      // DSH's own context messages (skill catalog, reminders) are for the model, not the chat.
      if (!CHAT_SOURCES.has(String(message.source?.['kind'] ?? 'member'))) break
      const sender = senderOf(message.source)
      if (sender.kind === 'platform') {
        // Conversations started before the chat text was split from the setup instruction.
        const raw = String(message.source?.['summary'] ?? '')
        const summary = raw.startsWith('Setup started.') ? 'Setup started' : raw
        if (summary.length > 0 && message.source?.['hidden'] !== true) put({ kind: 'notice', id: message.id, seq: event.seq, at: event.time, text: summary })
        break
      }
      if (sender.kind === 'task') {
        put({ kind: 'task', id: message.id, seq: event.seq, at: event.time, action: 'ran', taskId: sender.taskId, title: sender.name })
        break
      }
      // Follow-ups joined into one message (ao-rdhs) are shown as the messages they were.
      let last = -1
      for (const [index, part] of partsOf(message).entries()) {
        last = put({
          kind: 'message',
          id: index === 0 ? message.id : `${message.id}-${index}`,
          seq: event.seq,
          at: event.time,
          sender,
          text: visibleText(part.message, sender),
          attachments: part.attachments,
          reaction: null,
          ...(part.clientId === undefined ? {} : { clientId: part.clientId }),
          ...(typeof message.source?.['threadId'] === 'string' ? { thread: { id: message.source['threadId'], topic: String(message.source['topic'] ?? '') } } : {}),
          ...(message.source?.['question'] === true ? { question: true as const } : {}),
        })
      }
      if (sender.kind === 'member' && last >= 0) fold = { ...fold, lastMember: last }
      break
    }
    case 'assistant/message': {
      const message = data['message'] as MessageLike | undefined
      if (message !== undefined) {
        const thinking = message.content.filter((block) => block.type === 'reasoning').map((block) => block.text ?? '').join('\n').trim()
        if (thinking.length > 0) put({ kind: 'thinking', id: 'thinking-' + message.id, seq: event.seq, at: event.time, text: clip(thinking, 20_000) }, 'detail')
      }
      const text = (message?.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('').trim()
      if (message !== undefined && text.length > 0 && event.seq < input.assistantRepliesBefore) put({ kind: 'reply', id: message.id, seq: event.seq, at: event.time, text })
      break
    }
    case 'turn/end': {
      const reason = data['reason'] as { kind?: string; error?: { message?: string } } | undefined
      if (reason?.kind === 'error') put({ kind: 'notice', id: `turn-error-${event.seq}`, seq: event.seq, at: event.time, text: `The Turn failed: ${reason.error?.message ?? 'unknown error'}` })
      break
    }
    case 'tool/call': {
      const name = String(data['name'])
      const args = parseArgs(data['arguments'])
      fold = { ...fold, calls: { ...fold.calls, [String(data['callId'])]: { name, args } } }
      if (name === 'react') react(String(args['emoji'] ?? '👍'))
      break
    }
    case 'tool/ptc-dispatch': {
      // Code mode: the program's inner calls, shown once the program succeeds.
      const root = String(data['rootCallId'])
      fold = { ...fold, inner: { ...fold.inner, [root]: [...(fold.inner[root] ?? []), { name: String(data['name']), args: (data['arguments'] ?? {}) as Record<string, unknown>, ...madeBy(data) }] } }
      break
    }
    case 'tool/result': {
      const message = data['message'] as (MessageLike & { toolCallId?: string; isError?: boolean }) | undefined
      const callId = String(message?.toolCallId)
      const call = fold.calls[callId]
      const inners = fold.inner[callId] ?? []
      const { [callId]: _call, ...calls } = fold.calls
      const { [callId]: _inner, ...inner } = fold.inner
      fold = { ...fold, calls, inner }
      if (message === undefined || call === undefined) break
      const failed = message.isError === true || data['error'] !== undefined
      const used = failed ? [] : [call.name === 'run_code' ? 'code' : call.name, ...inners.map((entry) => entry.name)].filter((name) => !HIDDEN_TOOLS.has(name))
      // Standard and above: the call with its arguments and result (pl-6eir), in the same activity line as the step's tools.
      if (!HIDDEN_TOOLS.has(call.name)) {
        const text = message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
        const view: ToolCallView = {
          id: callId,
          name: call.name,
          args: clip(JSON.stringify(call.args, null, 2), 4_000),
          result: clip(text || String((data['error'] as { message?: string } | undefined)?.message ?? ''), 6_000),
          error: failed,
          inner: inners.map((entry) => ({ name: entry.name, args: clip(JSON.stringify(entry.args), 1_000) })),
        }
        activity(fold.lastDetail, 'detail', 'activity-' + message.id, [], [view])
      }
      if (failed) break
      // Compact activity: the step's tools, merged into one collapsed line per step.
      if (used.length > 0) {
        activity(fold.lastCompact, 'compact', 'activity-' + message.id, used)
        activity(fold.lastDetail, 'detail', 'activity-' + message.id, used)
      }
      inners.forEach((entry, index) => {
        if (entry.name === 'thread_send') sentMessage(entry.args, message.id + '-' + String(index), undefined)
        const innerTask = taskAction(entry.name, entry.args)
        const innerAction = routineAction(entry.name, entry.args)
        if (innerTask !== undefined) {
          put({ kind: 'task', id: message.id + '-' + String(index), seq: event.seq, at: event.time, action: innerTask, taskId: typeof entry.args['task_id'] === 'string' ? entry.args['task_id'] : entry.made?.id ?? null, title: String(entry.args['title'] ?? entry.made?.title ?? 'a Task') })
        } else if (innerAction !== undefined) {
          put({ kind: 'task', id: message.id + '-' + String(index), seq: event.seq, at: event.time, action: innerAction, taskId: typeof entry.args['id'] === 'string' ? entry.args['id'] : null, title: String(entry.args['title'] ?? entry.args['name'] ?? 'a Task') })
        } else if (entry.name === 'react') react(String(entry.args['emoji'] ?? '👍'))
      })
      const result = parseResult(message)
      if (call.name === 'thread_send') sentMessage(call.args, message.id, result)
      const action = routineAction(call.name, call.args)
      const task = taskAction(call.name, call.args)
      const asked = result['proposalId'] ?? result['requestId'] ?? result['askId']
      if (task !== undefined && typeof result['id'] === 'string') {
        put({ kind: 'task', id: message.id, seq: event.seq, at: event.time, action: task, taskId: result['id'], title: String(result['title'] ?? 'a Task') })
      } else if (action !== undefined) {
        const title = String(result['title'] ?? result['name'] ?? call.args['title'] ?? call.args['name'] ?? 'a Task')
        put({ kind: 'task', id: message.id, seq: event.seq, at: event.time, action, taskId: typeof (result['id'] ?? call.args['id']) === 'string' ? String(result['id'] ?? call.args['id']) : null, title })
      } else if (QUESTION_TOOLS.has(call.name) && typeof asked === 'string' && !fold.proposals.includes(asked)) {
        put({ kind: 'proposal', id: message.id, seq: event.seq, at: event.time, proposalId: asked })
        fold = { ...fold, proposals: [...fold.proposals, asked] }
      }
      break
    }
  }
  return fold
}

/** The rows of a whole log at once, in an array (a Subagent's chat, a chapter written before v1.19, the legacy placement of its side rows). */
export interface LegacyChapter {
  readonly events: readonly SessionEvent[]
  /** Notices stored before v1.19: each after the event before its afterSeq. */
  readonly notices: readonly NoticeRow[]
  /** Delegations: each before the first event at or after where it started. */
  readonly delegations: ReadonlyArray<{ readonly id: string; readonly parentSeq: number; readonly startedAt: number }>
  /** Asks of the chapter's time not named by a tool result: each where its time puts it. */
  readonly proposals: ReadonlyArray<{ readonly id: string; readonly createdAt: number }>
}

/**
 * Fold a log with its side rows placed as before v1.19. A part that is not the log's end (final false) leaves the side rows after its
 * last event for the next part.
 */
export function foldLog(chapter: LegacyChapter, input: FoldInput, start: ChatFold = EMPTY_FOLD, rows: ChatRows = arrayRows(), final = true): ChatFold {
  const referenced = new Set(chapter.events.flatMap((event) => {
    if (event.type !== 'tool/result') return []
    const result = parseResult((event.data as unknown as { message?: MessageLike }).message ?? { id: '', content: [] })
    const asked = result['proposalId'] ?? result['requestId'] ?? result['askId']
    return typeof asked === 'string' ? [asked] : []
  }))
  type Side = { key: number; order: number; item: StoredItem }
  const sides: Side[] = [
    ...chapter.notices.map((notice): Side => ({ key: notice.afterSeq + 1, order: 0, item: noticeItem(notice, notice.afterSeq) })),
    ...chapter.delegations.map((row): Side => ({ key: row.parentSeq, order: 1, item: { kind: 'delegation', id: `delegation-${row.id}`, seq: row.parentSeq, at: row.startedAt, subagentId: row.id } })),
  ].sort((a, b) => a.key - b.key || a.order - b.order)
  const asks = chapter.proposals.filter((row) => !referenced.has(row.id) && !start.proposals.includes(row.id)).sort((a, b) => a.createdAt - b.createdAt)
  let fold = start
  let seq = 0
  const flush = (beforeSeq: number, beforeTime: number) => {
    while (sides.length > 0 && sides[0]!.key <= beforeSeq) fold = foldSide(fold, rows, sides.shift()!.item)
    while (asks.length > 0 && asks[0]!.createdAt < beforeTime) {
      const ask = asks.shift()!
      fold = foldSide(fold, rows, { kind: 'proposal', id: `proposal-${ask.id}`, seq, at: ask.createdAt, proposalId: ask.id })
    }
  }
  for (const event of chapter.events) {
    flush(event.seq, event.time)
    seq = event.seq
    fold = foldEvent(fold, event, rows, input)
  }
  if (final) flush(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  return fold
}

/** Rows kept in an array, in position order. */
export function arrayRows(): ChatRows & { readonly all: StoredRow[] } {
  const all: StoredRow[] = []
  return { all, get: (position) => all[position], put: (row) => { all[row.position] = row } }
}

/** What a stored row shows now: an Ask, a Thread or a Subagent read as they are; undefined when it shows nothing any more. */
export interface ResolveInput {
  readonly proposal: (id: string) => ProposalView | undefined
  readonly thread?: (id: string) => ThreadView | undefined
  readonly delegation?: (subagentId: string) => Omit<ItemOf<'delegation'>, 'kind' | 'id' | 'seq' | 'at'> | undefined
}

export function resolveItem(item: StoredItem, input: ResolveInput): ChatItem | undefined {
  switch (item.kind) {
    case 'proposal': {
      const proposal = input.proposal(item.proposalId)
      // An Ask a later one of its kind replaced is not shown (the later one is).
      return proposal === undefined || proposal.status === 'superseded' ? undefined : { kind: 'proposal', id: item.id, seq: item.seq, at: item.at, proposal }
    }
    case 'thread': {
      const thread = input.thread?.(item.threadId)
      return thread === undefined ? { kind: 'notice', id: item.id, seq: item.seq, at: item.at, text: item.text } : { kind: 'thread', id: item.id, seq: item.seq, at: item.at, event: item.event, thread }
    }
    case 'delegation': {
      const card = input.delegation?.(item.subagentId)
      return card === undefined ? undefined : { kind: 'delegation', id: item.id, seq: item.seq, at: item.at, ...card }
    }
    default:
      return item
  }
}

/** A Subagent's own chat, or any log at once: projected, for one work-details level. */
export function projectChat(input: { readonly events: readonly SessionEvent[]; readonly details?: boolean; readonly notices?: readonly NoticeRow[] } & FoldInput & Partial<ResolveInput>): ChatItem[] {
  const rows = arrayRows()
  foldLog({ events: input.events, notices: input.notices ?? [], delegations: [], proposals: [] }, input, EMPTY_FOLD, rows)
  const resolve: ResolveInput = { proposal: input.proposal ?? (() => undefined), ...(input.thread === undefined ? {} : { thread: input.thread }) }
  return rows.all.filter((row) => row.view === 'both' || row.view === (input.details === true ? 'detail' : 'compact')).flatMap((row) => resolveItem(row.item, resolve) ?? [])
}

/** The words of one chat item that has any, for full-text search over the Conversation (cd-ggem). */
export interface ChatText {
  /** The id the chat item has in the Conversation view. */
  readonly id: string
  readonly kind: 'message' | 'reply'
  /** Who said it; null when the Robot itself did (a reply). */
  readonly sender: string | null
  readonly text: string
}

/** The searchable text of a session event, by the same rules the chat view projects it; undefined when the chat shows no words for it. */
export function chatTextOf(event: SessionEvent, assistantRepliesBefore: number): ChatText | undefined {
  const data = event.data as Record<string, unknown>
  const said = sayOf(event)
  if (said !== undefined) return { id: said.id, kind: 'reply', sender: null, text: said.text }
  if (event.type === 'assistant/message') {
    if (event.seq >= assistantRepliesBefore) return undefined
    const message = data['message'] as MessageLike | undefined
    const text = (message?.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('').trim()
    return message === undefined || text.length === 0 ? undefined : { id: message.id, kind: 'reply', sender: null, text }
  }
  if (event.type !== 'user/message') return undefined
  const message = data as unknown as MessageLike
  const source = message.source
  if (source?.['kind'] === 'compact-checkpoint' || !CHAT_SOURCES.has(String(source?.['kind'] ?? 'member'))) return undefined
  const sender = senderOf(source)
  if (sender.kind === 'platform') return undefined
  const text = visibleText(message, sender).trim()
  if (text.length === 0) return undefined
  const label = sender.kind === 'member' || sender.kind === 'robot' ? sender.name
    : sender.kind === 'task' ? `Task ${sender.name}`
      : sender.kind === 'channel' ? `${sender.channel} ${sender.from}` : ''
  return { id: message.id, kind: 'message', sender: label, text }
}

/** Message sources that are people, Robots, Tasks (and the Routines they were before v1.13), Channels or Mr. Robot's platform notes. */
const CHAT_SOURCES = new Set(['member', 'robot', 'routine', 'task', 'channel', 'platform'])

function senderOf(source: Record<string, unknown> | undefined): Sender {
  switch (source?.['kind']) {
    case 'member':
      return { kind: 'member', memberId: String(source['memberId']), name: String(source['name']) }
    case 'robot':
      // A message stored before avatar seeds existed has none: the sender's id is its seed (ux-4fgy).
      return { kind: 'robot', robotId: String(source['robotId']), name: String(source['name']), avatarColor: String(source['avatarColor']), avatarSeed: typeof source['avatarSeed'] === 'string' && source['avatarSeed'] !== '' ? source['avatarSeed'] : String(source['robotId']) }
    // A Routine's Wake-up stored before v1.13 is its Task's (mc-c2bb).
    case 'routine':
      return { kind: 'task', taskId: String(source['routineId']), name: String(source['name']) }
    case 'task':
      return { kind: 'task', taskId: String(source['taskId']), name: String(source['name']) }
    case 'channel':
      return { kind: 'channel', channel: String(source['channel']), from: String(source['from']) }
    case 'platform':
      return { kind: 'platform' }
    default:
      return { kind: 'member', memberId: '', name: '' }
  }
}

/** The text a person wrote, without the label line the model sees. */
/** One shown message per joined follow-up; a message that was not joined is one part. */
function partsOf(message: MessageLike): Array<{ message: MessageLike; clientId?: string; attachments: Attachment[] }> {
  const joined = message.source?.['joined'] as ReadonlyArray<{ clientId?: string; attachments: Attachment[] }> | undefined
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
  const pieces = text.split(JOIN_SEPARATOR)
  if (joined === undefined || joined.length !== pieces.length) {
    const clientId = message.source?.['clientId']
    return [{ message, ...(typeof clientId === 'string' ? { clientId } : {}), attachments: (message.source?.['attachments'] as Attachment[] | undefined) ?? [] }]
  }
  return joined.map((part, index) => ({ message: { ...message, content: [{ type: 'text', text: pieces[index]! }] }, ...(part.clientId === undefined ? {} : { clientId: part.clientId }), attachments: part.attachments }))
}

function visibleText(message: MessageLike, sender: Sender): string {
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
  // A Member's message carries only the time label the model reads; every other source has its label line.
  const body = sender.kind === 'member' ? text.replace(MEMBER_TIME_LABEL, '') : text.replace(/^\[[^\n]*\]\n/, '')
  return body.replace(DISMISSED_TRAILER, '').replace(/\n\nAttached files \(in your workspace\): .*$/s, '')
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
  }
  return (value as Record<string, unknown> | undefined) ?? {}
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text
}

/** What a program's call made, read from its logged result: an id and a title (a Task the program created gets its card's link). */
function madeBy(data: Record<string, unknown>): { made?: { id?: string; title?: string } } {
  if (data['isError'] === true) return {}
  const content = data['content']
  const result = parseResult({ id: '', content: (Array.isArray(content) ? content : typeof content === 'string' ? [{ type: 'text', text: content }] : []) as readonly ContentBlock[] })
  const made = { ...(typeof result['id'] === 'string' ? { id: result['id'] } : {}), ...(typeof result['title'] === 'string' ? { title: result['title'] } : {}) }
  return Object.keys(made).length === 0 ? {} : { made }
}

function parseResult(message: MessageLike): Record<string, unknown> {
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}