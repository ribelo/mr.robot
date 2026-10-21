/**
 * The Workspace instructions (v1.21 ticket 04, cw-hm3d): before a model step, the instruction chain of the Robot's Workspace enters the
 * context as its own platform message, after the memory message when there is one, never in the system prompt (the prompt cache holds
 * across a cd). The host decides what the step gets: the whole chain, what changed, or nothing.
 */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { capability } from './define.ts'

export interface WorkspaceInstructionsHost {
  /** The message this step of the session gets: the whole chain or the changes; undefined for none. */
  instructions(sessionId: string, step: number): Promise<{ readonly text: string; readonly form: 'baseline' | 'changes' } | undefined>
}

const instructionsMessage = (text: string, form: 'baseline' | 'changes'): UserMessage => createUserMessage({
  content: [{ type: 'text', text }],
  // A platform message without a summary stays out of the chat.
  source: { kind: 'platform', summary: '', form: 'notice', hidden: true, workspaceInstructions: form } as never,
})

const isMemory = (message: unknown) => (message as { source?: { memory?: unknown } }).source?.memory !== undefined
const isInstructions = (message: unknown) => (message as { source?: { workspaceInstructions?: unknown } }).source?.workspaceInstructions !== undefined

const base = capability<{ host: WorkspaceInstructionsHost }>({
  name: 'workspace-instructions',
  Config: z.object({ host: z.any().required() }) as never,
  tools: () => [],
})

type PreStepDecision = { kind: string; messages: readonly UserMessage[] }
type PreStep = (input: { agent: { session: { id: unknown } }; messages: readonly UserMessage[]; step: number }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>

export const WorkspaceInstructions = {
  ...base,
  async apply(ctx: Parameters<typeof base.apply>[0], config: { host: WorkspaceInstructionsHost }) {
    await base.apply(ctx, config)
    const on = ctx as unknown as { on(event: 'agent/pre-step', listener: PreStep): void }
    on.on('agent/pre-step', async ({ agent, messages, step }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) return decision
      if (decision.messages.some(isInstructions)) return decision
      const found = await config.host.instructions(String(agent.session.id), step)
      if (found === undefined) return decision
      const message = instructionsMessage(found.text, found.form)
      // After the memory message when this step has one, else right after the claimed batch.
      const memory = decision.messages.findLastIndex(isMemory)
      const at = memory >= 0 ? memory + 1 : decision.messages.findLastIndex((entry) => messages.includes(entry)) + 1
      return { ...decision, messages: decision.messages.toSpliced(at, 0, message) }
    })
  },
}
