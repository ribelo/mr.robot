/**
 * A Robot: one Durable Object, one endless Conversation (robot-ifp6, robot-frf5).
 *
 * Every Wake-up is queued in SQLite and drained one Turn at a time (robot-makt). The Turn
 * is driven by the DO, not by the request that caused it, so a closed tab does not stop it
 * (robot-p9jm). The active Turn is recorded before it starts and a heartbeat alarm stays
 * armed while it runs; if the DO is evicted mid-Turn, the alarm brings it back and the
 * interrupted Turn resumes from the last persisted event.
 */
import { DurableObject } from 'cloudflare:workers'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  Attachment,
  Conversation,
  Identity,
  ModelChoice,
  RobotSettings,
  Sender,
  Sharing,
  TrajectoryEvent,
} from '@mr-robot/protocol'
import { compose, type Composition } from '../agent/compose.ts'
import { platformPrompt } from '../agent/platform-prompt.ts'
import { providerAdapter, type CredentialSource } from '../agent/providers.ts'
import { readStoredEvents, storedLength } from '../agent/session-log.ts'
import { wakeupMessage } from '../agent/sources.ts'
import { conversationTools } from '../agent/tools/conversation.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Env } from '../env.ts'
import { projectChat } from './projection.ts'
import { RobotStore, type RobotConfig, type Wakeup, type WakeupKind } from './store.ts'

const HEARTBEAT_MS = 30_000
export const DEFAULT_CONTEXT_BUDGET = 128_000

export interface RobotInit {
  readonly id: string
  readonly ownerId: string
  readonly ownerName: string
  readonly kind: 'chief' | 'robot'
  readonly identity: Identity
  readonly sharing: Sharing
  readonly status: 'setup' | 'active'
  readonly model: ModelChoice
  readonly timeZone: string
  readonly spendLimitUsd: number | null
}

export interface WakeInput {
  readonly kind: WakeupKind
  readonly sender: Sender
  readonly text: string
  readonly attachments?: readonly Attachment[]
  readonly payload?: Record<string, unknown>
}

