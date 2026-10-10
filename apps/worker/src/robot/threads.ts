/**
 * Threads at the chief's side (v1.9): the programs behind Mr. Robot's thread tools, and what the Home
 * tells this chief about a Thread. The Home holds the registry; each chief keeps a copy of the state in its
 * own store, and the messages live in its Conversation like any other (ch-jnet).
 */
import * as Effect from 'effect/Effect'
import type { ThreadEvent, ThreadView } from '@mr-robot/protocol'
import { HOME_ID } from '../env.ts'
import { storedLength } from '../agent/session-log.ts'
import { oneLine } from '../agent/sources.ts'
import { invalid, notFound } from '../platform/durable.ts'
import { deliverOutbox, digest, enqueueOutbox, RobotPlatform, RobotState, THREAD_PAUSE_AT, wake } from './programs.ts'
import type { ThreadCopy } from './store.ts'

const config = Effect.gen(function* () {
  const store = yield* RobotState
  const value = store.config()
  if (value === undefined) return yield* notFound('robot is not initialised')
  return value
})

const failure = (error: unknown) => invalid(error instanceof Error ? error.message : String(error))

const onlyChief = Effect.gen(function* () {
  const current = yield* config
  if (current.kind !== 'mr-robot') return yield* invalid('only Mr. Robot talks in Threads')
  return current
})

const listed = (copy: ThreadCopy) => ({
  threadId: copy.view.id,
  topic: copy.view.topic,
  with: copy.view.other.label,
  state: copy.view.state,
  yourScope: copy.view.scope,
  messages: copy.view.messageCount,
  messagesBeforePause: copy.view.state === 'open' ? Math.max(0, THREAD_PAUSE_AT - copy.windowCount) : 0,
  ...(copy.view.summary === null ? {} : { summary: copy.view.summary }),
  ...(copy.view.closedBy === null ? {} : { endedBy: copy.view.closedBy }),
})

// ------------------------------------------------------------------ the tools

/** The other chiefs of the Home (ch-c2xa). */
export const chiefs = Effect.gen(function* () {
  const current = yield* onlyChief
  const platform = yield* RobotPlatform
  const found = yield* Effect.tryPromise({ try: async () => platform.env.HOME.getByName(HOME_ID).threadChiefs(current.ownerId), catch: failure })
  return found.map((chief) => ({ id: chief.id, ownerName: chief.ownerName, name: chief.name, availability: chief.availability }))
})

/** Invite another chief to a Thread; both owners are asked before anything opens (ch-l4jg). */
export const open = (chiefId: string, topic: string, scope: string) => Effect.gen(function* () {
  const current = yield* onlyChief
  const platform = yield* RobotPlatform
  if (topic.trim() === '') return yield* invalid('A Thread needs a topic')
  const opened = yield* Effect.tryPromise({ try: () => platform.env.HOME.getByName(HOME_ID).threadOpen(current.id, topic.trim(), chiefId, scope), catch: failure })
  return { threadId: opened.threadId, status: 'invited; your owner and the other owner each answer an invitation, and the Thread opens only when both accept. You are told when it opens or is declined.' }
})

/** Send a message in an open Thread through the Robot message outbox (ch-jnet); the 21st is refused until the owner agrees to go on (ch-408z). */
export const send = (threadId: string, text: string, idempotencyKey: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* onlyChief
  const copy = store.thread(threadId)
  if (copy === undefined) return yield* notFound(`No Thread ${threadId}; see thread_list`)
  const id = `thr-${yield* Effect.promise(() => digest(`${current.id}:${threadId}:${idempotencyKey}`))}`
  const existing = store.sql.exec<{ status: string }>('SELECT status FROM outbox WHERE id = ?', id).toArray()[0]
  if (existing !== undefined) return { sent: true, threadId, status: existing.status === 'failed' ? 'failed earlier' : 'already sent' }
  if (copy.view.state !== 'open') return yield* invalid(copy.view.state === 'invited' ? 'This Thread is not open yet: both owners must accept first.' : `This Thread is ${copy.view.state}.`)
  if (copy.windowCount >= THREAD_PAUSE_AT) {
    const now = Date.now()
    const asked = store.proposals('open').some((row) => row.kind === 'thread' && row.thread?.id === threadId && row.thread.phase === 'continue')
    if (!asked) {
      store.propose('thread', `Go on with the Thread about "${copy.view.topic}" with ${copy.view.other.label}? ${copy.view.messageCount} messages so far.`,
        { thread: { id: threadId, phase: 'continue', topic: copy.view.topic, other: copy.view.other.label, scope: copy.view.scope } }, now, (row) => row.thread?.id === threadId && row.thread.phase === 'continue')
      yield* platform.changed()
      yield* platform.notifyMembers('needs you', `${copy.view.other.label}: ${THREAD_PAUSE_AT} messages in the Thread "${copy.view.topic}"; waiting for your answer on whether to go on.`)
    }
    return yield* invalid(`Report to your owner first: this Thread has had ${THREAD_PAUSE_AT} messages. Tell them where it stands in your reply; a question whether to go on is waiting for them. You may send again when they approve.`)
  }
  yield* Effect.tryPromise({ try: () => platform.env.HOME.getByName(HOME_ID).threadMessage(threadId, current.id), catch: failure })
  const masked = yield* platform.mask(text)
  yield* enqueueOutbox(copy.view.other.robotId, {
    id, kind: 'thread', threadId, text: masked, requestId: id, chain: { id: threadId, hops: 0 },
    from: { robotId: current.id, ownerId: current.ownerId, name: copy.view.self.label, avatarColor: copy.view.self.avatarColor },
  })
  const sent = store.threadMessage(threadId, Date.now())!
  yield* platform.background(deliverOutbox)
  yield* platform.changed()
  return {
    sent: true, threadId, topic: sent.view.topic, with: sent.view.other.label, yourScope: sent.view.scope,
    messages: sent.view.messageCount, messagesBeforePause: Math.max(0, THREAD_PAUSE_AT - sent.windowCount),
  }
})

