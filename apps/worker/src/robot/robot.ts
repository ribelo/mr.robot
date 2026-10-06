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
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  Attachment,
  ChatItem,
  Conversation,
  FleetState,
  GrantSet,
  Identity,
  ModelChoice,
  ProposalKind,
  ProposalView,
  RobotPanel,
  RobotSettings,
  RobotSummary,
  RoutineView,
  ScreenView,
  Sender,
  UsageView,
  SettingsPatch,
  Sharing,
  TrajectoryEvent,
} from '@mr-robot/protocol'
import { CHIEF_TOOLS, isToolGroup, type ToolGroup } from '../agent/catalog.ts'
import { compose, type Composition } from '../agent/compose.ts'
import type { RobotHost, WorkspaceHost } from '../agent/host.ts'
import { platformPrompt, setupPrompt } from '../agent/platform-prompt.ts'
import { providerAdapter, type CredentialSource } from '../agent/providers.ts'
import { readStoredEvents, storedLength } from '../agent/session-log.ts'
import { wakeupMessage } from '../agent/sources.ts'
import { conversationTools } from '../agent/tools/conversation.ts'
import { fileTools, memberFileTools } from '../agent/tools/files.ts'
import { grantProposalTools, setupTools } from '../agent/tools/proposals.ts'
import { webPlugin } from '../agent/web.ts'
import type { MemberFileName } from '../member/member.ts'
import { dailyNotePaths, PERSONA_FILES, personaText, type PersonaSnapshot } from '../workspace/persona.ts'
import { ROBOT_FILES } from '../workspace/templates.ts'
import { makeWorkspace, type WorkspaceShape } from '../workspace/workspace.ts'
import { HOME_ID, type Env } from '../env.ts'
import type { RegistryEntry } from '../home/home.ts'
import { projectChat } from './projection.ts'
import { RobotStore, type ProposalRow, type RobotConfig, type Wakeup, type WakeupKind } from './store.ts'

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

export class Robot extends DurableObject<Env> implements RobotHost, WorkspaceHost {
  protected readonly store: RobotStore
  private composition: { readonly revision: number; readonly value: Composition } | undefined
  private pumping: Promise<void> | undefined
  private persona: PersonaSnapshot = { files: [], soul: '' }

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
    if (this.store.activeTurn() !== undefined && this.pumping === undefined) this.drain()
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
    await this.refreshPersona()
    if (!resuming) {
      this.store.beginTurn(wakeup.id, agent.session.id, storedLength(this.ctx.storage.sql, agent.session.id), Date.now())
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
  protected async afterTurn(_wakeup: Wakeup): Promise<void> {
    const soul = (await this.run(this.workspace.readText('SOUL.md'))) ?? ''
    if (soul !== this.persona.soul) {
      const config = this.store.requireConfig()
      this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `${config.identity.name} changed SOUL.md.`, Date.now())
      this.persona = { ...this.persona, soul }
      await this.soulChanged()
    }
  }

  /** Tell the owner the Robot changed who it is (robot-h1nm); Web Push joins in ticket 11. */
  protected async soulChanged(): Promise<void> {}

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
    const value = await compose({
      storage: this.ctx.storage,
      sessionId: config.liveSessionId,
      onAppend: () => this.broadcast(),
      provider: config.model.provider,
      model: config.model.model,
      effort: config.model.effort,
      adapter: this.adapter(config.model.provider),
      contextBudget: config.contextBudget,
      compactionInstruction: config.compactionInstruction,
      prompt,
      tools: this.tools(config),
      plugins: this.plugins(config),
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
  protected groupTools(group: ToolGroup, _config: RobotConfig): ToolDefinition[] {
    switch (group) {
      case 'files': return fileTools(this)
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

  /** Further alarm times (Routines, outbox retries) from later tickets. */
  protected alarmCandidates(): number[] {
    return []
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
          return row === undefined ? undefined : proposalView(row)
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

  /** Filled by the Routines, browser and usage tickets. */
  protected routineViews(): RoutineView[] {
    return []
  }

  protected screen(): ScreenView | null {
    return null
  }

  protected usage(): UsageView {
    return { month: new Date().toISOString().slice(0, 7), inputTokens: 0, outputTokens: 0, costUsd: 0, limitUsd: this.store.requireConfig().spendLimitUsd }
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