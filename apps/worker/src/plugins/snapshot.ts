/**
 * The snapshot (v1.20 ticket 01, dm-kg1p, dm-77dg, dm-tjlb, dm-r6km, dm-pifl): one bounded memory step before every compaction, in a
 * Turn or idle. Its contract is in docs/memory-and-files.md (the product doc) and here:
 *
 * - Trigger: in a Turn, DSH's decision that pressure compacts now (compaction.ts asks before it summarises; the compaction is put off
 *   while the snapshot runs, and an overflow is never put off; not inside another platform step; once per compaction); idle, before the memory sweep of an idle compaction.
 * - Instruction: SNAPSHOT_NOTE (idle) or SNAPSHOT_NOTE_IN_TURN, which goes on with the Turn's work instead of ending it.
 * - Step limit: 3 model steps. Tools: the file tools on the Workspace only.
 * - Skip: no event in the chapter since the last snapshot or sweep (the memory mark).
 * - Record: plugin:mr-robot/snapshot with the paths it wrote; file versions by the author snapshot; usage under the source memory.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { wakeupMessage } from '../agent/sources.ts'
import { stepRan, type PlatformStepHost } from '../agent/platform-step.ts'
import type { RobotStore } from '../robot/store.ts'

export const SNAPSHOT_RECORD = 'plugin:mr-robot/snapshot'
export const SNAPSHOT_STEPS = 3
/** The file tools a memory step may use; with on, only the Workspace. */
export const MEMORY_STEP_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit', 'glob', 'grep'])
export const SNAPSHOT_NOTE = 'Compaction is about to replace your context with a summary. Write to your daily note what is in flight (what you are doing, what remains, what you decided) and to MEMORY.md what lasts. Do not reply to the owner. Then end.'
export const SNAPSHOT_NOTE_IN_TURN = 'Compaction is about to replace your context with a summary. Write to your daily note what is in flight (what you are doing, what remains, what you decided) and to MEMORY.md what lasts. Do not reply to the owner. You have 3 steps for it; then go on with your work.'

/** The kv key of the last snapshot or sweep: the session and its stored length then. */
export const MEMORY_MARK = 'memory-mark'
/** The kv key of the session whose snapshot ran and whose compaction has not yet: that compaction is not put off again. */
const SNAPSHOT_TAKEN = 'snapshot-taken'
/** The kv key of the event ranges a Turn's accounting books under memory (an in-Turn snapshot). */
export const MEMORY_RANGES = 'memory-ranges'

export interface MemoryRange {
  readonly sessionId: string
  /** Inclusive first seq, exclusive last. */
  readonly from: number
  readonly to: number
}

/** Something happened in the chapter since the last snapshot or sweep (dm-tjlb). */
export function eventsSinceMark(store: RobotStore, sessionId: string, length: number): boolean {
  const mark = store.get<{ sessionId: string; seq: number }>(MEMORY_MARK)
  return mark === undefined || mark.sessionId !== sessionId || length > mark.seq
}

export function setMemoryMark(store: RobotStore, sessionId: string, seq: number): void {
  store.set(MEMORY_MARK, { sessionId, seq })
}

/** A file tool's call is refused on any place but the Workspace. */
export function workspaceOnly(_name: string, args: Readonly<Record<string, unknown>>): string | undefined {
  return args['on'] === undefined || args['on'] === 'workspace' ? undefined : 'a memory step writes only on the Workspace (on: "workspace")'
}

export interface SnapshotHost {
  readonly store: RobotStore
  readonly step: PlatformStepHost
  liveSessionId(): string
  timeZone(): string
  /** The Workspace files the snapshot wrote since a moment (by their author in the file history). */
  writtenSince(started: number): Promise<string[]>
  background(work: Promise<unknown>): void
}

/**
 * The snapshot of a Turn: started when pressure would compact, ended after its steps or with the Turn (v1.20.1: fenced for exactly its
 * steps). The steer is placed at a compaction boundary and reaches the model at the next step, so the step after the boundary is still the
 * person's and runs with every tool; the fence holds from the next boundary for SNAPSHOT_STEPS steps, then the compaction runs.
 */
export class TurnSnapshot {
  private running: { agent: Agent; startSeq: number; started: number; boundaries: number; token: symbol | undefined } | undefined

  constructor(private readonly host: SnapshotHost) {}

  /** Asked by compaction.ts: true puts this pressure compaction off. */
  beforeCompaction(agent: Agent): boolean {
    const host = this.host
    if (String(agent.session.id) !== host.liveSessionId()) return false
    const running = this.running
    if (running !== undefined) {
      running.boundaries += 1
      if (running.boundaries === 1) {
        // The steer is claimed by the step that starts now: the snapshot's steps begin, and its fence with them.
        running.token = host.step.fence.open('the snapshot', MEMORY_STEP_TOOLS, workspaceOnly)
        host.step.writeAs({ kind: 'snapshot' })
        return true
      }
      if (running.boundaries <= SNAPSHOT_STEPS) return true
      this.finish(true)
      return false
    }
    // Inside a platform step (the safety net, the dream, an idle step) the compaction goes ahead: that step has its own instruction and tools.
    if (host.step.fence.inStep() || host.step.fence.isHeld()) return false
    // One snapshot before each compaction: once it ran, the compaction it was for goes ahead.
    if (host.store.get<string>(SNAPSHOT_TAKEN) === host.liveSessionId()) return false
    const length = host.step.storedLength()
    if (!eventsSinceMark(host.store, host.liveSessionId(), length)) return false
    const started = Date.now()
    this.running = { agent, startSeq: length, started, boundaries: 0, token: undefined }
    agent.steer(wakeupMessage({ sender: { kind: 'platform' }, text: SNAPSHOT_NOTE_IN_TURN, summary: 'Snapshot before compaction', woke: { at: started, timeZone: host.timeZone() } }))
    return true
  }

  /** A compaction ran: the next one gets its own snapshot. */
  compacted(): void {
    this.host.store.delete(SNAPSHOT_TAKEN)
  }

  /**
   * The snapshot's steps are over (atBoundary: its compaction runs now), or its Turn ended: the fence lifts and its usage is booked under
   * memory. The memory mark moves only when it did its work; it counts as the compaction's snapshot only when the compaction follows, so a
   * Turn that ends first leaves the next compaction its own snapshot (v1.20.1).
   */
  finish(atBoundary = false): void {
    const running = this.running
    if (running === undefined) return
    this.running = undefined
    const host = this.host
    const tally = host.step.fence.close(running.token)
    if (running.token !== undefined) host.step.writeAs(undefined)
    const sessionId = String(running.agent.session.id)
    const to = host.step.storedLength()
    if (running.token !== undefined) host.store.set(MEMORY_RANGES, [...(host.store.get<MemoryRange[]>(MEMORY_RANGES) ?? []), { sessionId, from: running.startSeq, to }])
    if (stepRan(tally, false)) setMemoryMark(host.store, sessionId, to)
    if (atBoundary) host.store.set(SNAPSHOT_TAKEN, sessionId)
    if (running.token !== undefined) host.background(host.writtenSince(running.started).then((paths) => appendPluginRecord(running.agent.session, SNAPSHOT_RECORD as never, { paths } as never)))
  }
}
