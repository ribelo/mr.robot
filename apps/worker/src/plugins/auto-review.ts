/**
 * Auto review (v1.14 ticket 08, moved out of robot.ts in v1.20 ticket 00): the review hook of the ask gate. One call of an item at allow
 * is shown to a reviewer before it runs: the Robot's reviewer route, else the Space's, else the Robot's own model. It reads the running
 * Turn only, with every secret masked, at most REVIEW_HISTORY_ITEMS items and REVIEW_HISTORY_TOKENS tokens (v1.20.1). The session gets a
 * record of the decision for the Trajectory (ao-jn6z); the reviewer's tokens are the Robot's review cost (ao-hfni). A failed review
 * rejects, so the call does not run.
 */
import { createUserMessage, ReasoningEffortId, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ModelChoice, ModelOption } from '@mr-robot/protocol'
import { boundHistory, readDecision, REVIEW_POLICY, reviewHistory, reviewUserText } from '../agent/auto-review.ts'
import type { ReviewOutcome } from '../agent/ask-gate.ts'
import { WORKSPACE_ROOT } from '../places/files.ts'
import { mrRobotIdOf } from '../robot/delivery.ts'

/** The Trajectory's record of one review. */
export const REVIEW_RECORD = 'plugin:mr-robot/review'

export interface ReviewHost {
  /** The route that reviews: the Robot's reviewer, else the Space's default, else the Robot's own model. */
  route(): Promise<ModelChoice>
  ownerId(): string
  modelList(): Promise<readonly ModelOption[]>
  adapter(provider: string, window: number | undefined, model: string, wire: ModelOption['wire']): LlmAdapter
  recordUsage(source: 'review', input: number, output: number, cost: number): Promise<void>
  /** Where the running Turn of a session starts; undefined: all of it (a Subagent's session is its own Turn). */
  turnStart(sessionId: string): number | undefined
  /** Every secret the Robot may read, masked (v1.20.1). */
  mask(text: string): string
}

type ReviewCall = { readonly definition: ToolDefinition; readonly arguments: Readonly<Record<string, unknown>>; readonly exec: ToolRunContext }

export function autoReviewer(host: ReviewHost): (call: ReviewCall) => Promise<ReviewOutcome> {
  return async (call) => {
    const route = await host.route()
    const session = call.exec.agent?.session
    const record = (data: Record<string, unknown>) => {
      if (session !== undefined) appendPluginRecord(session, REVIEW_RECORD as never, { callId: String(call.exec.callId), name: call.definition.name, reviewer: `${route.provider}/${route.model}`, ...data } as never)
    }
    try {
      const chosen = (await host.modelList()).find((option) => option.provider === route.provider && option.model === route.model)
      const adapter = host.adapter(route.provider, chosen?.contextWindow, route.model, chosen?.wire)
      const ownerId = host.ownerId()
      // One Turn, redacted, bounded (v1.20.1, cross-review #2): the reviewer's provider never sees more, and its cost stays linear.
      const from = session === undefined ? undefined : host.turnStart(String(session.id))
      const events = (session?.snapshotEvents() ?? []).filter((event) => from === undefined || event.seq >= from)
      const history = boundHistory(reviewHistory(events, { ownerId, chiefId: mrRobotIdOf(ownerId), child: (session?.header as { origin?: string } | undefined)?.origin === 'subagent' }), (text) => host.mask(text))
      // The pending call is masked too: a secret never leaves for the reviewer's provider.
      const text = host.mask(reviewUserText({
        cwd: WORKSPACE_ROOT,
        history,
        action: { mode: call.exec.parent === undefined ? 'native' : 'ptc-inner', name: call.definition.name, description: call.definition.description, parameters: call.definition.parameters, arguments: call.arguments },
      }))
      const { decision, usage } = await readDecision(adapter.stream({
        provider: route.provider,
        model: route.model,
        system: REVIEW_POLICY,
        messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'platform', summary: 'Auto review', form: 'notice' } })],
        temperature: 0,
        ...(route.effort === 'off' ? {} : { reasoningEffort: ReasoningEffortId(route.effort) }),
        signal: call.exec.signal,
      }))
      const price = chosen?.price
      const cost = price === undefined ? 0 : ((usage.inputTokens - usage.cacheReadTokens) * price.input + usage.cacheReadTokens * (price.cachedInput ?? price.input) + usage.outputTokens * price.output) / 1_000_000
      await host.recordUsage('review', usage.inputTokens, usage.outputTokens, cost)
      record({ risk: decision.risk, decision: decision.decision, ...(decision.decision === 'deny' && decision.reason !== undefined ? { reason: decision.reason } : {}) })
      return decision.decision === 'allow' ? { decision: 'allow' } : { decision: 'deny', reason: decision.reason ?? `${decision.risk} risk` }
    } catch (error) {
      record({ decision: 'failed', reason: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
}