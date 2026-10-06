/**
 * The Cordis composition of one Robot, derived from its configuration and Grants
 * when the agent boots (robot-c8hq). Rebuilt whenever the configuration revision moves,
 * so settings and Grant changes take effect on the next Turn.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ReasoningEffortId, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ThinkingEffort } from '@mr-robot/protocol'
import { BudgetedAdapter } from './budget.ts'
import { compactionConfig, robotCompaction } from './compaction.ts'
import { SqliteSessionLog } from './session-log.ts'

export interface CompositionInput {
  readonly storage: DurableObjectStorage
  readonly sessionId: string
  /** A new session seeded from another one's prefix (rewind). Used only when the session does not exist yet. */
  readonly seed?: { readonly events: readonly SessionEvent[]; readonly inheritedEventCount: number; readonly parentSession: string }
  readonly onAppend?: (sessionId: string) => void
  readonly provider: string
  readonly model: string
  readonly effort: ThinkingEffort
  readonly adapter: LlmAdapter
  readonly contextBudget: number
  readonly compactionInstruction: string
  /** Prompt sections, in order; text is read at every request so persona edits apply immediately. */
  readonly prompt: ReadonlyArray<{ readonly name: string; readonly text: () => string }>
  /** Exactly the tools this Robot may call; nothing else is registered (robot-f9ln). */
  readonly tools: readonly ToolDefinition[]
  /** Extra seam plugins mounted for granted capabilities (web, skills, ...). */
  readonly plugins?: ReadonlyArray<(ctx: Context) => Promise<void>>
  /** Code mode (robot-5ewr): plugin that provides ctx.ptcRuntime, or undefined for direct tool calls. */
  readonly ptcRuntime?: (ctx: Context) => Promise<void>
}

export interface Composition {
  readonly ctx: Context
  readonly agent: Agent
  dispose(): Promise<void>
}

export async function compose(input: CompositionInput): Promise<Composition> {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter([input.provider], new BudgetedAdapter(input.adapter, input.contextBudget))
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SqliteSessionLog, { storage: input.storage, ...(input.onAppend === undefined ? {} : { onAppend: input.onAppend }) })
    await ctx.plugin(TokenMeter)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
    await ctx.plugin(ToolRuntime, {})
    for (const plugin of input.plugins ?? []) await plugin(ctx)
    if (input.ptcRuntime !== undefined) await input.ptcRuntime(ctx)
    await ctx.plugin(robotCompaction(input.compactionInstruction), compactionConfig(input.contextBudget))
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })

    const id = SessionId(input.sessionId)
    const info = await ctx.llm.resolveModelInfo(input.provider, input.model)
    const efforts = (info.reasoning?.efforts ?? []).map((entry) => String(entry.id))
    const agentOptions = { provider: input.provider, model: input.model, ...reasoning(input.effort, efforts) }
    const setup = (agentCtx: Context) => {
      for (const [index, section] of input.prompt.entries()) {
        agentCtx.systemPrompt.section({ name: `robot:${section.name}`, order: index, text: () => section.text() })
      }
      for (const tool of input.tools) agentCtx.tools.register(tool)
      if (input.ptcRuntime !== undefined) agentCtx.tools.presentAs('ptc')
    }
    const exists = (await ctx.sessionPersistence.stat(id)) !== undefined
    const handle = exists
      ? await ctx.agents.resume({ resumeSessionId: id, agentOptions, setup })
      : input.seed === undefined
        ? await ctx.agents.create({ sessionId: id, meta: { cwd: '/workspace' }, agentOptions, setup })
        : await ctx.agents.create({
          sessionId: id,
          meta: { cwd: '/workspace', isSeeded: true, parentSession: SessionId(input.seed.parentSession) },
          seed: input.seed.events,
          inheritedEventCount: SessionLogOffset(input.seed.inheritedEventCount),
          agentOptions,
          setup,
        })
    return {
      ctx,
      agent: handle.agent,
      dispose: async () => {
        await handle.dispose()
        await ctx.fiber.dispose()
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

/** The supported effort closest to the chosen one; none when the model has no reasoning levels. */
function reasoning(effort: ThinkingEffort, supported: readonly string[]): { reasoningEffort?: ReasoningEffortId } {
  if (supported.length === 0) return {}
  const ladder: readonly ThinkingEffort[] = ['off', 'low', 'medium', 'high', 'max']
  const wanted = ladder.indexOf(effort)
  const best = [...supported]
    .filter((id) => ladder.includes(id as ThinkingEffort))
    .sort((a, b) => Math.abs(ladder.indexOf(a as ThinkingEffort) - wanted) - Math.abs(ladder.indexOf(b as ThinkingEffort) - wanted))[0]
  return best === undefined ? {} : { reasoningEffort: ReasoningEffortId(best) }
}