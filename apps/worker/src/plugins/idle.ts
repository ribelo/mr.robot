/**
 * The Idle plugin (v1.14 ticket 09, moved out of robot.ts in v1.20 ticket 00): cache warming and idle compaction, as a duty on the
 * Robot's alarm. When a Turn ends with an empty queue the Robot plans its idle moments (robot/idle.ts); a Wake-up drops the plan.
 * A warming replays the last request for one output token; an idle compaction first runs the memory sweep (v1.18), a bounded
 * platform step, when a daily note changed since the last sweep, then compacts on the warm prefix and closes the chapter. Before the
 * sweep comes the snapshot (v1.20, snapshot.ts) when the chapter has events since the last snapshot or sweep: snapshot, sweep, compaction.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ModelOption } from '@mr-robot/protocol'
import { wakeupMessage } from '../agent/sources.ts'
import { platformStep, type PlatformStepHost } from '../agent/platform-step.ts'
import { CACHE_WARM, warmable } from '../providers/anthropic.ts'
import type { Duty } from '../robot/duties.ts'
import { IDLE_MEMORY_STEPS, idlePlan, idleSettings, memorySweepNote, type IdleStep } from '../robot/idle.ts'
import type { RobotConfig, RobotStore } from '../robot/store.ts'
import type { WorkspaceEntry } from '../workspace/workspace.ts'
import type { FileAuthor } from '../workspace/file-history.ts'
import { eventsSinceMark, filesOnly, MEMORY_STEP_TOOLS, setMemoryMark, SNAPSHOT_NOTE, SNAPSHOT_RECORD, SNAPSHOT_STEPS } from './snapshot.ts'
import { WORKSPACE } from '../robot/workspace-setting.ts'

/** The kv key of the idle plan: the moments left for warming or idle compaction. */
export const IDLE_PLAN = 'idle-plan'
/** The kv key of the request a warming replays. */
const WARM_REQUEST = 'warm-request'
/** The kv key of when the last memory sweep started (v1.18). */
const SWEPT_AT = 'memory-swept-at'
/** The Trajectory's record of a memory sweep (v1.18, rm-hhxa): the daily notes it read and the files it changed. */
export const SWEEP_RECORD = 'plugin:mr-robot/memory-sweep'
/** A warming much later than planned finds the cache gone: it is skipped. */
const IDLE_LATE_MS = 5 * 60_000

/** What the Idle plugin asks of its Robot. */
export interface IdleHost {
  readonly store: RobotStore
  /** The Robot's composition: its agent and the context the step listens on. */
  agent(): Promise<{ readonly agent: Agent; readonly ctx: { readonly tokenMeter: { measure(session: Agent['session']): { totalTokens: number } }; readonly compaction: { compactNow(agent: Agent, signal: AbortSignal): Promise<unknown> } } }>
  readonly step: PlatformStepHost
  /** No Turn runs and none is about to (the drain is not pumping). */
  idleNow(): boolean
  /** Run the work as a Turn of its own: no other Turn starts until it ends (v1.20.1). */
  asTurn<A>(work: () => Promise<A>): Promise<A>
  /** The last model request of the live session, to warm with. */
  lastRequest(): { readonly sessionId: string; readonly options: GenerateOptions } | undefined
  modelList(): Promise<readonly ModelOption[]>
  adapter(provider: string, window: number | undefined, model: string, wire: ModelOption['wire']): LlmAdapter
  recordUsage(source: 'robot', input: number, output: number, cost: number): Promise<void>
  /** The Workspace's files under a directory. */
  list(directory: string): Promise<WorkspaceEntry[]>
  /** Who wrote a Workspace file now, and when. */
  writerOf(path: string, uploaded: number): Promise<{ readonly by: FileAuthor; readonly at: number }>
  isTracked(path: string): boolean
  rollChapter(): Promise<void>
  changed(): Promise<void>
}

