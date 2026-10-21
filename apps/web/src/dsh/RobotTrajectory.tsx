/**
 * DSH's Trajectory view over a Robot's session events (ticket 22). The view, its ledger, timeline,
 * inspector and search are DSH's ui-trajectory code (copied in ./trajectory, MIT); the
 * Conversation assembler is DSH's ui-conversation engine (./conversation). This file replaces
 * only DSH's shell: it loads events from the Mr. Robot API and hands the assembled snapshot to the view.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useAtomSet, useAtomValue } from '@effect/atom-react'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { Atom } from 'effect/reactivity'
import type { SessionEventsPage, SubagentView } from '@mr-robot/protocol'
import { AsyncResult } from 'effect/reactivity'
import { apiRuntime, subagentsAtom } from '../client/api-atoms.ts'
import { href } from '../route.ts'
import { describeFailure } from '../client/api-failure.ts'
import { MrRobotApi } from '../client/mr-robot-api.ts'
import { ErrorState } from '../components/States.tsx'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { ConversationNodeAssembler } from './conversation/assembler.ts'
import type { ConversationNodeDefinition, ConversationViewDefinition } from './contract/conversation.ts'
import { inspectRequestPrompt } from './contract/request-inspection.ts'
import { inspectSystemPrompt } from './contract/system-prompt.ts'
import type { Context } from './host-context.ts'
import { en as commonEn } from './common-locale.ts'
import { createTrajectoryDurationStore } from './trajectory/duration-store.ts'
import { createTrajectoryStringWrappingStore } from './trajectory/string-wrapping-store.ts'
import { en as trajectoryEn, type TrajectoryTranslate } from './trajectory/locales.ts'
import { registerTrajectoryAssistantDefinition } from './trajectory/trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from './trajectory/trajectory-compaction-definition.ts'
import type { TrajectorySnapshot } from './trajectory/trajectory-contract.ts'
import type { MessageImageLoader, MessageImageSource } from './contract/slots.ts'
import { registerTrajectoryMessageDefinitions } from './trajectory/trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from './trajectory/trajectory-request-header-definition.ts'
import { EMPTY_TRAJECTORY_SNAPSHOT, registerTrajectoryConversationView } from './trajectory/trajectory-snapshot-builder.ts'
import { registerTrajectoryToolDefinition } from './trajectory/trajectory-tool-definition.ts'
import { TrajectoryView } from './trajectory/TrajectoryView.tsx'
import './theme.css'

const PAGE = 400

// DSH's dark palette is keyed on an attribute of <body>; src/theme/theme.ts sets it with the app theme.

/** The definitions DSH's trajectory plugin registers, collected without a Cordis context. */
function trajectoryDefinitions() {
  const events: ConversationNodeDefinition[] = []
  const views: ConversationViewDefinition[] = []
  const ctx: Context = {
    uiConversation: {
      events: { register: (definition) => { events.push(definition) } },
      views: { register: (definition) => { views.push(definition) } },
      inspectSystemPrompt,
      inspectRequestPrompt,
    },
  }
  registerTrajectoryMessageDefinitions(ctx)
  registerTrajectoryRequestHeaderDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryCompactionDefinitions(ctx)
  registerTrajectoryConversationView(ctx)
  return { events: { entries: () => events, fallbackEntry: () => undefined }, views: { entries: () => views } }
}

interface Paging {
  readonly openState: 'loading' | 'open'
  readonly loadingOlder: boolean
  readonly hasMore: boolean
}

/** What the trajectory page shows for one Robot (fe-r2kx). */
interface TrajectoryState {
  readonly snapshot: TrajectorySnapshot
  readonly paging: Paging
  readonly failure: string | null
}

const INITIAL: TrajectoryState = { snapshot: EMPTY_TRAJECTORY_SNAPSHOT, paging: { openState: 'loading', loadingOlder: false, hasMore: false }, failure: null }