/** Close a Thread with a summary both chiefs receive (ch-rlnd). */
export const close = (threadId: string, summary: string) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* onlyChief
  if (store.thread(threadId) === undefined) return yield* notFound(`No Thread ${threadId}; see thread_list`)
  yield* Effect.tryPromise({ try: () => platform.env.HOME.getByName(HOME_ID).threadClose(threadId, current.id, summary), catch: failure })
  return { closed: true, threadId, status: 'closed; the other chief received your summary' }
})

/** Mr. Robot's Threads with the scope, the count and the state (ch-6ymu). */
export const list = Effect.gen(function* () {
  const store = yield* RobotState
  yield* onlyChief
  return { threads: store.threads().map(listed) }
})

// ------------------------------------------------------------------ what the Home tells this chief

/** An invitation reaches this chief's owner as an Ask with the topic and a scope to edit (ch-vrl7, ch-hikl). */
export const invitation = (view: ThreadView, phase: 'invitation-out' | 'invitation-in') => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const now = Date.now()
  store.saveThread(view, now)
  const purpose = phase === 'invitation-out' ? `Open a Thread with ${view.other.label} about "${view.topic}"` : `${view.other.label} wants to talk about "${view.topic}"`
  store.propose('thread', purpose, { thread: { id: view.id, phase, topic: view.topic, other: view.other.label, scope: phase === 'invitation-out' ? view.scope : '' } }, now, (row) => row.thread?.id === view.id)
  yield* platform.changed()
  yield* platform.notifyMembers('needs you', `${purpose}: waiting for your answer.`)
})

const noteOf = (view: ThreadView, event: ThreadEvent): string => {
  switch (event) {
    case 'opened': return `Thread opened with ${view.other.label}: "${view.topic}"`
    case 'declined': return `Thread declined: "${view.topic}" with ${view.other.label}`
    case 'closed': return `Thread closed: "${view.topic}" with ${view.other.label}`
    case 'idle': return `Thread closed after 7 days without a message: "${view.topic}" with ${view.other.label}`
    case 'expired': return `Thread invitation expired after 7 days without both answers: "${view.topic}" with ${view.other.label}`
    case 'gone': return `Thread ended: ${view.other.label} is no longer in the Home ("${view.topic}")`
  }
}

const wakeText = (view: ThreadView, event: ThreadEvent): string => {
  switch (event) {
    case 'opened': return [
      `Thread opened with ${view.other.label} about "${view.topic}". Both owners accepted.`,
      `Your owner's scope for this Thread (use and disclose only this): ${view.scope.trim() === '' ? '(nothing; your owner named nothing you may use)' : oneLine(view.scope)}`,
      'If you started the Thread, send the first message with thread_send; otherwise wait for theirs.',
    ].join('\n')
    case 'declined': return `${view.other.label} declined the Thread about "${view.topic}". No reason is given. The Thread is over.`
    case 'closed': return `${view.other.label} closed the Thread about "${view.topic}". Their summary:\n${view.summary ?? ''}`
    case 'idle': case 'expired': case 'gone': return `${noteOf(view, event)}. The Thread is over.`
  }
}

/**
 * The Thread opened, ended, lapsed or lost its other chief (ch-fri7, ch-0cn1, ch-rlnd, ch-gckb): this chief's copy follows,
 * the Conversation gets a card, and the chief is woken when it has to act.
 */
export const changed = (view: ThreadView, event: ThreadEvent, wakeChief: boolean) => Effect.gen(function* () {
  const store = yield* RobotState
  const platform = yield* RobotPlatform
  const current = yield* config
  const now = Date.now()
  store.saveThread(view, now)
  if (event !== 'opened') {
    // Asks about a Thread that is over have no answer left to give.
    for (const row of store.proposals('open')) if (row.kind === 'thread' && row.thread?.id === view.id) store.closeProposal(row.id, now)
  }
  store.addNotice(current.liveSessionId, storedLength(store.sql, current.liveSessionId), noteOf(view, event), now, { kind: 'thread', threadId: view.id, event })
  yield* platform.changed()
  if (event === 'opened') yield* platform.notifyMembers('finished', noteOf(view, event))
  if (wakeChief) yield* wake({ kind: 'platform', sender: { kind: 'platform' }, text: wakeText(view, event), payload: { summary: '', thread: { id: view.id } } })
})