export class Robot extends DurableObject<Env> {
  protected readonly store: RobotStore
  private composition: { readonly revision: number; readonly value: Composition } | undefined
  private pumping: Promise<void> | undefined

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new RobotStore(ctx.storage)
  }

  // ---------------------------------------------------------------- lifecycle

  async create(init: RobotInit): Promise<RobotConfig> {
    const existing = this.store.config()
    if (existing !== undefined) return existing
    const config: RobotConfig = {
      id: init.id,
      ownerId: init.ownerId,
      kind: init.kind,
      identity: init.identity,
      sharing: init.sharing,
      status: init.status,
      blockedReason: null,
      model: init.model,
      contextBudget: DEFAULT_CONTEXT_BUDGET,
      codeMode: true,
      compactionInstruction: '',
      notifications: { enabled: true, members: [], channels: ['pwa'] },
      spendLimitUsd: init.spendLimitUsd,
      timeZone: init.timeZone,
      liveSessionId: `s-${crypto.randomUUID()}`,
      revision: 1,
      createdAt: Date.now(),
    }
    this.store.saveConfig(config)
    this.store.set('owner', { id: init.ownerId, name: init.ownerName })
    return config
  }

  // ---------------------------------------------------------------- wake-ups

  /** Queue a Wake-up and make sure the queue is being drained. */
  async wake(input: WakeInput): Promise<number> {
    const config = this.store.requireConfig()
    if (config.status === 'deleted') throw new Error('robot is deleted')
    const id = this.store.enqueue(input.kind, input.sender, input.text, { ...input.payload, attachments: input.attachments ?? [] }, Date.now())
    this.drain()
    return id
  }

  /** Resolves once no Turn is running and nothing runnable is queued (tests and admin use it). */
  async settled(): Promise<void> {
    while (this.pumping !== undefined) await this.pumping
  }

  override async alarm(): Promise<void> {
    const active = this.store.activeTurn()
    if (active !== undefined && this.pumping === undefined) {
      // The DO was evicted mid-Turn: resume it.
      this.drain()
    }
    await this.rearm()
  }

  protected drain(): void {
    if (this.pumping !== undefined) return
    this.pumping = this.pump()
      .catch((error: unknown) => this.failed(error))
      .finally(() => {
        this.pumping = undefined
      })
    this.ctx.waitUntil(this.pumping)
  }

  private async pump(): Promise<void> {
    for (;;) {
      const config = this.store.config()
      if (config === undefined || !runnable(config)) return
      const active = this.store.activeTurn()
      const wakeup = active === undefined ? this.store.nextWakeup() : this.store.wakeup(active.wakeupId)
      if (wakeup === undefined) {
        if (active !== undefined) this.store.endTurn(active.wakeupId)
        return
      }
      await this.runTurn(wakeup, active !== undefined)
    }
  }

  private async runTurn(wakeup: Wakeup, resuming: boolean): Promise<void> {
    const { agent, ctx } = await this.agent()
    if (!resuming) {
      this.store.beginTurn(wakeup.id, agent.session.id, storedLength(this.ctx.storage.sql, agent.session.id), Date.now())
      agent.followup(wakeupMessage({
        sender: wakeup.sender,
        text: wakeup.text,
        attachments: (wakeup.payload['attachments'] as Attachment[] | undefined) ?? [],
        ...(typeof wakeup.payload['requestId'] === 'string' ? { requestId: wakeup.payload['requestId'] } : {}),
        ...(typeof wakeup.payload['replyTo'] === 'string' ? { replyTo: wakeup.payload['replyTo'] } : {}),
        ...(typeof wakeup.payload['replyHandle'] === 'string' ? { replyHandle: wakeup.payload['replyHandle'] } : {}),
      }))
    } else {
      agent.followup(wakeupMessage({
        sender: { kind: 'platform' },
        text: 'Your previous Turn was interrupted by a platform restart. Its tool results above are real. Continue that work from where it stopped; do not redo finished steps.',
      }))
    }
    await this.rearm()
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
    this.store.endTurn(wakeup.id)
    await this.rearm()
  }

  /** A Turn that could not run is never silent: it becomes a notice and the Robot stays runnable. */
  private failed(error: unknown): void {
    console.error('robot turn failed', error)
    const config = this.store.config()
    if (config === undefined) return
    const active = this.store.activeTurn()
    if (active !== undefined) this.store.endTurn(active.wakeupId)
    const message = error instanceof Error ? error.message : String(error)
    this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `The Turn failed: ${message}`, Date.now())
  }

  // ---------------------------------------------------------------- the agent composition

  private async agent(): Promise<Composition> {
    const config = this.store.requireConfig()
    if (this.composition?.revision === config.revision) return this.composition.value
    await this.composition?.value.dispose()
    this.composition = undefined
    const owner = this.store.get<{ id: string; name: string }>('owner') ?? { id: config.ownerId, name: 'your owner' }
    const value = await compose({
      storage: this.ctx.storage,
      sessionId: config.liveSessionId,
      provider: config.model.provider,
      model: config.model.model,
      effort: config.model.effort,
      adapter: this.adapter(config.model.provider),
      contextBudget: config.contextBudget,
      compactionInstruction: config.compactionInstruction,
      prompt: [{ name: 'platform', text: () => platformPrompt(this.store.requireConfig(), owner.name) }],
      tools: this.tools(config),
    })
    this.composition = { revision: config.revision, value }
    return value
  }

  /** The LLM adapter for a Provider; tests override it with a scripted stub. */
  protected adapter(provider: string): LlmAdapter {
    return providerAdapter(provider, { robotId: this.store.requireConfig().id, credentials: this.credentials(), ai: this.env.AI })
  }

  protected credentials(): CredentialSource {
    const config = this.store.requireConfig()
    return {
      resolve: async (provider) => {
        const home = this.env.HOME.getByName('home')
        return (await home.providerCredential(config.ownerId, provider)) ?? undefined
      },
    }
  }

  protected tools(_config: RobotConfig): ToolDefinition[] {
    return [...conversationTools()]
  }

  // ---------------------------------------------------------------- alarm

  private async rearm(): Promise<void> {
    const candidates: number[] = []
    if (this.store.activeTurn() !== undefined || (this.store.pendingWakeups() > 0 && runnable(this.store.requireConfig()))) {
      candidates.push(Date.now() + HEARTBEAT_MS)
    }
    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Math.min(...candidates))
  }

  // ---------------------------------------------------------------- views

  conversation(): Conversation {
    const config = this.store.requireConfig()
    const events = readStoredEvents(this.ctx.storage.sql, config.liveSessionId)
    return {
      robotId: config.id,
      working: this.store.activeTurn() !== undefined,
      items: projectChat({
        events,
        notices: this.store.notices(config.liveSessionId),
        proposal: (id) => {
          const row = this.store.proposal(id)
          if (row === undefined) return undefined
          const { createdAt: _c, answeredAt: _a, payload: _p, ...view } = row
          return view
        },
      }),
    }
  }

  trajectory(): TrajectoryEvent[] {
    const config = this.store.requireConfig()
    return readStoredEvents(this.ctx.storage.sql, config.liveSessionId).map((event) => ({
      seq: event.seq,
      type: event.type,
      time: event.time,
      turn: typeof (event.data as { turn?: unknown }).turn === 'number' ? (event.data as { turn: number }).turn : null,
      data: JSON.stringify(event.data),
    }))
  }

  settings(): RobotSettings {
    const config = this.store.requireConfig()
    return {
      identity: config.identity,
      sharing: config.sharing,
      model: config.model,
      contextBudget: config.contextBudget,
      codeMode: config.codeMode,
      compactionInstruction: config.compactionInstruction,
      grants: this.store.grants(),
      notifications: config.notifications,
      spendLimitUsd: config.spendLimitUsd,
    }
  }
}

function runnable(config: RobotConfig): boolean {
  return config.status === 'active' || config.status === 'setup'
}