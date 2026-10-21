/**
 * One bounded platform step (v1.20 ticket 00, docs/adr/0003-duties-and-platform-steps.md): the platform, not a person, gives the
 * Robot's agent an instruction to act on now, outside any Wake-up of a person: the memory steps before a compaction, and later the dream.
 * The step runs on the Robot's own agent (its model and warm cache), may use only the tools it allows, ends after a number of model
 * steps, writes its files under its own author, and leaves a record in the Trajectory. Every such step goes through this one function.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { appendPluginRecord, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { UsageSource } from '@mr-robot/protocol'
import type { FileAuthor } from '../workspace/file-history.ts'

/** The tools a platform step may call: every other one fails with a plain reason while it runs. */
export class StepFence {
  private allowed: ReadonlySet<string> | undefined
  private label = ''

  /** While a step runs: the tool names it allows. */
  open(label: string, tools: ReadonlySet<string>): void {
    this.label = label
    this.allowed = tools
  }

  close(): void {
    this.allowed = undefined
  }

  /** Throws when a step runs and this tool is not one it allows. */
  check(tool: string): void {
    if (this.allowed !== undefined && !this.allowed.has(tool)) throw new Error(`${tool} is not available during ${this.label}; use only ${[...this.allowed].join(', ') || 'no tool'}.`)
  }
}

export interface PlatformStepHost {
  readonly fence: StepFence
  /** The author of the Workspace writes while the step runs, then back to the Robot (file history). */
  writeAs(author: FileAuthor | undefined): void
  /** Listen to the agent's session events; the returned function stops listening. */
  onEvent(listener: (session: Session, event: SessionEvent) => void): () => void
  /** Stored events of the live session from a seq on are booked under a usage source. */
  account(startSeq: number, source: UsageSource): Promise<void>
  /** The length of the agent's stored log now. */
  storedLength(): number
  flush(): Promise<void>
}

export interface PlatformStep {
  /** What the Trajectory and the errors call it: "the memory sweep". */
  readonly label: string
  readonly instruction: UserMessage
  /** Model steps at most. */
  readonly steps: number
  /** The tools it may call; undefined: the Robot's tools as in a Turn. */
  readonly tools?: ReadonlySet<string>
  /** Who its Workspace writes are by; undefined: the Robot. */
  readonly author?: FileAuthor
  /** The usage source it is booked under; undefined: the Turn it runs in books it. */
  readonly usage?: UsageSource
  /** The Trajectory's record of it, written after it ran: its type and data. */
  readonly record?: (startSeq: number) => Promise<{ readonly type: string; readonly data: Record<string, unknown> } | undefined>
}

/** Run one platform step on the agent and wait for it to end; returns the seq it started at. */
export async function platformStep(agent: Agent, host: PlatformStepHost, step: PlatformStep): Promise<number> {
  const startSeq = host.storedLength()
  let steps = 0
  const stop = host.onEvent((session, event) => {
    if (session === agent.session && event.type === 'step/start' && ++steps >= step.steps) agent.cancel({ kind: 'user' }, { keepInbox: true })
  })
  if (step.tools !== undefined) host.fence.open(step.label, step.tools)
  host.writeAs(step.author)
  try {
    agent.followup(step.instruction)
    await agent.whenIdle()
  } finally {
    stop()
    host.fence.close()
    host.writeAs(undefined)
  }
  const record = await step.record?.(startSeq)
  if (record !== undefined) appendPluginRecord(agent.session, record.type as never, record.data as never)
  await host.flush()
  if (step.usage !== undefined) await host.account(startSeq, step.usage)
  return startSeq
}