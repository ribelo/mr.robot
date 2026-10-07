/**
 * DSH's Trajectory view over a Robot's session events (ticket 22). The view, its ledger, timeline,
 * inspector and search are DSH's ui-trajectory code (copied in ./trajectory, MIT); the
 * Conversation assembler is DSH's ui-conversation engine (./conversation). This file replaces
 * only DSH's shell: it loads events from the Mr. Robot API and hands the assembled snapshot to the view.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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

/** One Robot's event window, assembled the way DSH's session controller feeds ui-conversation. */
export class TrajectoryFeed {
  private readonly assembler: ConversationNodeAssembler
  private readonly listeners = new Set<() => void>()
  private snapshot: TrajectorySnapshot = EMPTY_TRAJECTORY_SNAPSHOT
  paging: Paging = { openState: 'loading', loadingOlder: false, hasMore: false }
  private firstSeq: number | undefined
  private lastSeq: number | undefined
  private sessionId: string | undefined

  constructor(private readonly robotId: string) {
    const definitions = trajectoryDefinitions()
    this.assembler = new ConversationNodeAssembler(definitions.events, definitions.views)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.snapshot
  getPaging = () => this.paging

  private async fetch(query: string): Promise<{ sessionId: string; hasMore: boolean; events: SessionEvent[] }> {
    const response = await fetch(`/api/robots/${encodeURIComponent(this.robotId)}/events?${query}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`events answered ${response.status}`)
    return response.json() as Promise<{ sessionId: string; hasMore: boolean; events: SessionEvent[] }>
  }

  private entries(events: readonly SessionEvent[]): SessionEventLikeEntry[] {
    return events.map((event) => ({ type: 'event', event }))
  }

  private publish(): void {
    this.assembler.flush()
    this.snapshot = (this.assembler.snapshot('trajectory') as TrajectorySnapshot | undefined) ?? EMPTY_TRAJECTORY_SNAPSHOT
    for (const listener of this.listeners) listener()
  }

  private setPaging(change: Partial<Paging>): void {
    this.paging = { ...this.paging, ...change }
    for (const listener of this.listeners) listener()
  }

  /** The latest page; a different session (after a rewind) replaces the whole window. */
  async open(): Promise<void> {
    const page = await this.fetch(`limit=${PAGE}`)
    this.sessionId = page.sessionId
    this.firstSeq = page.events[0]?.seq
    this.lastSeq = page.events.at(-1)?.seq
    this.assembler.replaceWindow(this.entries(page.events), page.hasMore)
    this.assembler.activateTarget('trajectory')
    this.paging = { openState: 'open', loadingOlder: false, hasMore: page.hasMore }
    this.publish()
  }

  /** New events since the last one seen (live updates). */
  async refresh(): Promise<void> {
    if (this.lastSeq === undefined) return this.open()
    const page = await this.fetch(`after=${this.lastSeq}&limit=2000`)
    if (page.sessionId !== this.sessionId) return this.open()
    for (const entry of this.entries(page.events)) this.assembler.append(entry)
    this.lastSeq = page.events.at(-1)?.seq ?? this.lastSeq
    if (page.events.length > 0) this.publish()
  }

  loadOlder = async (): Promise<boolean> => {
    if (this.firstSeq === undefined || !this.paging.hasMore) return false
    this.setPaging({ loadingOlder: true })
    try {
      const page = await this.fetch(`before=${this.firstSeq}&limit=${PAGE}`)
      const before = this.snapshot
      this.assembler.prepend(this.entries(page.events), page.hasMore)
      this.firstSeq = page.events[0]?.seq ?? this.firstSeq
      this.paging = { ...this.paging, hasMore: page.hasMore }
      this.publish()
      return this.snapshot !== before
    } finally {
      this.setPaging({ loadingOlder: false })
    }
  }
}

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
  const feed = useMemo(() => new TrajectoryFeed(robotId), [robotId])
  const loadImage = useMemo(() => imageLoader(robotId) as unknown as MessageImageLoader, [robotId])
  const [error, setError] = useState<string>()
  useEffect(() => { feed.open().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))) }, [feed])
  useEffect(() => { if (liveVersion > 0) void feed.refresh().catch(() => undefined) }, [feed, liveVersion])
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot)
  const paging = useSyncExternalStore(feed.subscribe, feed.getPaging)
  const wantsActual = useSyncExternalStore(duration.subscribe, duration.getSnapshot)
  const useTrajectory = useCallback(<S,>(select: (value: TrajectorySnapshot) => S) => select(snapshot), [snapshot])
  const useSession = useCallback(<S,>(select: (value: Paging) => S) => select(paging), [paging])
  const useDuration = useCallback(<S,>(select: (value: boolean) => S) => select(wantsActual), [wantsActual])
  if (error !== undefined) return <div className="muted">Could not load the trajectory: {error}</div>
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
        loadOlder={feed.loadOlder}
        loadImage={loadImage}
        setActualDuration={(value) => { duration.set(value) }}
      />
    </div>
  )
}
