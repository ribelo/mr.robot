/**
 * The Cordis composition of one Robot, derived from its configuration and Grants
 * when the agent boots (robot-c8hq). Rebuilt whenever the configuration revision moves,
 * so settings and Grant changes take effect on the next Turn.
 */
import { Context } from '@deepseek-ai/cordis'
import * as Effect from 'effect/Effect'
import type * as Scope from 'effect/Scope'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ReasoningEffortId, type GenerateOptions, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as SpillPolicy from '@deepseek-ai/dsh-spill-policy'
import ToolRuntime, { type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ThinkingEffort } from '@mr-robot/protocol'
import { BudgetedAdapter } from './budget.ts'
import { compactionConfig, robotCompaction } from './compaction.ts'
import { RobotWorkingDirectory } from './seams.ts'
import { SqliteSessionLog } from './session-log.ts'
import { fenced, isExternal } from './tools/external.ts'
import type { StepFence } from './platform-step.ts'
import type { Mount } from '../plugins/define.ts'
import { maxInlineTokens, WorkspaceSpillStore, type WorkspaceSpillConfig } from '../workspace/spill.ts'

export interface CompositionInput {
  readonly storage: DurableObjectStorage
  readonly sessionId: string
  readonly onAppend?: (sessionId: string) => void
  readonly redact?: (json: string) => string
  /** Inside each append's transaction (the chat fold, v1.19). */
  readonly onStored?: (sessionId: string, from: number) => void
  readonly provider: string
  readonly model: string
  readonly effort: ThinkingEffort
  readonly adapter: LlmAdapter
  readonly contextBudget: number
  /** The model's real context window (the budget may be smaller). */
  readonly modelWindow?: number
  readonly compactionInstruction: string
  /** Called after a compaction replaced a session's context with a checkpoint (the Robot's or a Subagent's). */
  readonly onCompacted?: (sessionId: string) => void
  /** The Robot's platform-step fence: while a step runs, only its tools run (platform-step.ts). */
  readonly fence?: StepFence
  /** The model's output as it streams (pl-jzr7): text and thinking deltas, start and end of an attempt. */
  readonly onStream?: (frame: { type: 'start' | 'chunk' | 'end'; chunk?: { type: string; text?: string } }) => void
  /** Prompt sections, in order; text is read at every request so persona edits apply immediately. */
  readonly prompt: ReadonlyArray<{ readonly name: string; readonly text: () => string }>
  /** The capability plugins its grants allow (pl-rsoy); nothing else registers tools (robot-f9ln). */
  readonly mounts: readonly Mount[]
  /** Code mode (robot-5ewr): plugin that provides ctx.ptcRuntime, or undefined for direct tool calls. */
  readonly ptcRuntime?: (ctx: Context) => Promise<void>
  /** Every ordinary model request, as sent (cache warming replays the last one, ao-jlr0). */
  readonly onRequest?: (options: GenerateOptions) => void
  /** Where an oversized tool result is kept whole (ao-hf02); the inline budget follows the context budget. */
  readonly spill: WorkspaceSpillConfig
  /** Adapters of other Providers the Robot's Subagents may run on (v1.14 ticket 06). */
  readonly extraAdapters?: ReadonlyArray<{ readonly provider: string; readonly adapter: LlmAdapter }>
}

/** One Subagent to create or resume in this composition: a second DSH agent beside the Robot's (ao-ab01). */
export interface ChildAgentInput {
  readonly sessionId: string
  readonly parentAgent: Agent
  readonly provider: string
  readonly model: string
  readonly effort: ThinkingEffort
  /** Prompt sections of the child, in order. */
  readonly prompt: ReadonlyArray<{ readonly name: string; readonly text: () => string }>
  /** Tools the child does not get (delegation, messaging, Asks, ao-8s1d, ao-sbc9). */
  readonly deny: readonly string[]
  /** A fork: the Robot's log up to now (ao-r3oq). */
  readonly seed?: readonly SessionEvent[]
  readonly inheritedEventCount?: number
  readonly parentSession: string
}

