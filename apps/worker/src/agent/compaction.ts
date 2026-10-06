import type { Agent } from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'

type SummarizeInput = Parameters<BasicCompactionEngine['summarize']>[0]
type SummarizeResult = Awaited<ReturnType<BasicCompactionEngine['summarize']>>

/**
 * DSH's default 65k headroom would exceed small budgets; keep 5% of the budget instead. The
 * checkpoint's own output cap defaults to the headroom, which at small budgets (400 tokens at 8k)
 * truncates every summary, more so on reasoning models; give it its own cap.
 */
export function compactionConfig(budget: number): { headroomTokens: number; maxTokens: number } {
  return {
    headroomTokens: Math.min(65_536, Math.floor(budget * 0.05)),
    maxTokens: Math.min(16_000, Math.max(4_000, Math.floor(budget * 0.25))),
  }
}

/**
 * DSH basic compaction plus the Robot's own compaction instruction (robot-zzif): the
 * instruction rides as the last conversation message before DSH's summarization directive,
 * so it shapes what the checkpoint keeps without breaking the provider's prefix cache.
 */
export function robotCompaction(instruction: string): typeof BasicCompactionEngine {
  // Headroom is set by compose() from the budget; the instruction is the only behaviour change.
  return class RobotCompaction extends BasicCompactionEngine {
    protected override summarize(input: SummarizeInput, agent: Agent, signal?: AbortSignal): Promise<SummarizeResult> {
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