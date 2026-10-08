/**
 * DSH's Trajectory view over a Robot's session events (ticket 22). The view, its ledger, timeline,
 * inspector and search are DSH's ui-trajectory code (copied in ./trajectory, MIT); the
 * Conversation assembler is DSH's ui-conversation engine (./conversation). This file replaces
 * only DSH's shell: it loads events from the Mr. Robot API and hands the assembled snapshot to the view.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAtomSet, useAtomValue } from '@effect/atom-react'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { Atom } from 'effect/reactivity'
import type { SessionEventsPage } from '@mr-robot/protocol'
import { apiRuntime } from '../client/api-atoms.ts'
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

// DSH's dark palette is keyed on this attribute; Mr. Robot is always dark.
if (typeof document !== 'undefined') document.body.setAttribute('data-ds-dark-theme', '')

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

type Load = { readonly robotId: string; readonly kind: 'open' | 'refresh' | 'older' }

/** Open the latest page, append newer events (live), or prepend an older page; resolves whether older rows were added. */
const loadEventsAtom = apiRuntime.fn((load: Load, get) => Effect.gen(function* () {
  const api = yield* MrRobotApi
  const state = trajectoryStateAtom(load.robotId)
  const window = windowOf(load.robotId)
  const open = Effect.gen(function* () {
    const page = yield* api.events(load.robotId, { limit: PAGE })
    window.sessionId = page.sessionId
    window.firstSeq = page.events[0]?.seq
    window.lastSeq = page.events.at(-1)?.seq
    window.assembler.replaceWindow(entries(page.events), page.hasMore)
    window.assembler.activateTarget('trajectory')
    get.set(state, { snapshot: window.snapshot(), paging: { openState: 'open', loadingOlder: false, hasMore: page.hasMore }, failure: null })
    return false
  })
  if (load.kind === 'open' || window.lastSeq === undefined) return yield* open
  if (load.kind === 'refresh') {
    const page = yield* api.events(load.robotId, { after: window.lastSeq, limit: 2000 })
    // A different session (after a rewind) replaces the whole window.
    if (page.sessionId !== window.sessionId) return yield* open
    for (const entry of entries(page.events)) window.assembler.append(entry)
    window.lastSeq = page.events.at(-1)?.seq ?? window.lastSeq
    if (page.events.length > 0) get.set(state, { ...get(state), snapshot: window.snapshot() })
    return false
  }
  const current = get(state)
  if (window.firstSeq === undefined || !current.paging.hasMore) return false
  get.set(state, { ...current, paging: { ...current.paging, loadingOlder: true } })
  const page = yield* api.events(load.robotId, { before: window.firstSeq, limit: PAGE }).pipe(
    Effect.ensuring(Effect.sync(() => { const now = get(state); get.set(state, { ...now, paging: { ...now.paging, loadingOlder: false } }) })),
  )
  const before = get(state).snapshot
  window.assembler.prepend(entries(page.events), page.hasMore)
  window.firstSeq = page.events[0]?.seq ?? window.firstSeq
  const snapshot = window.snapshot()
  const now = get(state)
  get.set(state, { ...now, snapshot, paging: { ...now.paging, hasMore: page.hasMore } })
  return snapshot !== before
}).pipe(Effect.tapError((failure) => Effect.sync(() => {
  const now = get(trajectoryStateAtom(load.robotId))
  get.set(trajectoryStateAtom(load.robotId), { ...now, failure: describeFailure(failure) })
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

export function RobotTrajectory({ robotId, liveVersion }: { robotId: string; liveVersion: number }) {
  const state = useAtomValue(trajectoryStateAtom(robotId))
  const load = useAtomSet(loadEventsAtom, { mode: 'promiseExit' })
  const loadImage = useMemo(() => imageLoader(robotId) as unknown as MessageImageLoader, [robotId])
  const wantsActual = useSyncExternalStore(duration.subscribe, duration.getSnapshot)
  useEffect(() => { void load({ robotId, kind: 'open' }) }, [load, robotId])
  // Every change the Robot announces brings the events written since (fe-xp06).
  useEffect(() => { if (liveVersion > 0) void load({ robotId, kind: 'refresh' }) }, [load, robotId, liveVersion])
  const loadOlder = useCallback(async () => {
    const exit = await load({ robotId, kind: 'older' })
    return Exit.isSuccess(exit) && exit.value
  }, [load, robotId])
  const snapshot = state.snapshot
  const paging = state.paging
  const useTrajectory = useCallback(<S,>(select: (value: TrajectorySnapshot) => S) => select(snapshot), [snapshot])
  const useSession = useCallback(<S,>(select: (value: Paging) => S) => select(paging), [paging])
  const useDuration = useCallback(<S,>(select: (value: boolean) => S) => select(wantsActual), [wantsActual])
  if (state.failure !== null && paging.openState === 'loading') return <ErrorState title="The trajectory cannot be loaded" message={state.failure} onRetry={() => void load({ robotId, kind: 'open' })} />
  return (
    <div className="dsh-trajectory">
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