export interface Composition {
  readonly ctx: Context
  readonly agent: Agent
  /** Create (or, after a restart, resume) a Subagent's agent; dispose it with the handle. */
  child(input: ChildAgentInput, resume: boolean): Promise<{ readonly agent: Agent; dispose(): Promise<void> }>
  dispose(): Promise<void>
}

export async function compose(input: CompositionInput): Promise<Composition> {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter([input.provider], new BudgetedAdapter(input.adapter, input.contextBudget, input.onRequest))
    for (const extra of input.extraAdapters ?? []) {
      if (extra.provider !== input.provider) ctx.llm.registerAdapter([extra.provider], new BudgetedAdapter(extra.adapter, input.contextBudget))
    }
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SqliteSessionLog, {
      storage: input.storage,
      ...(input.onAppend === undefined ? {} : { onAppend: input.onAppend }),
      ...(input.redact === undefined ? {} : { redact: input.redact }),
      ...(input.onStored === undefined ? {} : { onStored: input.onStored }),
    })
    await ctx.plugin(TokenMeter)
    await ctx.plugin(RobotWorkingDirectory)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembly = await next()
      return { ...assembly, sections: assembly.sections.filter((section) => isProductSection(section.name)) }
    })
    // A tool registers through the gate of the mount being applied, also when a DSH plugin of its seams registers it.
    let gate: ((tool: ToolDefinition) => ToolDefinition) | undefined
    await ctx.plugin(gatedToolRuntime(() => gate, input.fence), {})
    for (const { plugin, config, gate: mountGate } of input.mounts) {
      gate = mountGate
      try {
        await plugin.seams?.(ctx, config as never)
        await ctx.plugin(plugin as never, config as never)
      } finally {
        gate = undefined
      }
    }
    if (input.ptcRuntime !== undefined) await input.ptcRuntime(ctx)
    await ctx.plugin(WorkspaceSpillStore, input.spill)
    await ctx.plugin(SpillPolicy, { maxInlineTokens: maxInlineTokens(input.contextBudget) })
    await ctx.plugin(robotCompaction(input.compactionInstruction, input.onCompacted), compactionConfig(input.contextBudget, input.modelWindow))
    await ctx.plugin(AgentRegistry)
    if (input.onStream !== undefined) {
      const onStream = input.onStream
      ;(ctx as unknown as { on(event: string, listener: (payload: { frame: never }) => void): void }).on('agent/assistant-stream', ({ frame }) => onStream(frame))
    }
    await ctx.plugin(AgentLoop, { agents: [] })

    const id = SessionId(input.sessionId)
    const info = await ctx.llm.resolveModelInfo(input.provider, input.model)
    const efforts = (info.reasoning?.efforts ?? []).map((entry) => String(entry.id))
    const agentOptions = { provider: input.provider, model: input.model, ...reasoning(input.effort, efforts) }
    const setup = (agentCtx: Context) => {
      for (const [index, section] of input.prompt.entries()) {
        // Literal text: a name or a file with "{{" in it must not be read as a DSH prompt variable.
        agentCtx.systemPrompt.section({ name: `robot:${section.name}`, order: index, interpolate: false, text: () => section.text() })
      }
      if (input.ptcRuntime !== undefined) agentCtx.tools.presentAs('ptc')
    }
    const exists = (await ctx.sessionPersistence.stat(id)) !== undefined
    // A chapter seeded by a compaction or a Rewind is stored whole before its first Turn (v1.19): it is resumed like any other.
    const handle = exists
      ? await ctx.agents.resume({ resumeSessionId: id, agentOptions, setup })
      : await ctx.agents.create({ sessionId: id, meta: { cwd: '/workspace' }, agentOptions, setup })
    const child = async (spec: ChildAgentInput, resume: boolean) => {
      const childInfo = await ctx.llm.resolveModelInfo(spec.provider, spec.model)
      const childOptions = { provider: spec.provider, model: spec.model, ...reasoning(spec.effort, (childInfo.reasoning?.efforts ?? []).map((entry) => String(entry.id))) }
      const known = new Set(ctx.tools.schemas().map((schema) => schema.name))
      const childSetup = (agentCtx: Context) => {
        for (const [index, section] of spec.prompt.entries()) {
          agentCtx.systemPrompt.section({ name: `robot:${section.name}`, order: index, interpolate: false, text: () => section.text() })
        }
        const deny = spec.deny.filter((name) => known.has(name))
        if (deny.length > 0) agentCtx.tools.restrict({ deny })
        if (input.ptcRuntime !== undefined) agentCtx.tools.presentAs('ptc')
      }
      const childId = SessionId(spec.sessionId)
      const made = resume
        ? await ctx.agents.resume({ resumeSessionId: childId, parentAgent: spec.parentAgent, agentOptions: childOptions, setup: childSetup })
        : await ctx.agents.create({
          sessionId: childId,
          parentAgent: spec.parentAgent,
          meta: { cwd: '/workspace', origin: 'subagent', delegationDepth: 1, parentSession: SessionId(spec.parentSession), ...(spec.seed === undefined ? {} : { isSeeded: true }) },
          ...(spec.seed === undefined ? {} : { seed: spec.seed, inheritedEventCount: SessionLogOffset(spec.inheritedEventCount ?? spec.seed.length) }),
          agentOptions: childOptions,
          setup: childSetup,
        })
      return { agent: made.agent, dispose: () => made.dispose() }
    }
    return {
      ctx,
      agent: handle.agent,
      child,
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

/**
 * DSH's tool registry with every registration decorated in one place (v1.20 ticket 00): a tool marked external has its text fenced
 * (external.ts); then the gate current at that moment wraps it (the ask-per-call wrapper of the mount being applied, sk-hx8j;
 * registrations outside a mount get none); then, for every tool, the platform step's fence (platform-step.ts) refuses a call the
 * running step does not allow.
 */
function gatedToolRuntime(current: () => ((tool: ToolDefinition) => ToolDefinition) | undefined, fence: StepFence | undefined): typeof ToolRuntime {
  return class GatedToolRuntime extends ToolRuntime {
    override register(definition: ToolDefinition): () => void {
      const base = isExternal(definition) ? fenced(definition) : definition
      const gated = current()?.(base) ?? base
      if (fence === undefined) return super.register(gated)
      return super.register({ ...gated, execute: (args: unknown, exec: ToolRunContext) => {
        fence.check(definition.name)
        return gated.execute(args as never, exec)
      } } as ToolDefinition)
    }
  }
}

/**
 * The prompt allow-list (v1.11, sk-9ekj, sk-xs60): only sections the product wrote are rendered. These are
 * the Robot's own sections (robot:*), the rules of its capability plugins (mr-robot:*, plugins/define.ts)
 * and, in code mode, DSH's statement that only run_code is called and the SDK it declares. Every other
 * section a DSH plugin registers ("not shell commands like cat", the schedule plugin's text) is dropped.
 */
function isProductSection(name: string): boolean {
  return name.startsWith('robot:') || name.startsWith('mr-robot:') || name === 'tools:ptc-only' || name === 'tools:sdk'
}

/** The supported effort closest to the chosen one; none when the model has no reasoning levels. */
function reasoning(effort: ThinkingEffort, supported: readonly string[]): { reasoningEffort?: ReasoningEffortId } {
  if (supported.length === 0) return {}
  const ladder: readonly ThinkingEffort[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max']
  const wanted = ladder.indexOf(effort)
  const best = [...supported]
    .filter((id) => ladder.includes(id as ThinkingEffort))
    .sort((a, b) => Math.abs(ladder.indexOf(a as ThinkingEffort) - wanted) - Math.abs(ladder.indexOf(b as ThinkingEffort) - wanted))[0]
  return best === undefined ? {} : { reasoningEffort: ReasoningEffortId(best) }
}
/**
 * The composition owned by an Effect scope (spec: the Cordis root follows the DO lifecycle):
 * closing the scope disposes the agent and every plugin.
 */
export function composeScoped(input: CompositionInput): Effect.Effect<Composition, Error, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({ try: () => compose(input), catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))) }),
    (composition) => Effect.promise(() => composition.dispose()),
  )
}