/** At a Turn's end with nothing queued: plan the idle moments, and keep the request to warm with. */
export function planIdle(host: IdleHost, config: RobotConfig): void {
  const store = host.store
  if (config.status !== 'active' || store.pendingWakeups() > 0) return store.delete(IDLE_PLAN)
  const plan = idlePlan(config, config.model.provider, Date.now())
  if (plan.length === 0) return store.delete(IDLE_PLAN)
  store.set(IDLE_PLAN, plan)
  const last = host.lastRequest()
  if (plan.some((step) => step.action === 'warm') && last !== undefined && last.sessionId === config.liveSessionId) {
    const { signal: _signal, ...options } = last.options
    store.set(WARM_REQUEST, { provider: config.model.provider, model: config.model.model, effort: config.model.effort, options })
  }
}

/** The alarm's idle duty: the next planned moment, only while no Turn runs and nothing is queued. */
export function idleDuty(host: IdleHost): Duty {
  return {
    name: 'idle',
    order: 90,
    scope: 'active',
    nextAt: () => host.store.get<readonly IdleStep[]>(IDLE_PLAN)?.[0]?.at,
    run: async (now) => {
      const plan = host.store.get<IdleStep[]>(IDLE_PLAN)
      const step = plan?.[0]
      if (plan === undefined || step === undefined || step.at > now || !host.idleNow()) return
      const rest = plan.slice(1)
      if (rest.length === 0) host.store.delete(IDLE_PLAN)
      else host.store.set(IDLE_PLAN, rest)
      if (step.action === 'warm') { if (now - step.at < IDLE_LATE_MS) await warmCache(host) }
      else await idleCompact(host)
    },
  }
}

/** Replay the last request for one output token (ao-jlr0); it is a cache read, billed as the Robot's model cost. */
async function warmCache(host: IdleHost): Promise<void> {
  const config = host.store.requireConfig()
  const saved = host.store.get<{ provider: string; model: string; effort: string; options: GenerateOptions }>(WARM_REQUEST)
  if (saved === undefined || saved.provider !== config.model.provider || saved.model !== config.model.model || !warmable(saved.model, saved.effort)) return
  const chosen = (await host.modelList()).find((option) => option.provider === saved.provider && option.model === saved.model)
  const adapter = host.adapter(saved.provider, chosen?.contextWindow, saved.model, chosen?.wire)
  let usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } | undefined
  for await (const chunk of adapter.stream({ ...saved.options, maxTokens: 1, purpose: CACHE_WARM as never, signal: AbortSignal.timeout(120_000) })) {
    if (chunk.type === 'usage') usage = chunk.usage as typeof usage
  }
  if (usage === undefined) return
  const [input, output, cached] = [usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.cacheReadTokens ?? 0]
  const price = chosen?.price
  await host.recordUsage('robot', input, output, price === undefined ? 0 : ((input - cached) * price.input + cached * (price.cachedInput ?? price.input) + output * price.output) / 1_000_000)
}

/**
 * Compact once while idle, on the warm prefix (ao-f4sp): a context below the floor is left alone (ao-z22f). First the memory sweep,
 * when a daily note changed since the last one (rm-l4t8); a Wake-up during it means the compaction does not happen now.
 */
async function idleCompact(host: IdleHost, floor = true): Promise<void> {
  // A Turn of its own (v1.20.1): Wake-ups that arrive meanwhile queue behind it and run after it, with every tool.
  await host.asTurn(() => idleSequence(host, floor))
}

