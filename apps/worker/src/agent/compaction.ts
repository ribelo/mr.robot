import type { Agent } from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'

type SummarizeInput = Parameters<BasicCompactionEngine['summarize']>[0]
type SummarizeResult = Awaited<ReturnType<BasicCompactionEngine['summarize']>>

/**
 * DSH basic compaction plus the Robot's own compaction instruction (robot-zzif): the
 * instruction rides as the last conversation message before DSH's summarization directive,
 * so it shapes what the checkpoint keeps without breaking the provider's prefix cache.
 */
export function robotCompaction(instruction: string): typeof BasicCompactionEngine {
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
