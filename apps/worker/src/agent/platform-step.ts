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

type ArgsCheck = (tool: string, args: Readonly<Record<string, unknown>>) => string | undefined

/** The tools that are never fenced: run_code only carries a program; the calls it makes are what a fence judges (v1.20.1). */
const TRANSPARENT = new Set(['run_code'])

/** What a fence saw while one owner held it. */
export interface FenceTally {
  /** Calls it let run. */
  readonly allowed: number
  /** Calls it refused. */
  readonly refused: number
}

/**
 * The tools a platform step may call (v1.20, made owned in v1.20.1): every other one fails with a plain reason while it is held. One owner
 * holds it at a time; only the owner's token closes it, so a step inside another (a snapshot in a dream) cannot lift the outer fence.
 */
export class StepFence {
  private held: { readonly token: symbol; readonly label: string; readonly allowed: ReadonlySet<string>; readonly argsCheck: ArgsCheck | undefined; allowedCalls: number; refusedCalls: number } | undefined
  private steps = 0

  /** A platform step runs now (with or without an allow-list). */
  inStep(): boolean {
    return this.steps > 0
  }

  enter(): void {
    this.steps += 1
  }

  leave(): void {
    this.steps = Math.max(0, this.steps - 1)
  }

  /** Someone holds the fence now. */
  isHeld(): boolean {
    return this.held !== undefined
  }

  /** Hold the fence: these tools only, and a check of their arguments. Undefined when another owner holds it already. */
  open(label: string, tools: ReadonlySet<string>, argsCheck?: ArgsCheck): symbol | undefined {
    if (this.held !== undefined) return undefined
    const token = Symbol(label)
    this.held = { token, label, allowed: tools, argsCheck, allowedCalls: 0, refusedCalls: 0 }
    return token
  }

  /** Lift the fence, by its owner only; returns what it saw. */
  close(token: symbol | undefined): FenceTally {
    if (token === undefined || this.held?.token !== token) return { allowed: 0, refused: 0 }
    const tally = { allowed: this.held.allowedCalls, refused: this.held.refusedCalls }
    this.held = undefined
    return tally
  }

  /** Why this call may not run now: a step holds the fence and does not allow it; undefined when it may. */
  refusal(tool: string, args: Readonly<Record<string, unknown>> = {}): string | undefined {
    const held = this.held
    if (held === undefined || TRANSPARENT.has(tool)) return undefined
    const refused = !held.allowed.has(tool)
      ? `${tool} is not available during ${held.label}; use only ${[...held.allowed].join(', ') || 'no tool'}.`
      : (() => {
          const reason = held.argsCheck?.(tool, args)
          return reason === undefined ? undefined : `${tool} during ${held.label}: ${reason}.`
        })()
    if (refused === undefined) held.allowedCalls += 1
    else held.refusedCalls += 1
    return refused
  }
}

/** Whether a step did its work: it ran at least one allowed tool, or the model ended it with nothing refused. Marks advance only then. */
export function stepRan(tally: FenceTally, endedByModel: boolean): boolean {
  return tally.allowed > 0 || (endedByModel && tally.refused === 0)
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
  /** A check of an allowed tool's arguments (the Workspace only, for example). */
  readonly args?: ArgsCheck
  /** Who its Workspace writes are by; undefined: the Robot. */
  readonly author?: FileAuthor
  /** The usage source it is booked under; undefined: the Turn it runs in books it. */
  readonly usage?: UsageSource
  /** The Trajectory's record of it, written after it ran: its type and data. */
  readonly record?: (startSeq: number) => Promise<{ readonly type: string; readonly data: Record<string, unknown> } | undefined>
}

/** What a step did: where it started, what its fence saw, and whether the model ended it (not the step limit). */
export interface StepOutcome {
  readonly startSeq: number
  readonly tally: FenceTally
  readonly endedByModel: boolean
  /** It did its work (stepRan). */
  readonly ran: boolean
}

/**
 * Run one platform step on the agent and wait for it to end. The step limit lets exactly `steps` model steps run: the agent is cancelled
 * at the start of the one after (v1.20.1; it was one short).
 */
export async function platformStep(agent: Agent, host: PlatformStepHost, step: PlatformStep): Promise<StepOutcome> {
  const startSeq = host.storedLength()
  let steps = 0
  let cut = false
  const stop = host.onEvent((session, event) => {
    if (session === agent.session && event.type === 'step/start' && ++steps > step.steps) {
      cut = true
      agent.cancel({ kind: 'user' }, { keepInbox: true })
    }
  })
  host.fence.enter()
  const token = step.tools === undefined ? undefined : host.fence.open(step.label, step.tools, step.args)
  host.writeAs(step.author)
  let tally: FenceTally = { allowed: 0, refused: 0 }
  try {
    agent.followup(step.instruction)
    await agent.whenIdle()
  } finally {
    stop()
    host.fence.leave()
    tally = host.fence.close(token)
    host.writeAs(undefined)
  }
  const record = await step.record?.(startSeq)
  if (record !== undefined) appendPluginRecord(agent.session, record.type as never, record.data as never)
  await host.flush()
  if (step.usage !== undefined) await host.account(startSeq, step.usage)
  return { startSeq, tally, endedByModel: !cut, ran: step.tools === undefined || stepRan(tally, !cut) }
}