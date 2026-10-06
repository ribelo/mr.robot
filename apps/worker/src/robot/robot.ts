/**
 * A Robot: one Durable Object, one endless Conversation (robot-ifp6, robot-frf5).
 *
 * Every Wake-up is queued in SQLite and drained one Turn at a time (robot-makt). The Turn
 * is driven by the DO, not by the request that caused it, so a closed tab does not stop it
 * (robot-p9jm). The active Turn is recorded before it starts and a heartbeat alarm stays
 * armed while it runs; if the DO dies mid-Turn, the alarm brings it back and the
 * interrupted Turn resumes from the last persisted event.
 */
import { DurableObject } from 'cloudflare:workers'
import * as Effect from 'effect/Effect'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { buildForkSeed, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  Attachment,
  ChatItem,
  Conversation,
  FleetState,
  GrantSet,
  Identity,
  ModelChoice,
  NotificationKind,
  ProposalKind,
  ProposalView,
  RewindView,
  RobotPanel,
  RobotSettings,
  RobotSummary,
  RoutineSchedule,
  RoutineView,
  ScreenView,
  Sender,
  UsageView,
  SettingsPatch,
  Sharing,
  Trajectory,
  TrajectoryEvent,
} from '@mr-robot/protocol'
import { CHIEF_TOOLS, isToolGroup, type ToolGroup } from '../agent/catalog.ts'
import { compose, type Composition } from '../agent/compose.ts'
import type { RobotHost, RoutineHost, WorkspaceHost } from '../agent/host.ts'
import { routineTools } from '../agent/tools/routines.ts'
import { notifyTools, type NotifyHost } from '../agent/tools/notify.ts'
import { maskSecrets, secretTools, type SecretHost } from '../agent/tools/secrets.ts'
import { platformPrompt, setupPrompt } from '../agent/platform-prompt.ts'
import { providerAdapter, type CredentialSource } from '../agent/providers.ts'
import { readStoredEvents, storedLength } from '../agent/session-log.ts'
import { wakeupMessage } from '../agent/sources.ts'
import { conversationTools } from '../agent/tools/conversation.ts'
import { fileTools, memberFileTools } from '../agent/tools/files.ts'
import { grantProposalTools, setupTools } from '../agent/tools/proposals.ts'
import { ptcPlugin } from '../agent/ptc.ts'
import { webPlugin } from '../agent/web.ts'
import type { MemberFileName } from '../member/member.ts'
import { dailyNotePaths, PERSONA_FILES, personaText, type PersonaSnapshot } from '../workspace/persona.ts'
import { ROBOT_FILES } from '../workspace/templates.ts'
import { makeWorkspace, type WorkspaceShape } from '../workspace/workspace.ts'
import { HOME_ID, type Env } from '../env.ts'
import { currentMonth, type RegistryEntry } from '../home/home.ts'
import { projectChat } from './projection.ts'
import { describeSchedule, nextRun, validateSchedule } from './schedule.ts'
import { RobotStore, type ProposalRow, type RobotConfig, type RoutineRow, type Wakeup, type WakeupKind } from './store.ts'

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
  /** What the Robot was asked to become (setup only). */
  readonly brief?: string
}

export interface WakeInput {
  readonly kind: WakeupKind
  readonly sender: Sender
  readonly text: string
  readonly attachments?: readonly Attachment[]
  readonly payload?: Record<string, unknown>
}

export type AnswerResult =
  | { readonly ok: true; readonly proposal: ProposalView }
  | { readonly ok: false; readonly reason: 'stale' | 'not-found' }