/** The event window of one Robot: DSH's assembler fed page by page, as DSH's session controller feeds ui-conversation. */
class EventWindow {
  readonly assembler: ConversationNodeAssembler
  firstSeq: number | undefined
  lastSeq: number | undefined
  sessionId: string | undefined
  /** Every event loaded, oldest first: an older page rebuilds the window from all of them. */
  events: SessionEventsPage['events'] = []

  constructor() {
    const definitions = trajectoryDefinitions()
    this.assembler = new ConversationNodeAssembler(definitions.events, definitions.views)
  }

  snapshot(): TrajectorySnapshot {
    this.assembler.flush()
    // SAFETY: the 'trajectory' target is registered by registerTrajectoryConversationView, whose builder returns a TrajectorySnapshot.
    return (this.assembler.snapshot('trajectory') as TrajectorySnapshot | undefined) ?? EMPTY_TRAJECTORY_SNAPSHOT
  }
}

/** DSH session events as the assembler takes them; the server sends exactly what the DSH session stored. */
function entries(events: SessionEventsPage['events']): SessionEventLikeEntry[] {
  // SAFETY: each event was written by the worker's DSH session log of the same DSH version; seq and type are checked by the Schema.
  return events.map((event) => ({ type: 'event', event: event as unknown as SessionEvent }))
}

/** One state atom per Robot; the windows they read live as long as the page. */
const windows = new Map<string, EventWindow>()
const windowOf = (robotId: string): EventWindow => {
  let window = windows.get(robotId)
  if (window === undefined) {
    window = new EventWindow()
    windows.set(robotId, window)
  }
  return window
}
const trajectoryStateAtom = Atom.family((_robotId: string) => Atom.make(INITIAL).pipe(Atom.keepAlive))

type Load = {
  readonly robotId: string
  readonly kind: 'open' | 'refresh' | 'older'
  /** A Subagent's own log (ao-ce55). */
  readonly child?: string
  /** A chapter of the Robot's Conversation other than the live one (v1.19, ec-mwvo). */
  readonly chapter?: number
}

/** Whose log a window holds: the Robot's live chapter or another one, or one of its Subagents'. */
const sourceKey = (robotId: string, child?: string, chapter?: number) => (child !== undefined ? `${robotId}|${child}` : chapter !== undefined ? `${robotId}#${chapter}` : robotId)

/** Open the latest page, append newer events (live), or prepend an older page; resolves whether older rows were added. */
const loadEventsAtom = apiRuntime.fn((load: Load, get) => Effect.gen(function* () {
  const api = yield* MrRobotApi
  const key = sourceKey(load.robotId, load.child, load.chapter)
  const state = trajectoryStateAtom(key)
  const window = windowOf(key)
  // Read through the registry: a subscribed read would restart this command each time it updates the state.
  const read = () => get.registry.get(state)
  const write = (next: TrajectoryState) => get.registry.set(state, next)
  const open = Effect.gen(function* () {
    const page = yield* api.events(load.robotId, { limit: PAGE }, load.child, load.chapter)
    window.sessionId = page.sessionId
    window.firstSeq = page.events[0]?.seq
    window.lastSeq = page.events.at(-1)?.seq
    window.events = page.events
    window.assembler.replaceWindow(entries(page.events), page.hasMore)
    window.assembler.activateTarget('trajectory')
    write({ snapshot: window.snapshot(), paging: { openState: 'open', loadingOlder: false, hasMore: page.hasMore }, failure: null })
    return false
  })
  if (load.kind === 'open') return yield* open
  // Nothing loaded yet: the open in flight brings the latest events.
  if (window.lastSeq === undefined) return false
  if (load.kind === 'refresh') {
    const page = yield* api.events(load.robotId, { after: window.lastSeq, limit: 2000 }, load.child, load.chapter)
    // A different session (after a rewind) replaces the whole window.
    if (page.sessionId !== window.sessionId) return yield* open
    window.events = [...window.events, ...page.events]
    for (const entry of entries(page.events)) window.assembler.append(entry)
    window.lastSeq = page.events.at(-1)?.seq ?? window.lastSeq
    if (page.events.length > 0) write({ ...read(), snapshot: window.snapshot() })
    return false
  }
  const current = read()
  if (window.firstSeq === undefined || !current.paging.hasMore) return false
  write({ ...current, paging: { ...current.paging, loadingOlder: true } })
  const page = yield* api.events(load.robotId, { before: window.firstSeq, limit: PAGE }, load.child, load.chapter).pipe(
    Effect.ensuring(Effect.sync(() => { const now = read(); write({ ...now, paging: { ...now.paging, loadingOlder: false } }) })),
  )
  const before = read().snapshot
  // DSH's assembler refuses some prepends (a system message that moves its target); rebuilding the window takes any page.
  window.events = [...page.events, ...window.events]
  window.assembler.replaceWindow(entries(window.events), page.hasMore)
  window.assembler.activateTarget('trajectory')
  window.firstSeq = page.events[0]?.seq ?? window.firstSeq
  const snapshot = window.snapshot()
  const now = read()
  write({ ...now, snapshot, paging: { ...now.paging, hasMore: page.hasMore } })
  return snapshot !== before
}).pipe(Effect.tapError((failure) => Effect.sync(() => {
  const target = trajectoryStateAtom(sourceKey(load.robotId, load.child, load.chapter))
  get.registry.set(target, { ...get.registry.get(target), failure: describeFailure(failure) })
}))), { concurrent: true })