async function idleSequence(host: IdleHost, floor: boolean): Promise<void> {
  const store = host.store
  const config = store.requireConfig()
  const { agent, ctx } = await host.agent()
  if (floor && ctx.tokenMeter.measure(agent.session).totalTokens < idleSettings(config).idleCompactionFloorTokens) return
  // Files a memory step wrote: the Trajectory names them (rm-hhxa, dm-r6km); each is a version by that step.
  const writtenBy = async (kind: 'sweep' | 'snapshot', since: number) => {
    const changed: string[] = []
    for (const entry of await host.list('')) {
      if (!host.isTracked(entry.path)) continue
      const { by, at } = await host.writerOf(entry.path, entry.uploaded)
      if (by.kind === kind && at >= since) changed.push(entry.path)
    }
    return changed
  }
  if (eventsSinceMark(store, config.liveSessionId, host.step.storedLength())) {
    const started = Date.now()
    const snapshot = await platformStep(agent, host.step, {
      label: 'the snapshot',
      instruction: wakeupMessage({ sender: { kind: 'platform' }, text: SNAPSHOT_NOTE, summary: 'Idle: snapshot before compaction', woke: { at: started, timeZone: config.timeZone } }),
      steps: SNAPSHOT_STEPS,
      tools: MEMORY_STEP_TOOLS,
      args: filesOnly(() => store.get(WORKSPACE) !== undefined),
      author: { kind: 'snapshot' },
      usage: 'memory',
      record: async () => ({ type: SNAPSHOT_RECORD, data: { paths: await writtenBy('snapshot', started) } }),
    })
    // The mark moves only when the snapshot did its work (v1.20.1).
    if (snapshot.ran) setMemoryMark(store, config.liveSessionId, host.step.storedLength())
  }
  const sweptAt = store.get<number>(SWEPT_AT) ?? 0
  const notes = (await host.list('memory')).filter((entry) => /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(entry.path) && entry.uploaded > sweptAt).map((entry) => entry.path).sort()
  if (notes.length > 0) {
    const started = Date.now()
    const sweep = await platformStep(agent, host.step, {
      label: 'the memory sweep',
      instruction: wakeupMessage({ sender: { kind: 'platform' }, text: memorySweepNote(notes), summary: 'Idle: memory sweep before compaction', woke: { at: started, timeZone: config.timeZone } }),
      steps: IDLE_MEMORY_STEPS,
      tools: MEMORY_STEP_TOOLS,
      args: filesOnly(() => store.get(WORKSPACE) !== undefined),
      author: { kind: 'sweep' },
      usage: 'memory',
      record: async () => ({ type: SWEEP_RECORD, data: { notes, changed: await writtenBy('sweep', started) } }),
    })
    // The notes count as swept only when the sweep did its work (v1.20.1): a refused sweep reads them again next time.
    if (sweep.ran) {
      store.set(SWEPT_AT, started)
      setMemoryMark(store, config.liveSessionId, host.step.storedLength())
    }
  }
  if (store.activeTurn() === undefined && store.pendingWakeups() === 0) {
    const startSeq = host.step.storedLength()
    await ctx.compaction.compactNow(agent, AbortSignal.timeout(300_000)).catch((error: unknown) => console.warn('idle compaction did not run', error))
    await host.step.flush()
    await host.step.account(startSeq, 'robot')
  }
  await host.rollChapter().catch((error: unknown) => console.warn('chapter not closed', error))
  await host.changed()
}
/** The kv key of the next dream hour of this Robot (v1.20 ticket 02). */
export const DREAM_CLOSE_AT = 'dream-close-at'
/** The dream hour, in the owner's time zone (the Robot follows the owner's profile). */
export const DREAM_TIME = '03:00'

/**
 * The dream-hour close (dm-76yv): at 03:00 in the Robot's time zone a chapter with events since its last compaction is closed first,
 * by the idle sequence (snapshot, sweep, compaction), whatever its size, so the night starts from a closed day. A Robot busy then closes
 * at its next idle moment of that alarm, or the next night. A Robot with dreaming off has no dream hour.
 */
export function dreamCloseDuty(host: IdleHost & { readonly nextDreamHour: (after: number) => number; readonly eventsSinceCompaction: () => boolean; readonly dreamingOn: () => Promise<boolean> }): Duty {
  return {
    name: 'dream-hour-close',
    order: 95,
    scope: 'active',
    nextAt: (now) => (host.store.config()?.dreaming === false ? undefined : host.store.get<number>(DREAM_CLOSE_AT) ?? host.nextDreamHour(now)),
    run: async (now) => {
      if (host.store.config()?.dreaming === false) return
      const due = host.store.get<number>(DREAM_CLOSE_AT)
      if (due === undefined) return host.store.set(DREAM_CLOSE_AT, host.nextDreamHour(now))
      if (due > now || !host.idleNow()) return
      host.store.set(DREAM_CLOSE_AT, host.nextDreamHour(now))
      // The Space's default counts when the Robot has no setting of its own (v1.20.1, cross-review #4).
      if (!(await host.dreamingOn())) return
      if (!host.eventsSinceCompaction()) return
      // The idle plan is replaced: the chapter closes now.
      host.store.delete(IDLE_PLAN)
      await idleCompact(host, false)
    },
  }
}