export class Robot extends DurableObject<Env> implements RobotHost, WorkspaceHost, RoutineHost, NotifyHost, SecretHost {
  protected readonly store: RobotStore
  private composition: { readonly revision: number; readonly value: Composition } | undefined
  private pumping: Promise<void> | undefined
  private persona: PersonaSnapshot = { files: [], soul: '' }
  /** Values of granted secrets, kept only in memory to mask views (never stored by the Robot). */
  private secretValues: Array<readonly [string, string]> = []
  private pendingSeed: { readonly sessionId: string; readonly events: readonly SessionEvent[]; readonly inheritedEventCount: number; readonly parentSession: string } | undefined

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new RobotStore(ctx.storage)
  }

  // ---------------------------------------------------------------- lifecycle (robot-qo06)

  async create(init: RobotInit): Promise<RobotConfig> {
    const existing = this.store.config()
    if (existing !== undefined) return existing
    const now = Date.now()
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
      createdAt: now,
    }
    this.store.transaction(() => {
      this.store.saveConfig(config)
      this.store.set('owner', { id: init.ownerId, name: init.ownerName })
      if (init.brief !== undefined) this.store.set('brief', init.brief)
      if (init.kind === 'chief') this.store.setGrants({ tools: [...CHIEF_TOOLS], skills: [], recipients: [], secrets: [] })
    })
    await this.seedWorkspace()
    await this.report()
    if (init.status === 'setup') {
      await this.wake({
        kind: 'platform',
        sender: { kind: 'platform' },
        text: 'Setup started. Greet your owner and begin the interview.',
      })
    }
    return config
  }

  async pause(): Promise<void> {
    const config = this.store.requireConfig()
    if (config.status === 'deleted' || config.status === 'paused') return
    this.store.set('resumeStatus', config.status)
    this.store.updateConfig(() => ({ status: 'paused' }), false)
    await this.changed()
  }

  async resume(): Promise<void> {
    const config = this.store.requireConfig()
    if (config.status !== 'paused') return
    this.store.updateConfig(() => ({ status: this.store.get<'active' | 'setup'>('resumeStatus') ?? 'active' }), false)
    await this.changed()
    this.drain()
  }

  /** Delete: no more Wake-ups and gone from every list; the log and Workspace are kept as the archive. */
  async remove(): Promise<void> {
    this.store.updateConfig(() => ({ status: 'deleted' }), false)
    await this.ctx.storage.deleteAlarm()
    await this.changed()
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

  /** Resolves once no Turn is running and nothing runnable is queued. */
  async settled(): Promise<void> {
    while (this.pumping !== undefined) await this.pumping
  }

  override async alarm(): Promise<void> {
    const config = this.store.config()
    if (config !== undefined && config.status !== 'deleted') this.fireRoutines(Date.now())
    if (this.store.activeTurn() !== undefined || this.store.pendingWakeups() > 0) this.drain()
    await this.rearm()
  }

  /**
   * Due Routines become Wake-ups. However many occurrences were missed while the Robot was
   * down, each due Routine runs once (robot-v1gb), and its next run is computed from now.
   */
  private fireRoutines(now: number): void {
    for (const routine of this.store.routines()) {
      if (routine.nextRun === null || routine.nextRun > now) continue
      this.store.transaction(() => {
        this.store.enqueue('routine', { kind: 'routine', routineId: routine.id, name: routine.name }, routine.prompt, { routineId: routine.id, due: routine.nextRun }, now)
        const next = nextRun(routine.schedule, routine.timeZone, now, routine.createdAt)
        if (next === null) this.store.deleteRoutine(routine.id)
        else this.store.saveRoutine({ ...routine, lastRun: now, nextRun: next })
      })
    }
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
      if (active === undefined && this.store.pendingWakeups() > 0 && config.status === 'active' && (await this.checkLimits())) return
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
    await this.refreshPersona()
    if (!resuming) {
      const startSeq = storedLength(this.ctx.storage.sql, agent.session.id)
      this.store.beginTurn(wakeup.id, agent.session.id, startSeq, Date.now())
      this.store.set(`turn-start:${wakeup.id}`, startSeq)
      agent.followup(wakeupMessage({
        sender: wakeup.sender,
        text: wakeup.text,
        attachments: (wakeup.payload['attachments'] as Attachment[] | undefined) ?? [],
        ...optionalString(wakeup.payload, 'requestId'),
        ...optionalString(wakeup.payload, 'replyTo'),
        ...optionalString(wakeup.payload, 'replyHandle'),
      }))
    } else {
      agent.followup(wakeupMessage({
        sender: { kind: 'platform' },
        text: 'Your previous Turn was interrupted by a platform restart. Its tool results above are real. Continue that work from where it stopped; do not redo finished steps.',
      }))
    }
    await this.rearm()
    await this.changed()
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
    this.store.endTurn(wakeup.id)
    await this.afterTurn(wakeup)
    await this.rearm()
    await this.changed()
  }

  /** Platform duties once a Turn ends: SOUL.md changes, and the hooks of later tickets. */
  protected async afterTurn(wakeup: Wakeup): Promise<void> {
    const startSeq = this.store.get<number>(`turn-start:${wakeup.id}`) ?? 0
    this.store.delete(`turn-start:${wakeup.id}`)
    await this.accountTurn(startSeq)
    await this.notifyFinished(wakeup, startSeq)
    await this.checkLimits()
    const soul = (await this.run(this.workspace.readText('SOUL.md'))) ?? ''
    if (soul !== this.persona.soul) {
      const config = this.store.requireConfig()
      this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `${config.identity.name} changed SOUL.md.`, Date.now())
      this.persona = { ...this.persona, soul }
      await this.soulChanged()
    }
  }

  /** Tell the owner the Robot changed who it is (robot-h1nm). */
  protected async soulChanged(): Promise<void> {
    await this.notifyMembers('finished', 'changed SOUL.md: who it is has changed. Open the Conversation to see why.')
  }

  /** "Finished": the Turn produced a reply and the person it concerns is not watching it live. */
  private async notifyFinished(wakeup: Wakeup, startSeq: number): Promise<void> {
    const replies = this.conversation().items.filter((item) => item.seq >= startSeq && item.kind === 'reply')
    const last = replies.at(-1)
    if (last === undefined || last.kind !== 'reply') return
    const watcher = wakeup.sender.kind === 'member' ? wakeup.sender.memberId : undefined
    await this.notifyMembers('finished', last.text, (memberId) => memberId === watcher && this.ctx.getWebSockets(memberId).length > 0)
  }

  /**
   * Push to the Robot's notified Members through the Member DOs (quiet hours live there).
   * @returns how many Members were notified; 0 when notifications are off (robot-r2uz).
   */
  async notifyMembers(kind: NotificationKind, body: string, skip: (memberId: string) => boolean = () => false): Promise<number> {
    const config = this.store.requireConfig()
    if (!config.notifications.enabled) return 0
    const members = (config.notifications.members.length === 0 ? [config.ownerId] : config.notifications.members).filter((member) => !skip(member))
    // A notification that cannot be delivered never fails the Turn that caused it.
    await Promise.all(members.map((member) => this.env.MEMBER.getByName(member)
      .notify({ robotId: config.id, robotName: config.identity.name, kind, body })
      .catch((error: unknown) => console.warn('notification failed', member, error))))
    return members.length
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
    this.broadcast()
    this.ctx.waitUntil(this.notifyMembers('blocked', `A Turn failed: ${message}`).catch(() => 0))
  }

  // ---------------------------------------------------------------- usage and spend limits (robot-6jqh, robot-8gag, robot-40nw)

  /** Add one Turn's tokens and cost to this Robot's and its owner's monthly counters. */
  private async accountTurn(startSeq: number): Promise<void> {
    const config = this.store.requireConfig()
    let input = 0
    let output = 0
    let cached = 0
    for (const event of readStoredEvents(this.ctx.storage.sql, config.liveSessionId, startSeq)) {
      const usage = (event.data as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } }).usage
      if (usage === undefined) continue
      input += usage.inputTokens ?? 0
      output += usage.outputTokens ?? 0
      cached += usage.cacheReadTokens ?? 0
    }
    if (input === 0 && output === 0) return
    const price = (await this.home().modelList()).find((option) => option.provider === config.model.provider && option.model === config.model.model)?.price
    const cost = price === undefined ? 0 : ((input - cached) * price.input + cached * (price.cachedInput ?? price.input) + output * price.output) / 1_000_000
    const month = currentMonth()
    this.store.addUsage(month, input, output, cost)
    await this.env.MEMBER.getByName(config.ownerId).addUsage(month, config.id, input, output, cost)
  }

  /** Over the Robot's or its owner's monthly limit: stop and tell the owner; under it again: resume. */
  private async checkLimits(): Promise<boolean> {
    const config = this.store.requireConfig()
    if (config.status !== 'active' && !(config.status === 'blocked' && config.blockedReason === 'limit')) return false
    const limits = await this.home().limitsFor(config.ownerId)
    const robotLimit = config.spendLimitUsd ?? limits.robotDefaultUsd
    const spent = this.store.usage(currentMonth()).costUsd
    const reason = robotLimit !== null && spent >= robotLimit
      ? `This Robot reached its monthly spend limit (${spent.toFixed(2)} of ${robotLimit.toFixed(2)}).`
      : limits.memberUsd !== null && limits.memberSpentUsd >= limits.memberUsd
        ? `Your Robots reached your monthly spend limit (${limits.memberSpentUsd.toFixed(2)} of ${limits.memberUsd.toFixed(2)}).`
        : null
    if (reason !== null && config.status === 'active') {
      this.store.updateConfig(() => ({ status: 'blocked', blockedReason: 'limit' }), false)
      this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `${reason} It stops here until the limit is raised.`, Date.now())
      await this.changed()
      await this.notifyMembers('blocked', `${reason} Raise the limit to let it continue.`)
      return true
    }
    if (reason === null && config.status === 'blocked') {
      this.store.updateConfig(() => ({ status: 'active', blockedReason: null }), false)
      await this.changed()
      this.drain()
    }
    return reason !== null
  }

  /** A limit changed somewhere: unblock when the Robot is under its limits again. */
  async recheckLimits(): Promise<void> {
    await this.checkLimits()
  }

  // ---------------------------------------------------------------- the agent composition

  private async agent(): Promise<Composition> {
    const config = this.store.requireConfig()
    if (this.composition?.revision === config.revision) return this.composition.value
    await this.composition?.value.dispose()
    this.composition = undefined
    const owner = this.owner()
    const brief = this.store.get<string>('brief') ?? null
    const prompt = [{ name: 'platform', text: () => platformPrompt(this.store.requireConfig(), owner.name) }]
    if (config.status === 'setup') prompt.push({ name: 'setup', text: () => setupPrompt(owner.name, brief) })
    prompt.push({ name: 'workspace', text: () => personaText(this.persona) })
    const seed = this.pendingSeed?.sessionId === config.liveSessionId ? this.pendingSeed : undefined
    const contextWindow = (await this.home().modelList()).find((option) => option.provider === config.model.provider && option.model === config.model.model)?.contextWindow
    const value = await compose({
      storage: this.ctx.storage,
      sessionId: config.liveSessionId,
      ...(seed === undefined ? {} : { seed }),
      onAppend: () => this.broadcast(),
      provider: config.model.provider,
      model: config.model.model,
      effort: config.model.effort,
      adapter: this.adapter(config.model.provider, contextWindow),
      contextBudget: config.contextBudget,
      compactionInstruction: config.compactionInstruction,
      prompt,
      tools: this.tools(config),
      plugins: this.plugins(config),
      ...(config.codeMode && config.status !== 'setup' ? { ptcRuntime: ptcPlugin(this.env.LOADER) } : {}),
    })
    this.composition = { revision: config.revision, value }
    this.pendingSeed = undefined
    return value
  }

  /** The LLM adapter for a Provider; tests override it with a scripted stub. */
  protected adapter(provider: string, contextWindow?: number): LlmAdapter {
    return providerAdapter(provider, {
      robotId: this.store.requireConfig().id,
      credentials: this.credentials(),
      ai: this.env.AI,
      ...(contextWindow === undefined ? {} : { contextWindow }),
    })
  }

  protected credentials(): CredentialSource {
    const config = this.store.requireConfig()
    return {
      resolve: async (provider) => (await this.home().providerCredential(config.ownerId, provider)) ?? undefined,
    }
  }

  /** Exactly the tools this Robot may call: the Conversation tools plus its granted groups. */
  protected tools(config: RobotConfig): ToolDefinition[] {
    const tools = [...conversationTools()]
    if (config.status === 'setup') return [...tools, ...setupTools(this), ...fileTools(this)]
    tools.push(...grantProposalTools(this), ...memberFileTools(this))
    for (const group of this.store.grants().tools.filter(isToolGroup)) tools.push(...this.groupTools(group, config))
    return tools
  }

  /** Tools of one granted group. Groups whose tools come from a DSH plugin are mounted in plugins(). */
  protected groupTools(group: ToolGroup, config: RobotConfig): ToolDefinition[] {
    switch (group) {
      case 'files': return fileTools(this)
      case 'routines': return routineTools(this, config.timeZone)
      case 'notify': return notifyTools(this)
      case 'secrets': return secretTools(this, this.store.grants().secrets)
      default: return []
    }
  }

  /** Seam plugins for granted groups (DSH web, skills). */
  protected plugins(config: RobotConfig): Array<(ctx: import('@deepseek-ai/cordis').Context) => Promise<void>> {
    const plugins: Array<(ctx: import('@deepseek-ai/cordis').Context) => Promise<void>> = []
    if (config.status !== 'setup' && this.store.hasGrant('tool', 'web')) plugins.push(webPlugin(this.credentials()))
    return plugins
  }

  // ---------------------------------------------------------------- Workspace

  get workspace(): WorkspaceShape {
    return makeWorkspace(this.env.FILES, this.store.requireConfig().id)
  }

  run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return Effect.runPromise(effect)
  }

  memberFile(name: MemberFileName): Promise<string> {
    return this.env.MEMBER.getByName(this.store.requireConfig().ownerId).file(name)
  }

  /** The Muse layout, written once when the Robot is created (robot-om9f). */
  private async seedWorkspace(): Promise<void> {
    const ws = this.workspace
    await this.run(Effect.forEach(Object.entries(ROBOT_FILES), ([path, content]) =>
      ws.stat(path).pipe(Effect.flatMap((existing): Effect.Effect<unknown, unknown> => existing === undefined ? ws.write(path, content) : Effect.void)), { concurrency: 4, discard: true }))
  }

  private async refreshPersona(): Promise<void> {
    const config = this.store.requireConfig()
    const ws = this.workspace
    const own = [...PERSONA_FILES, ...dailyNotePaths(Date.now(), config.timeZone)]
    const files = await this.run(Effect.forEach(own, (path) => ws.readText(path).pipe(Effect.map((content) => ({ path, content: content ?? '' }))), { concurrency: 8 }))
    const member = await this.env.MEMBER.getByName(config.ownerId).files().catch(() => ({ 'USER.md': '', 'PROACTIVE_PREFERENCES.md': '' }))
    this.persona = {
      files: [...files, { path: 'USER.md', content: member['USER.md'] }, { path: 'PROACTIVE_PREFERENCES.md', content: member['PROACTIVE_PREFERENCES.md'] }],
      soul: files.find((file) => file.path === 'SOUL.md')?.content ?? '',
    }
  }

  // ---------------------------------------------------------------- RobotHost

  config(): RobotConfig {
    return this.store.requireConfig()
  }

  grants(): GrantSet {
    return this.store.grants()
  }

  now(): number {
    return Date.now()
  }

  propose(kind: ProposalKind, purpose: string, payload: Record<string, unknown>): ProposalView {
    const row = this.store.propose(kind, purpose, payload, Date.now(), (open) => kind !== 'member-file' || open.file?.name === (payload['file'] as { name?: string } | undefined)?.name)
    this.ctx.waitUntil(this.changed())
    this.ctx.waitUntil(this.notifyMembers('needs you', `${purpose}: waiting for your answer.`).catch(() => 0))
    return proposalView(row)
  }

  setIdentity(patch: Partial<Identity>): Identity {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => typeof value === 'string' && value.trim() !== '')) as Partial<Identity>
    const next = this.store.updateConfig((config) => ({ identity: { ...config.identity, ...clean } }), false)
    this.ctx.waitUntil(this.changed())
    return next.identity
  }

  // ---------------------------------------------------------------- the owner's side

  /**
   * Answer a Grant proposal or question. Compare-and-swap on the revision: an answer to a
   * superseded or already-answered proposal fails. Approval applies the stored payload exactly.
   */
  async answer(proposalId: string, revision: number, approve: boolean): Promise<AnswerResult> {
    const existing = this.store.proposal(proposalId)
    if (existing === undefined) return { ok: false, reason: 'not-found' }
    const answered = this.store.answerProposal(proposalId, revision, approve, Date.now())
    if (answered === undefined) return { ok: false, reason: 'stale' }
    if (approve) await this.apply(answered)
    await this.changed()
    await this.wake({
      kind: 'platform',
      sender: { kind: 'platform' },
      text: approve ? approvedNote(answered) : `Your owner rejected your ${answered.kind} proposal (${answered.purpose}). Do not ask for it again unless they bring it up.`,
    })
    return { ok: true, proposal: proposalView(answered) }
  }

  private async apply(proposal: ProposalRow): Promise<void> {
    switch (proposal.kind) {
      case 'setup': {
        const grants = proposal.grants ?? { tools: [], skills: [], recipients: [], secrets: [] }
        this.store.transaction(() => {
          this.store.setGrants(grants)
          this.store.updateConfig(() => ({ status: 'active' }))
        })
        return
      }
      case 'grants': {
        const current = this.store.grants()
        const add = proposal.grants ?? { tools: [], skills: [], recipients: [], secrets: [] }
        this.store.setGrants({
          tools: [...current.tools, ...add.tools],
          skills: [...current.skills, ...add.skills],
          recipients: [...current.recipients, ...add.recipients],
          secrets: [...current.secrets, ...add.secrets],
        })
        this.store.updateConfig(() => ({}))
        return
      }
      default:
        await this.applyProposal(proposal)
    }
  }

  /** Proposal kinds beyond Grants: Member files here, skills in ticket 16. */
  protected async applyProposal(proposal: ProposalRow): Promise<void> {
    if (proposal.kind === 'member-file' && proposal.file !== null) {
      await this.env.MEMBER.getByName(this.store.requireConfig().ownerId).writeFile(proposal.file.name as MemberFileName, proposal.file.content)
    }
  }

  /** Mr. Robot's recipients follow what his Member can reach (robot-70kf). */
  async setRecipients(robotIds: readonly string[]): Promise<void> {
    const grants = this.store.grants()
    if (sameSet(grants.recipients, robotIds)) return
    this.store.setGrants({ ...grants, recipients: [...robotIds] })
    this.store.updateConfig(() => ({}))
  }

  /** Advanced settings (robot-vqtw): every change takes effect on the next Turn. */
  async updateSettings(patch: SettingsPatch): Promise<RobotSettings> {
    this.store.transaction(() => {
      if (patch.grants !== undefined) this.store.setGrants(patch.grants)
      this.store.updateConfig((config) => ({
        ...(patch.identity === undefined ? {} : { identity: patch.identity }),
        ...(patch.sharing === undefined ? {} : { sharing: patch.sharing }),
        ...(patch.model === undefined ? {} : { model: patch.model }),
        ...(patch.contextBudget === undefined ? {} : { contextBudget: Math.max(8_000, Math.round(patch.contextBudget)) }),
        ...(patch.codeMode === undefined ? {} : { codeMode: patch.codeMode }),
        ...(patch.compactionInstruction === undefined ? {} : { compactionInstruction: patch.compactionInstruction }),
        ...(patch.notifications === undefined ? {} : { notifications: { ...patch.notifications, channels: [...new Set(['pwa', ...patch.notifications.channels])] } }),
        ...(patch.spendLimitUsd === undefined ? {} : { spendLimitUsd: patch.spendLimitUsd }),
        ...(config.kind === 'chief' && patch.sharing !== undefined ? { sharing: 'private' as const } : {}),
      }))
    })
    await this.changed()
    if (patch.spendLimitUsd !== undefined) await this.checkLimits()
    return this.settings()
  }

  // ---------------------------------------------------------------- reporting and live updates

  protected owner(): { id: string; name: string } {
    return this.store.get<{ id: string; name: string }>('owner') ?? { id: this.store.requireConfig().ownerId, name: 'your owner' }
  }

  protected home() {
    return this.env.HOME.getByName(HOME_ID)
  }

  fleetState(): FleetState {
    const config = this.store.requireConfig()
    if (config.status === 'paused') return 'paused'
    if (config.status === 'blocked') return 'blocked'
    if (this.store.activeTurn() !== undefined) return 'working'
    if (this.store.proposals('open').length > 0 || this.store.get('takeover') !== undefined) return 'waiting for you'
    if (config.status === 'setup') return 'setup'
    return 'sleeping'
  }

  /** Report the registry row to the Home and tell open views to refresh. */
  protected async changed(): Promise<void> {
    this.broadcast()
    await this.report()
  }

  private async report(): Promise<void> {
    const config = this.store.requireConfig()
    const last = lastLine(this.conversation().items)
    const entry: RegistryEntry = {
      id: config.id,
      ownerId: config.ownerId,
      kind: config.kind,
      identity: config.identity,
      sharing: config.sharing,
      status: config.status,
      fleetState: this.fleetState(),
      lastLine: last?.text ?? '',
      lastAt: last?.at ?? config.createdAt,
    }
    await this.home().robotChanged(entry)
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a WebSocket', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server, [request.headers.get('x-member-id') ?? 'viewer'])
    server.send(JSON.stringify({ type: 'changed', working: this.store.activeTurn() !== undefined }))
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') socket.send('pong')
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    socket.close(code === 1005 ? 1000 : code)
  }

  protected broadcast(event: Record<string, unknown> = { type: 'changed' }): void {
    const config = this.store.config()
    if (config === undefined) return
    const text = JSON.stringify({ ...event, working: this.store.activeTurn() !== undefined })
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(text) } catch { /* a closing socket */ }
    }
  }

  // ---------------------------------------------------------------- alarm

  private async rearm(): Promise<void> {
    const candidates: number[] = []
    const config = this.store.config()
    if (config === undefined || config.status === 'deleted') {
      await this.ctx.storage.deleteAlarm()
      return
    }
    if (this.store.activeTurn() !== undefined || (this.store.pendingWakeups() > 0 && runnable(config))) {
      candidates.push(Date.now() + HEARTBEAT_MS)
    }
    candidates.push(...this.alarmCandidates())
    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Math.min(...candidates))
  }

  /** Further alarm times: the earliest Routine here, outbox retries in ticket 15. */
  protected alarmCandidates(): number[] {
    const config = this.store.config()
    if (config === undefined || config.status === 'deleted') return []
    return this.store.routines().flatMap((routine) => routine.nextRun === null ? [] : [routine.nextRun])
  }

  // ---------------------------------------------------------------- Routines (robot-gbbt, robot-qyd5)

  createRoutine(input: { name: string; prompt: string; schedule: RoutineSchedule }): RoutineView {
    const config = this.store.requireConfig()
    const now = Date.now()
    const schedule = validateSchedule(input.schedule, config.timeZone, now)
    if (input.name.trim() === '' || input.prompt.trim() === '') throw new Error('a Routine needs a name and a prompt')
    const routine: RoutineRow = {
      id: `rt-${crypto.randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      schedule,
      timeZone: config.timeZone,
      nextRun: nextRun(schedule, config.timeZone, now, now),
      lastRun: null,
      createdAt: now,
    }
    this.store.saveRoutine(routine)
    this.routinesChanged()
    return routineView(config.id, routine)
  }

  updateRoutine(id: string, input: { name?: string; prompt?: string; schedule?: RoutineSchedule }): RoutineView {
    const config = this.store.requireConfig()
    const existing = this.store.routine(id)
    if (existing === undefined) throw new Error(`no Routine ${id}`)
    const now = Date.now()
    const schedule = input.schedule === undefined ? existing.schedule : validateSchedule(input.schedule, existing.timeZone, now)
    const routine: RoutineRow = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt.trim() }),
      schedule,
      nextRun: input.schedule === undefined ? existing.nextRun : nextRun(schedule, existing.timeZone, now, now),
      ...(input.schedule === undefined ? {} : { createdAt: now }),
    }
    this.store.saveRoutine(routine)
    this.routinesChanged()
    return routineView(config.id, routine)
  }

  deleteRoutine(id: string): RoutineView {
    const config = this.store.requireConfig()
    const existing = this.store.routine(id)
    if (existing === undefined) throw new Error(`no Routine ${id}`)
    this.store.deleteRoutine(id)
    this.routinesChanged()
    return routineView(config.id, existing)
  }

  listRoutines(): RoutineView[] {
    return this.routineViews()
  }

  /** The owner deletes a Routine from the panel (robot-qyd5). */
  async removeRoutine(id: string): Promise<void> {
    this.deleteRoutine(id)
    await this.rearm()
    await this.changed()
  }

  private routinesChanged(): void {
    this.ctx.waitUntil(this.rearm())
  }

  // ---------------------------------------------------------------- views

  async conversationView(): Promise<Conversation> {
    await this.loadSecretMasks()
    const view = this.conversation()
    return { ...view, items: view.items.map((item) => maskItem(item, (text) => this.mask(text))) }
  }

  async trajectoryMasked(): Promise<Trajectory> {
    await this.loadSecretMasks()
    return this.trajectoryView()
  }

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
          return row === undefined ? undefined : proposalView(row)
        },
      }),
    }
  }

  /** The full session log of the live Conversation (robot-h5v3), secrets masked (robot-4zi6). */
  trajectory(): TrajectoryEvent[] {
    const config = this.store.requireConfig()
    return readStoredEvents(this.ctx.storage.sql, config.liveSessionId).map((event) => ({
      seq: event.seq,
      type: event.type,
      time: event.time,
      turn: typeof (event.data as { turn?: unknown }).turn === 'number' ? (event.data as { turn: number }).turn : null,
      data: this.mask(JSON.stringify(event.data)),
    }))
  }

  trajectoryView(): Trajectory {
    const config = this.store.requireConfig()
    return { robotId: config.id, sessionId: config.liveSessionId, events: this.trajectory(), rewinds: this.store.rewinds() }
  }

  /** Replace granted secret values with a mask (robot-4zi6). */
  protected mask(text: string): string {
    return maskSecrets(text, this.secretValues)
  }

  /** secret.get: a granted name only, resolved from the owner or the Home (robot-0bde). */
  async secret(name: string): Promise<string> {
    const config = this.store.requireConfig()
    const granted = this.store.grants().secrets
    if (!granted.includes(name)) throw new Error(`The secret "${name}" is not granted to you. Granted: ${granted.join(', ') || 'none'}. Ask with propose_grants.`)
    const value = await this.home().resolveSecret(config.ownerId, name)
    if (value === null) throw new Error(`The secret "${name}" no longer exists`)
    this.remember(name, value)
    return value
  }

  private remember(name: string, value: string): void {
    this.secretValues = [...this.secretValues.filter(([known]) => known !== name), [name, value]]
  }

  /** Load every granted secret's value so views can mask them, also after a restart. */
  protected async loadSecretMasks(): Promise<void> {
    const config = this.store.config()
    if (config === undefined) return
    const granted = this.store.grants().secrets
    const values = await Promise.all(granted.map(async (name) => [name, await this.home().resolveSecret(config.ownerId, name).catch(() => null)] as const))
    this.secretValues = values.filter((entry): entry is readonly [string, string] => entry[1] !== null)
  }

  // ---------------------------------------------------------------- rewind (robot-0q6a, robot-8v1t, robot-acr3)

  /**
   * Make a new live session seeded from the log up to and including `atSeq`. The old log
   * stays in this Robot's SQLite as the archive, with a rewind record; nothing is rewritten.
   * The Robot is told that external effects after the point still stand.
   */
  async rewind(atSeq: number): Promise<RewindView> {
    const config = this.store.requireConfig()
    if (this.store.activeTurn() !== undefined || this.pumping !== undefined) throw new Error('the Robot is working; rewind when it is done')
    const events = readStoredEvents(this.ctx.storage.sql, config.liveSessionId)
    if (!Number.isInteger(atSeq) || atSeq < 0 || atSeq >= events.length) throw new Error(`no event ${atSeq} in this Conversation`)
    const dropped = events.slice(atSeq + 1)
    const toolsAfter = [...new Set(dropped.filter((event) => event.type === 'tool/call').map((event) => String((event.data as { name?: unknown }).name)))]
    const seed = buildForkSeed(events, SessionSeq(atSeq))
    const sessionId = `s-${crypto.randomUUID()}`
    const now = Date.now()
    const rewind = { id: `rw-${crypto.randomUUID().slice(0, 8)}`, atSeq, archivedSessionId: config.liveSessionId, liveSessionId: sessionId, at: now }

    await this.composition?.value.dispose()
    this.composition = undefined
    this.pendingSeed = { sessionId, events: seed, inheritedEventCount: atSeq + 1, parentSession: config.liveSessionId }
    this.store.transaction(() => {
      this.store.addRewind(rewind)
      this.store.updateConfig(() => ({ liveSessionId: sessionId }))
    })
    const { agent, ctx } = await this.agent()
    agent.inject(wakeupMessage({
      sender: { kind: 'platform' },
      text: [
        'Your owner rewound this Conversation to an earlier point. Everything after that point is gone from your memory of the Conversation, but its external effects still stand: messages already sent, files written, carts filled, orders placed stay as they are.',
        toolsAfter.length === 0 ? 'No tools were used after the rewind point.' : `After the rewind point you had used: ${toolsAfter.join(', ')}. Check the real state before you repeat or contradict anything.`,
      ].join('\n'),
    }))
    await ctx.sessions.flush(agent.session)
    this.store.addNotice(sessionId, storedLength(this.ctx.storage.sql, sessionId), `Rewound to an earlier point. The previous Conversation is kept in the archive.`, now)
    await this.changed()
    return { ...rewind, undone: false }
  }

  /** Undo the latest rewind: its archived log becomes live again (robot-8v1t). */
  async undoRewind(id: string): Promise<RewindView> {
    const config = this.store.requireConfig()
    if (this.store.activeTurn() !== undefined || this.pumping !== undefined) throw new Error('the Robot is working; undo when it is done')
    const rewind = this.store.rewinds().find((entry) => entry.id === id)
    if (rewind === undefined || rewind.undone) throw new Error('no such rewind')
    if (rewind.liveSessionId !== config.liveSessionId) throw new Error('only the latest rewind can be undone')
    await this.composition?.value.dispose()
    this.composition = undefined
    this.store.transaction(() => {
      this.store.markRewindUndone(id, Date.now())
      this.store.updateConfig(() => ({ liveSessionId: rewind.archivedSessionId }))
    })
    await this.changed()
    return { ...rewind, undone: true }
  }

  /** An archived log, read-only (the rewind archive). */
  archivedTrajectory(sessionId: string): TrajectoryEvent[] {
    if (!this.store.rewinds().some((rewind) => rewind.archivedSessionId === sessionId || rewind.liveSessionId === sessionId)) return []
    return readStoredEvents(this.ctx.storage.sql, sessionId).map((event) => ({
      seq: event.seq, type: event.type, time: event.time,
      turn: typeof (event.data as { turn?: unknown }).turn === 'number' ? (event.data as { turn: number }).turn : null,
      data: this.mask(JSON.stringify(event.data)),
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

  panel(canEdit: boolean, summary: RobotSummary): RobotPanel {
    return {
      summary,
      settings: this.settings(),
      routines: this.routineViews(),
      screen: this.screen(),
      usage: this.usage(),
      canEdit,
    }
  }

  protected routineViews(): RoutineView[] {
    const id = this.store.requireConfig().id
    return this.store.routines().map((routine) => routineView(id, routine))
  }

  /** Filled by the browser and usage tickets. */

  protected screen(): ScreenView | null {
    return null
  }

  protected usage(): UsageView {
    const month = currentMonth()
    return { month, ...this.store.usage(month), limitUsd: this.store.requireConfig().spendLimitUsd }
  }

  /** Names of the tools the current composition registers (what the model may call). */
  toolNames(): string[] {
    return this.tools(this.store.requireConfig()).map((tool) => tool.name)
  }

  openProposals(): ProposalView[] {
    return this.store.proposals('open').map(proposalView)
  }

  status(): { status: RobotConfig['status']; fleetState: FleetState } {
    return { status: this.store.requireConfig().status, fleetState: this.fleetState() }
  }
}

function maskItem(item: ChatItem, mask: (text: string) => string): ChatItem {
  switch (item.kind) {
    case 'message': return { ...item, text: mask(item.text) }
    case 'reply': return { ...item, text: mask(item.text) }
    case 'notice': return { ...item, text: mask(item.text) }
    default: return item
  }
}

function routineView(robotId: string, routine: RoutineRow): RoutineView {
  return { ...routine, robotId, summary: describeSchedule(routine.schedule, routine.timeZone) }
}

function runnable(config: RobotConfig): boolean {
  return config.status === 'active' || config.status === 'setup'
}

function optionalString(payload: Record<string, unknown>, key: string): Record<string, string> {
  const value = payload[key]
  return typeof value === 'string' ? { [key]: value } : {}
}

function proposalView(row: ProposalRow): ProposalView {
  return { id: row.id, kind: row.kind, revision: row.revision, status: row.status, purpose: row.purpose, grants: row.grants, file: row.file, skill: row.skill }
}

function approvedNote(proposal: ProposalRow): string {
  switch (proposal.kind) {
    case 'setup': return 'Your owner approved your setup. You are active now with exactly the Grants you proposed. Say hello in one line and tell them what happens next.'
    case 'grants': return `Your owner approved your Grant proposal (${proposal.purpose}). The new Grants are available from now on.`
    default: return `Your owner approved your ${proposal.kind} proposal (${proposal.purpose}).`
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item))
}

function lastLine(items: readonly ChatItem[]): { text: string; at: number } | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (item.kind === 'reply') return { text: item.text, at: item.at }
    if (item.kind === 'message') return { text: item.text, at: item.at }
    if (item.kind === 'notice') return { text: item.text, at: item.at }
    if (item.kind === 'question') return { text: item.proposal.purpose, at: item.at }
  }
  return undefined
}