function interpolate(text: string, params?: Record<string, unknown>): string {
  return params === undefined ? text : text.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match))
}

const translate: TrajectoryTranslate = (key, params) => {
  const dictionary = { ...commonEn, ...trajectoryEn } as Record<string, string>
  return interpolate(dictionary[key] ?? key, params)
}

const duration = createTrajectoryDurationStore()
const stringWrapping = createTrajectoryStringWrappingStore()

/** Screenshot images in records load from the Robot's Workspace (robot-cmz9), cached per page. */
function imageLoader(robotId: string) {
  const urls = new Map<string, string>()
  return Object.assign(async (ref: { attachmentId: string }) => {
    const known = urls.get(String(ref.attachmentId))
    if (known !== undefined) return known
    const response = await fetch(`/api/robots/${encodeURIComponent(robotId)}/attachments/${encodeURIComponent(String(ref.attachmentId))}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`image answered ${response.status}`)
    const url = URL.createObjectURL(await response.blob())
    urls.set(String(ref.attachmentId), url)
    return url
  }, { peek: (ref: { attachmentId: string }) => urls.get(String(ref.attachmentId)) })
}

/** The record's images as thumbnails that open full size. */
function RecordImages({ images, loadImage, align }: { images: readonly MessageImageSource[]; loadImage: MessageImageLoader; align: 'start' | 'end' }) {
  return (
    <div className="dsh-record-images" style={{ justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }}>
      {images.map((source, index) => <RecordImage key={index} source={source} loadImage={loadImage} />)}
    </div>
  )
}

function RecordImage({ source, loadImage }: { source: MessageImageSource; loadImage: MessageImageLoader }) {
  const [url, setUrl] = useState<string | undefined>('preview' in source ? source.preview.url : loadImage.peek?.(source.attachment))
  useEffect(() => {
    if (url !== undefined || !('attachment' in source)) return
    void loadImage(source.attachment).then(setUrl).catch(() => undefined)
  }, [loadImage, source, url])
  if (url === undefined) return <span className="dsh-record-image loading" />
  return <a href={url} target="_blank" rel="noreferrer"><img className="dsh-record-image" src={url} alt={'attachment' in source ? (source.attachment.name ?? 'image') : 'image'} /></a>
}

/** The Robot's delegations, one entry each, opening the Subagent's own Trajectory (ao-i3q9). */
export function DelegationList({ robotId }: { robotId: string }) {
  const children = AsyncResult.getOrElse(useAtomValue(subagentsAtom(robotId)), () => [] as readonly SubagentView[])
  if (children.length === 0) return null
  return (
    <details className="dsh-reviews" open>
      <summary>Subagents · {children.length}</summary>
      <ul aria-label="Delegations">
        {children.map((child) => (
          <li key={child.id}>
            <a href={href({ page: 'subagent', id: robotId, child: child.id, tab: 'trajectory' })}>{child.label}</a> · {child.model.model} · {child.status}{child.result === null ? '' : `: ${child.result}`}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** One Auto review decision the session recorded for a call (v1.14, ao-jn6z). */
export interface ReviewRow {
  readonly seq: number
  readonly name: string
  readonly decision: 'allow' | 'deny' | 'failed'
  readonly risk?: string
  readonly reason?: string
  readonly reviewer: string
}

/** The Auto review records among the session's events, in log order. */
export function reviewsOf(events: SessionEventsPage['events']): ReviewRow[] {
  return events.flatMap((event) => {
    if (event.type !== 'plugin:mr-robot/review') return []
    const data = (event as unknown as { data: Record<string, unknown> }).data
    return [{
      seq: event.seq, name: String(data['name'] ?? ''), decision: data['decision'] as ReviewRow['decision'], reviewer: String(data['reviewer'] ?? ''),
      ...(typeof data['risk'] === 'string' ? { risk: data['risk'] } : {}), ...(typeof data['reason'] === 'string' ? { reason: data['reason'] } : {}),
    }]
  })
}

/** The calls Auto review checked, with the decision: allowed, denied into an Ask, or a failed review. */
export function ReviewList({ reviews }: { reviews: readonly ReviewRow[] }) {
  if (reviews.length === 0) return null
  const word = (row: ReviewRow) => (row.decision === 'allow' ? 'allowed' : row.decision === 'deny' ? 'denied, asked the owner' : 'review failed, did not run')
  return (
    <details className="dsh-reviews">
      <summary>Auto review · {reviews.length} {reviews.length === 1 ? 'call' : 'calls'}</summary>
      <ul aria-label="Reviewed calls">
        {reviews.map((row) => (
          <li key={row.seq}><code>{row.name}</code> · {row.risk === undefined ? '' : `${row.risk} risk · `}{word(row)}{row.reason === undefined ? '' : `: ${row.reason}`} <span className="muted">({row.reviewer})</span></li>
        ))}
      </ul>
    </details>
  )
}

/** A memory sweep before an idle compaction (v1.18, rm-hhxa): the daily notes it read and the files it changed. */
export interface SweepRow {
  readonly seq: number
  readonly notes: readonly string[]
  readonly changed: readonly string[]
}

export function sweepsOf(events: SessionEventsPage['events']): SweepRow[] {
  return events.flatMap((event) => {
    if ((event.type as string) !== 'plugin:mr-robot/memory-sweep') return []
    const data = (event as unknown as { data: { notes?: unknown; changed?: unknown } }).data
    const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : [])
    return [{ seq: event.seq, notes: list(data.notes), changed: list(data.changed) }]
  })
}

/** What each memory sweep read and changed; the file history has each change as a version by the sweep. */
export function SweepList({ sweeps }: { sweeps: readonly SweepRow[] }) {
  if (sweeps.length === 0) return null
  return (
    <details className="dsh-reviews">
      <summary>Memory sweeps · {sweeps.length}</summary>
      <ul aria-label="Memory sweeps">
        {sweeps.map((row) => (
          <li key={row.seq}>Read {row.notes.join(', ')}; {row.changed.length === 0 ? 'changed nothing' : `changed ${row.changed.join(', ')}`}.</li>
        ))}
      </ul>
    </details>
  )
}

/** A reply the platform showed in place of a say (v1.15 ticket 02, gb-7jqy): the Turn ended without one, and its last assistant text was shown instead. */
export interface FallbackRow {
  readonly seq: number
  readonly text: string
}

/** The fallback replies among the session's events, in log order. */
export function fallbacksOf(events: SessionEventsPage['events']): FallbackRow[] {
  return events.flatMap((event) => {
    if ((event.type as string) !== 'plugin:mr-robot/say') return []
    const data = (event as unknown as { data: Record<string, unknown> }).data
    return data['fallback'] === true ? [{ seq: event.seq, text: String(data['text'] ?? '') }] : []
  })
}

/** Where the Robot never said it: the platform showed the last assistant text of the Turn as the reply. */
export function FallbackList({ fallbacks }: { fallbacks: readonly FallbackRow[] }) {
  if (fallbacks.length === 0) return null
  return (
    <details className="dsh-reviews">
      <summary>Fallback replies · {fallbacks.length}</summary>
      <ul aria-label="Fallback replies">
        {fallbacks.map((row) => (
          <li key={row.seq}>The Turn ended without a say; its last assistant text was shown as the reply: “{row.text.length > 200 ? `${row.text.slice(0, 200)}…` : row.text}”</li>
        ))}
      </ul>
    </details>
  )
}

export function RobotTrajectory({ robotId, liveVersion, child, chapter }: { robotId: string; liveVersion: number; child?: string; chapter?: number }) {
  const key = sourceKey(robotId, child, chapter)
  const state = useAtomValue(trajectoryStateAtom(key))
  const load = useAtomSet(loadEventsAtom, { mode: 'promiseExit' })
  const loadImage = useMemo(() => imageLoader(robotId) as unknown as MessageImageLoader, [robotId])
  const wantsActual = useSyncExternalStore(duration.subscribe, duration.getSnapshot)
  // The setter's identity is not stable across renders; effects read the latest one through a ref.
  const loadRef = useRef(load)
  loadRef.current = load
  const source = { ...(child === undefined ? {} : { child }), ...(chapter === undefined ? {} : { chapter }) }
  useEffect(() => { void loadRef.current({ robotId, kind: 'open', ...source }) }, [robotId, child, chapter])
  // Every change the Robot announces after the page opened brings the events written since (fe-xp06).
  const openedAt = useRef(liveVersion)
  // A closed chapter does not change; only the live one is read again.
  useEffect(() => { if (liveVersion !== openedAt.current && chapter === undefined) void loadRef.current({ robotId, kind: 'refresh', ...source }) }, [robotId, child, chapter, liveVersion])
  const loadOlder = useCallback(async () => {
    const exit = await loadRef.current({ robotId, kind: 'older', ...source })
    return Exit.isSuccess(exit) && exit.value
  }, [robotId, child, chapter])
  const snapshot = state.snapshot
  const paging = state.paging
  const useTrajectory = useCallback(<S,>(select: (value: TrajectorySnapshot) => S) => select(snapshot), [snapshot])
  const useSession = useCallback(<S,>(select: (value: Paging) => S) => select(paging), [paging])
  const useDuration = useCallback(<S,>(select: (value: boolean) => S) => select(wantsActual), [wantsActual])
  if (state.failure !== null && paging.openState === 'loading') return <ErrorState title="The trajectory cannot be loaded" message={state.failure} onRetry={() => void load({ robotId, kind: 'open', ...source })} />
  return (
    <div className="dsh-trajectory">
      {child === undefined ? <DelegationList robotId={robotId} /> : null}
      <ReviewList reviews={reviewsOf(windowOf(key).events)} />
      <FallbackList fallbacks={fallbacksOf(windowOf(key).events)} />
      <SweepList sweeps={sweepsOf(windowOf(key).events)} />
      <TrajectoryView
        useSession={useSession}
        useTrajectory={useTrajectory}
        useDuration={useDuration}
        viewRequest={null}
        completeViewRequest={() => undefined}
        renderSlot={(_key, owner) => <RecordImages images={owner.images} loadImage={owner.loadImage} align={owner.align} />}
        t={translate}
        jsonStringWrapping={{ getDefault: () => stringWrapping.getSnapshot(), setDefault: (value) => { stringWrapping.set(value) } }}
        loadOlder={loadOlder}
        loadImage={loadImage}
        setActualDuration={(value) => { duration.set(value) }}
      />
    </div>
  )
}