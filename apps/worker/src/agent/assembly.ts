/**
 * The Cordis composition inside one Robot: DSH packages plus Mr. Robot's seam plugins.
 */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { type LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { SqliteSessionLog } from './session-log.ts'

export interface AssemblyInput {
  readonly storage: DurableObjectStorage
  readonly adapters: ReadonlyArray<readonly [readonly string[], LlmAdapter]>
}

export async function assemble(input: AssemblyInput): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  for (const [routes, adapter] of input.adapters) ctx.llm.registerAdapter([...routes], adapter)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SqliteSessionLog, { storage: input.storage })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}
