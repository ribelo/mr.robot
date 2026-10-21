/**
 * The voice (v1.15 ticket 01): mounted on every Robot, setup included, with no Grant. Also its two behaviours around a Turn (moved out
 * of robot.ts in v1.20 ticket 00): the safety net at a Turn's end without a say, and the one steer after ten quiet minutes.
 */
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { sayTools, type SayHost } from '../agent/tools/say.ts'
import { wakeupMessage } from '../agent/sources.ts'
import { platformStep, type PlatformStepHost } from '../agent/platform-step.ts'
import type { Duty } from '../robot/duties.ts'
import type { RobotStore } from '../robot/store.ts'
import { capability } from './define.ts'

export const Say = capability<{ host: SayHost }>({
  name: 'say',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => sayTools(host),
})

/** The kv key of the moment an owner Turn that has said nothing gets its one steer (v1.15, gb-0skq). */
export const QUIET_DUE = 'quiet-due'

/** What the safety net and the quiet steer ask of their Robot. */
export interface VoiceHost {
  readonly store: RobotStore
  readonly step: PlatformStepHost
  /** The live session's stored events from a seq on. */
  events(from: number): readonly SessionEvent[]
  /** Whether these events hold a say of the Robot's own (a fallback is not one). */
  said(events: readonly SessionEvent[]): boolean
  /** It reacted and wrote no text: the reaction was its answer. */
  reactedOnly(events: readonly SessionEvent[]): boolean
  ownerName(): string
  /** The agent of the running Turn while a steer can still reach it. */
  runningAgent(): Agent | undefined
  /** Show the last assistant text as the reply, marked as a fallback. */
  fallback(text: string): Promise<void>
}

/**
 * A Turn that ends without a say (gb-xgd7, gb-7jqy, gb-3gp2): one bounded platform step tells the Robot to speak or end. When the owner
 * caused the Turn (`byOwner`) and the step stays silent, the last assistant text of the Turn is shown as the reply and marked as a
 * fallback; with no text at all nothing is sent. Turns nobody asked for get the step and never the fallback: silence is a result there.
 */
export async function safetyNet(host: VoiceHost, agent: Agent, input: { readonly startSeq: number; readonly byOwner: () => boolean; readonly note: string; readonly steps: number }): Promise<void> {
  await host.step.flush()
  const turn = host.events(input.startSeq)
  if (host.said(turn) || host.reactedOnly(turn) || turn.some((event) => event.type === 'turn/end' && (event.data as { reason?: { kind?: string } }).reason?.kind === 'error')) return
  const { startSeq: stepStart } = await platformStep(agent, host.step, { label: 'the safety net', instruction: wakeupMessage({ sender: { kind: 'platform' }, text: input.note, summary: '' }), steps: input.steps })
  const step = host.events(stepStart)
  if (host.said(step) || !input.byOwner()) return
  const textOf = (events: readonly SessionEvent[]) => events.filter((event) => event.type === 'assistant/message')
    .map((event) => ((event.data as unknown as { message?: { content?: ReadonlyArray<{ type: string; text?: string }> } }).message?.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('').trim())
    .filter((text) => text !== '').at(-1)
  const last = textOf(turn.filter((event) => event.seq < stepStart)) ?? textOf(step)
  if (last !== undefined) await host.fallback(last)
}

/** The alarm: an owner Turn that has said nothing for ten minutes gets one steer, once (gb-0skq). */
export function quietSteerDuty(host: VoiceHost, note: (owner: string) => string): Duty {
  return {
    name: 'quiet-steer',
    order: 10,
    scope: 'alive',
    nextAt: () => host.store.get<{ readonly at: number }>(QUIET_DUE)?.at,
    run: async (now) => {
      const due = host.store.get<{ wakeupId: number; at: number }>(QUIET_DUE)
      if (due === undefined) return
      const active = host.store.activeTurn()
      if (active === undefined || active.wakeupId !== due.wakeupId) return host.store.delete(QUIET_DUE)
      if (due.at > now) return
      host.store.delete(QUIET_DUE)
      const agent = host.runningAgent()
      if (agent === undefined || agent.status !== 'running' || host.said(host.events(active.startSeq))) return
      agent.steer(wakeupMessage({ sender: { kind: 'platform' }, text: note(host.ownerName()), summary: '' }))
    },
  }
}
