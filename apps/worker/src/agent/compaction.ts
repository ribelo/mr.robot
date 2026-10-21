import type { Agent } from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'

type CompactionTrigger = Parameters<BasicCompactionEngine['compactIfNeeded']>[1]

/** A pressure compaction put off for the snapshot. */
class PutOff extends Error {}

type SummarizeInput = Parameters<BasicCompactionEngine['summarize']>[0]
type SummarizeResult = Awaited<ReturnType<BasicCompactionEngine['summarize']>>

/**
 * DSH's default 65k headroom would exceed small budgets; keep 5% of the budget instead. The
 * checkpoint's own output cap defaults to the headroom, which at small budgets (400 tokens at 8k)
 * truncates every summary, more so on reasoning models; give it its own cap.
 */
export function compactionConfig(budget: number, modelWindow?: number): { headroomTokens: number; maxTokens: number } {
  // The checkpoint is written by the model with its full window, not the budget; reasoning models
  // spend thousands of tokens thinking first (kimi-k2.6 used 4000 on reasoning alone, 2026-10-07).
  const window = modelWindow ?? Math.max(budget, 128_000)
  return {
    headroomTokens: Math.min(65_536, Math.floor(budget * 0.05)),
    maxTokens: Math.max(4_000, Math.min(32_000, Math.floor(window / 4))),
  }
}

/**
 * DSH basic compaction plus the Robot's own compaction instruction (robot-zzif): the
 * instruction rides as the last conversation message before DSH's summarization directive,
 * so it shapes what the checkpoint keeps without breaking the provider's prefix cache.
 */
export function robotCompaction(instruction: string, onCompacted?: (sessionId: string) => void, beforeCompaction?: (agent: Agent) => boolean): typeof BasicCompactionEngine {
  // Headroom is set by compose() from the budget.
  return class RobotCompaction extends BasicCompactionEngine {
    private trigger: CompactionTrigger | undefined
    /** Asked once per decision: DSH's retries within one compactIfNeeded do not ask again. */
    private asked = false

    /**
     * The snapshot (v1.20 ticket 01, dm-kg1p): when DSH has decided that pressure compacts now, the Robot is asked first. If it starts
     * its snapshot, this compaction is put off and the next step boundary asks again; an overflow is never put off.
     */
    override async compactIfNeeded(agent: Agent, trigger: CompactionTrigger, signal: AbortSignal): ReturnType<BasicCompactionEngine['compactIfNeeded']> {
      this.trigger = trigger
      this.asked = false
      try {
        return await super.compactIfNeeded(agent, trigger, signal)
      } catch (error) {
        if (error instanceof PutOff) return null
        throw error
      } finally {
        this.trigger = undefined
      }
    }

    override compactRegion(...args: Parameters<BasicCompactionEngine['compactRegion']>): ReturnType<BasicCompactionEngine['compactRegion']> {
      if (this.trigger === 'pressure' && !this.asked) {
        this.asked = true
        if (beforeCompaction?.(args[2]) === true) return Promise.reject(new PutOff())
      }
      return super.compactRegion(...args)
    }

    protected override async summarize(input: SummarizeInput, agent: Agent, signal?: AbortSignal): Promise<SummarizeResult> {
      const result = await this.summarizeWithInstruction(input, agent, signal)
      onCompacted?.(String(agent.session.id))
      return result
    }

    private summarizeWithInstruction(input: SummarizeInput, agent: Agent, signal?: AbortSignal): Promise<SummarizeResult> {
      if (instruction.trim().length === 0) return super.summarize(input, agent, signal)
      const guidance = {
        id: `compaction-guidance-${crypto.randomUUID()}`,
        role: 'user' as const,
        source: { kind: 'platform' as const, summary: 'compaction instruction' },
        content: [{ type: 'text' as const, text: `When you write the checkpoint below, follow this Robot's compaction instruction: ${instruction}` }],
      }
      return super.summarize({ ...input, messages: [...input.messages, guidance as never] }, agent, signal)
    }
  }
}