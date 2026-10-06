import { DurableObject } from 'cloudflare:workers'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { assemble } from '../agent/assembly.ts'
import { readStoredEvents } from '../agent/session-log.ts'

export class Robot extends DurableObject {
  private booted: Promise<{ ctx: Context; agent: Agent }> | undefined

  protected llmAdapters(): ReadonlyArray<readonly [readonly string[], LlmAdapter]> {
    return []
  }

  private boot() {
    this.booted ??= (async () => {
      const ctx = await assemble({ storage: this.ctx.storage, adapters: this.llmAdapters() })
      const id = SessionId('live')
      const exists = (await ctx.sessionPersistence.stat(id)) !== undefined
      const agentOptions = { provider: 'stub', model: 'stub' }
      const handle = exists
        ? await ctx.agents.resume({ resumeSessionId: id, agentOptions })
        : await ctx.agents.create({ sessionId: id, meta: { cwd: '/workspace' }, agentOptions })
      return { ctx, agent: handle.agent }
    })()
    return this.booted
  }

  async send(text: string): Promise<void> {
    const { agent } = await this.boot()
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    this.ctx.waitUntil(agent.whenIdle())
  }

  async idle(): Promise<void> {
    const { agent } = await this.boot()
    await agent.whenIdle()
  }

  events(): Array<{ seq: number; type: string; data: string }> {
    return readStoredEvents(this.ctx.storage.sql, 'live').map(({ seq, type, data }) => ({ seq, type, data: JSON.stringify(data) }))
  }
}