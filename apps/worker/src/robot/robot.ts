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
import { LlmError, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { OpencodePool } from '../providers/opencode-go.ts'
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
import { MR_ROBOT_TOOLS, isToolGroup, type ToolGroup } from '../agent/catalog.ts'
import { composeScoped, type Composition } from '../agent/compose.ts'
import { browserUsePlugin, credentialsPlugin, filesPlugin } from '../agent/seams.ts'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import type { RobotHost, RoutineHost, WorkspaceHost } from '../agent/host.ts'
import { routineTools } from '../agent/tools/routines.ts'
import { notifyTools, type NotifyHost } from '../agent/tools/notify.ts'
import { maskSecrets, secretTools, type SecretHost } from '../agent/tools/secrets.ts'
import { messagingTools, replyTools, robotsTools, type DirectoryEntry, type MessagingHost, type RobotsHost } from '../agent/tools/messaging.ts'
import { platformPrompt, setupPrompt } from '../agent/platform-prompt.ts'
import { providerAdapter, type CredentialSource } from '../agent/providers.ts'
import { readStoredEvents, storedLength } from '../agent/session-log.ts'
import { wakeupMessage } from '../agent/sources.ts'
import { conversationTools } from '../agent/tools/conversation.ts'
import { fileTools, memberFileTools } from '../agent/tools/files.ts'
import { grantProposalTools, setupTools } from '../agent/tools/proposals.ts'
import { ptcPlugin } from '../agent/ptc.ts'
import { webPlugin } from '../agent/web.ts'
import { skillProposalTools, skillsPlugin } from '../agent/skills.ts'
import { browserTools, type BrowserHost } from '../agent/tools/browser.ts'
import { takeoverTools, type TakeoverHost } from '../agent/tools/takeover.ts'
import { fanOut, type ChannelAdapter, type ChannelOutput, type InboundEvent } from '../channels/channel.ts'
import { PwaChannel } from '../channels/pwa.ts'
import { RenderingDriver, type BrowserAction, type BrowserDriver, type BrowserPage, type BrowserState } from '../browser/driver.ts'
import type { Observation } from '../browser/observe.ts'
import type { MemberFileName } from '../member/member.ts'
import { dailyNotePaths, PERSONA_FILES, personaText, type PersonaSnapshot } from '../workspace/persona.ts'
import { ROBOT_FILES } from '../workspace/templates.ts'
import { makeWorkspace, type WorkspaceShape } from '../workspace/workspace.ts'
import { HOME_ID, type Env } from '../env.ts'
import { currentMonth, type RegistryEntry } from '../home/home.ts'
import { projectChat } from './projection.ts'
import { cronOf, describeSchedule, nextRun, validateSchedule } from './schedule.ts'
import { RobotStore, type ProposalRow, type RobotConfig, type RoutineRow, type Wakeup, type WakeupKind } from './store.ts'

const HEARTBEAT_MS = 30_000
export const DEFAULT_CONTEXT_BUDGET = 128_000

export interface RobotInit {
  readonly id: string
  readonly ownerId: string
  readonly ownerName: string
  readonly kind: 'mr-robot' | 'robot'
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

/** A message between Robots, as the platform carries it (robot-mv15). */
export interface RobotMessage {
  readonly id: string
  readonly kind: 'request' | 'reply'
  readonly from: { readonly robotId: string; readonly ownerId: string; readonly name: string; readonly avatarColor: string }
  readonly text: string
  readonly requestId: string
  readonly chain: { readonly id: string; readonly hops: number }
}

export type ReceiveResult = { readonly accepted: true } | { readonly accepted: false; readonly reason: 'unavailable' | 'queue-full' | 'chain-limit' }

const MAX_CHAIN_HOPS = 8
const MAX_QUEUED_WAKEUPS = 32

export class Robot extends DurableObject<Env> implements RobotHost, WorkspaceHost, RoutineHost, NotifyHost, SecretHost, MessagingHost, RobotsHost, BrowserHost, TakeoverHost {
  protected readonly store: RobotStore
  private composition: { readonly revision: number; readonly value: Composition; readonly scope: Scope.Closeable } | undefined
  private pumping: Promise<void> | undefined
  private persona: PersonaSnapshot = { files: [], soul: '' }
  private browserPage: Promise<BrowserPage> | undefined
  private screencast: { stop: () => Promise<void> } | undefined
  /** The wake-up a Turn is being started for, so a failure before the Turn begins can still be retried. */
  private starting: Wakeup | undefined
  private handingBack = false
  /** Values of granted secrets, kept only in memory to mask views (never stored by the Robot). */
  private secretValues: Array<readonly [string, string]> = []
  /** Secret values fetched during the running Turn; redacted from everything stored. */
  private turnSecrets: Array<readonly [string, string]> = []
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
      if (init.kind === 'mr-robot') this.store.setGrants({ tools: [...MR_ROBOT_TOOLS], skills: [], recipients: [], secrets: [] })
    })
    await this.seedWorkspace()
    await this.report()
    if (init.status === 'setup') {
      await this.wake({
        kind: 'platform',
        sender: { kind: 'platform' },
        text: 'Setup started. Greet your owner and begin the interview.',
        payload: { summary: 'Setup started' },
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

  /** A Turn that ended in an error keeps its wake-up for "Try again"; a good Turn clears it. */
  private rememberFailure(wakeup: Wakeup, startSeq: number): boolean {
    const config = this.store.requireConfig()
    const failed = readStoredEvents(this.ctx.storage.sql, config.liveSessionId)
      .some((event) => event.seq >= startSeq && event.type === 'turn/end' && (event.data as { reason?: { kind?: string } }).reason?.kind === 'error')
    if (failed) this.store.set('failed-wakeup', { kind: wakeup.kind, sender: wakeup.sender, text: wakeup.text, payload: wakeup.payload })
    else this.store.delete('failed-wakeup')
    return failed
  }

  /** Run the wake-up whose Turn failed again (the chat's "Try again"). */
  async retry(): Promise<boolean> {
    const failed = this.store.get<{ kind: WakeInput['kind']; sender: WakeInput['sender']; text: string; payload: Record<string, unknown> }>('failed-wakeup')
    if (failed === undefined) return false
    this.store.delete('failed-wakeup')
    const { attachments, ...payload } = failed.payload as { attachments?: Attachment[] } & Record<string, unknown>
    await this.wake({ kind: failed.kind, sender: failed.sender, text: failed.text, payload, ...(attachments === undefined ? {} : { attachments }) })
    await this.changed()
    return true
  }

  /**
   * What the model is given at the start of the next Turn (robot-vqtw): the system prompt sections,
   * the tools it may call and the skills it may load, with secret values masked.
   */
  async promptPreview(): Promise<{ sections: Array<{ name: string; text: string }>; tools: string[]; skills: string[] }> {
    const config = this.store.requireConfig()
    const owner = this.owner()
    await this.refreshPersona()
    await this.loadSecretMasks()
    const sections = [{ name: 'Platform', text: platformPrompt(config, owner.name) }]
    if (config.status === 'setup') sections.push({ name: 'Setup interview', text: setupPrompt(owner.name, this.store.get<string>('brief') ?? null) })
    sections.push({ name: 'Persona and memory files', text: personaText(this.persona) })
    return {
      sections: sections.map((section) => ({ ...section, text: this.mask(section.text) })),
      tools: config.codeMode && config.status !== 'setup' ? ['run_code (code mode), calling:', ...this.toolNames()] : this.toolNames(),
      skills: config.status === 'setup' ? [] : [...this.store.grants().skills],
    }
  }

  /** Resolves once no Turn is running and nothing runnable is queued. */
  async settled(): Promise<void> {
    while (this.pumping !== undefined) await this.pumping
  }

  override async alarm(): Promise<void> {
    const config = this.store.config()
    if (config !== undefined && config.status !== 'deleted') this.fireRoutines(Date.now())
    if (config !== undefined) await this.deliverOutbox()
    if (this.store.activeTurn() !== undefined || this.store.pendingWakeups() > 0) this.drain()
    await this.rearm()
  }

  /**
   * Due Routines become Wake-ups. However many occurrences were missed while the Robot was
   * down, each due Routine runs once (robot-v1gb), and its next run is computed from now.
   */
  private fireRoutines(now: number): void {
    for (const routine of this.store.routines()) {
      if (routine.paused || routine.nextRun === null || routine.nextRun > now) continue
      this.store.transaction(() => {
        const wakeupId = this.store.enqueue('routine', { kind: 'routine', routineId: routine.id, name: routine.name }, routine.prompt, { routineId: routine.id, due: routine.nextRun }, now)
        this.store.addRoutineRun(routine.id, wakeupId, now)
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
      this.starting = wakeup
      try {
        await this.runTurn(wakeup, active !== undefined)
      } finally {
        this.starting = undefined
      }
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
        ...optionalString(wakeup.payload, 'summary'),
      }))
    } else {
      agent.followup(wakeupMessage({
        sender: { kind: 'platform' },
        text: 'Your previous Turn was interrupted by a platform restart. Its tool results above are real. Continue that work from where it stopped; do not redo finished steps.',
        summary: 'Resumed after a restart',
      }))
    }
    await this.rearm()
    await this.changed()
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
    if (this.turnSecrets.length > 0) {
      // The in-memory session still holds plaintext; the next Turn starts from the redacted log.
      await this.releaseComposition()
      this.turnSecrets = []
    }
    this.store.endTurn(wakeup.id)
    await this.afterTurn(wakeup)
    await this.rearm()
    await this.changed()
  }

  /** Platform duties once a Turn ends: SOUL.md changes, and the hooks of later tickets. */
  protected async afterTurn(wakeup: Wakeup): Promise<void> {
    if (this.store.get('takeover') === undefined) await this.closeBrowser()
    const startSeq = this.store.get<number>(`turn-start:${wakeup.id}`) ?? 0
    this.store.delete(`turn-start:${wakeup.id}`)
    await this.accountTurn(startSeq)
    const failedTurn = this.rememberFailure(wakeup, startSeq)
    if (wakeup.kind === 'routine') {
      const reply = this.conversation().items.filter((item) => item.seq >= startSeq && item.kind === 'reply').at(-1)
      this.store.finishRoutineRun(wakeup.id, failedTurn ? 'failed' : 'done', failedTurn ? 'The Turn failed.' : (reply?.kind === 'reply' ? reply.text.split('\n')[0]!.slice(0, 160) : 'Finished without a reply.'))
    }
    await this.loadSecretMasks()
    await this.deliverReplies(wakeup, startSeq)
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
    await this.sendToChannels({
      kind: 'notification', id: `n-${crypto.randomUUID()}`, robotId: config.id, robotName: config.identity.name,
      notification: kind, text: body, memberIds: members,
    })
    return members.length
  }

  // ---------------------------------------------------------------- Channels (robot-vfqd)

  /** The Channel adapters this Robot can use; v1 has the PWA. Tests add a fake one. */
  protected channels(): Map<string, ChannelAdapter> {
    const pwa = new PwaChannel({ notify: (memberId, event) => this.env.MEMBER.getByName(memberId).notify(event) })
    return new Map([[pwa.id, pwa]])
  }

  /** Output leaves through every enabled Channel; a failing Channel never fails the Turn. */
  protected async sendToChannels(output: ChannelOutput): Promise<string[]> {
    const config = this.store.requireConfig()
    const delivered = {
      has: (key: string) => this.store.get<boolean>(`delivered:${key}`) === true,
      add: (key: string) => this.store.set(`delivered:${key}`, true),
    }
    try {
      return await fanOut(output, config.notifications.channels, this.channels(), delivered)
    } catch (error) {
      console.warn('channel delivery failed', error)
      return []
    }
  }

  /** An external event arrives through a Channel and wakes the Robot (deduplicated by event id). */
  async channelEvent(event: InboundEvent): Promise<{ accepted: boolean }> {
    const adapter = this.channels().get(event.channel)
    if (adapter === undefined) throw new Error(`no Channel ${event.channel}`)
    if (!this.store.requireConfig().notifications.channels.includes(event.channel)) return { accepted: false }
    const wakeup = adapter.inbound(event)
    if (this.store.get<boolean>(`inbound:${wakeup.dedupeKey}`) === true) return { accepted: true }
    this.store.set(`inbound:${wakeup.dedupeKey}`, true)
    await this.wake({ kind: 'channel', sender: wakeup.sender, text: wakeup.text, payload: { route: wakeup.route } })
    return { accepted: true }
  }

  /** Replies of a Turn go back out: to the Channel the message came from, and to every enabled one. */
  private async deliverReplies(wakeup: Wakeup, startSeq: number): Promise<void> {
    const config = this.store.requireConfig()
    const route = (wakeup.payload['route'] as { channel: string; address: string } | undefined) ?? null
    for (const item of this.conversation().items) {
      if (item.seq < startSeq || item.kind !== 'reply') continue
      await this.sendToChannels({ kind: 'reply', id: item.id, robotId: config.id, robotName: config.identity.name, text: this.mask(item.text), route })
    }
  }

  /** A Turn that could not run is never silent: it becomes a notice and the Robot stays runnable. */
  private failed(error: unknown): void {
    console.error('robot turn failed', error)
    const config = this.store.config()
    if (config === undefined) return
    const active = this.store.activeTurn()
    const wakeup = active !== undefined ? this.store.wakeup(active.wakeupId) : this.starting
    // Kept so "Try again" can run the same wake-up once the cause is fixed (a key added, a model changed).
    if (wakeup !== undefined) {
      if (wakeup.kind === 'routine') this.store.finishRoutineRun(wakeup.id, 'failed', 'The Turn failed.')
      this.store.set('failed-wakeup', { kind: wakeup.kind, sender: wakeup.sender, text: wakeup.text, payload: wakeup.payload })
      this.store.endTurn(wakeup.id)
    }
    const message = error instanceof Error ? error.message : String(error)
    const unsent = active === undefined && wakeup !== undefined && wakeup.sender.kind === 'member' ? ` Your message "${wakeup.text.slice(0, 80)}${wakeup.text.length > 80 ? '…' : ''}" was not delivered; Try again sends it.` : ''
    this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `The Turn failed: ${message}.${unsent}`, Date.now())
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

  /** Close the composition's scope: the agent and every plugin are disposed. */
  private async releaseComposition(): Promise<void> {
    const current = this.composition
    this.composition = undefined
    if (current !== undefined) await Effect.runPromise(Scope.close(current.scope, Exit.void))
  }

  private async agent(): Promise<Composition> {
    const config = this.store.requireConfig()
    if (this.composition?.revision === config.revision) return this.composition.value
    await this.releaseComposition()
    const owner = this.owner()
    const brief = this.store.get<string>('brief') ?? null
    const prompt = [{ name: 'platform', text: () => platformPrompt(this.store.requireConfig(), owner.name) }]
    if (config.status === 'setup') prompt.push({ name: 'setup', text: () => setupPrompt(owner.name, brief) })
    prompt.push({ name: 'workspace', text: () => personaText(this.persona) })
    const seed = this.pendingSeed?.sessionId === config.liveSessionId ? this.pendingSeed : undefined
    const chosen = (await this.home().modelList()).find((option) => option.provider === config.model.provider && option.model === config.model.model)
    const contextWindow = chosen?.contextWindow
    const scope = await Effect.runPromise(Scope.make())
    const value = await Effect.runPromise(Scope.provide(scope)(composeScoped({
      storage: this.ctx.storage,
      sessionId: config.liveSessionId,
      ...(seed === undefined ? {} : { seed }),
      onAppend: () => this.broadcast(),
      redact: (json) => maskSecrets(json, this.turnSecrets),
      provider: config.model.provider,
      model: config.model.model,
      effort: config.model.effort,
      adapter: this.adapter(config.model.provider, contextWindow, config.model.model, chosen?.wire),
      contextBudget: config.contextBudget,
      compactionInstruction: config.compactionInstruction,
      prompt,
      tools: this.tools(config),
      plugins: this.plugins(config),
      ...(config.codeMode && config.status !== 'setup' ? { ptcRuntime: ptcPlugin(this.env.LOADER) } : {}),
    }))).catch(async (error: unknown) => {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      throw error
    })
    this.composition = { revision: config.revision, value, scope }
    this.pendingSeed = undefined
    return value
  }

  /** The LLM adapter for a Provider; tests override it with a scripted stub. */
  protected adapter(provider: string, contextWindow?: number, model?: string, wire?: 'chat' | 'anthropic' | 'responses'): LlmAdapter {
    return providerAdapter(provider, {
      robotId: this.store.requireConfig().id,
      credentials: this.credentials(),
      ai: this.env.AI,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(model === undefined ? {} : { model }),
      ...(wire === undefined ? {} : { wire }),
    })
  }

  protected credentials(): CredentialSource {
    const config = this.store.requireConfig()
    return {
      resolve: async (provider) => (await this.home().providerCredential(config.ownerId, provider)) ?? undefined,
      opencodePool: () => this.opencodePool(config.ownerId),
    }
  }

  /** The owner's OpenCode Go pool (or the Home's), resolved per request so rotation and sharing apply at once. */
  private opencodePool(ownerId: string): OpencodePool {
    const owner = async () => {
      const found = await this.home().opencodePoolOwner(ownerId)
      if (found === null) throw new LlmError('Add an OpenCode Go API key under Providers, or use one shared with the Home', 'MISSING_CREDENTIAL')
      return found
    }
    return {
      candidates: async (sessionId) => {
        const { ownerId: holder, forHome } = await owner()
        return this.env.MEMBER.getByName(holder).opencodeCandidates(sessionId, forHome)
      },
      promote: async (expected, id) => this.env.MEMBER.getByName((await owner()).ownerId).opencodePromote(expected, id),
      stick: async (sessionId, id) => this.env.MEMBER.getByName((await owner()).ownerId).opencodeStick(sessionId, id),
    }
  }

  /** Exactly the tools this Robot may call: the Conversation tools plus its granted groups. */
  protected tools(config: RobotConfig): ToolDefinition[] {
    const tools = [...conversationTools()]
    if (config.status === 'setup') return [...tools, ...setupTools(this), ...fileTools(this)]
    tools.push(...grantProposalTools(this), ...memberFileTools(this), ...replyTools(this))
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
      case 'messaging': return messagingTools(this)
      case 'skills': return skillProposalTools(this)
      case 'browser': return [...browserTools(this), ...takeoverTools(this)]
      case 'robots': return config.kind === 'mr-robot' ? robotsTools(this) : []
      default: return []
    }
  }

  /** Seam plugins for granted groups (DSH web, skills). */
  protected plugins(config: RobotConfig): Array<(ctx: import('@deepseek-ai/cordis').Context) => Promise<void>> {
    const plugins: Array<(ctx: import('@deepseek-ai/cordis').Context) => Promise<void>> = [credentialsPlugin(this.credentials())]
    // Setup may write its own persona files; afterwards only a files Grant gives the file tools.
    if (config.status === 'setup' || this.store.hasGrant('tool', 'files')) plugins.push(filesPlugin(this.workspace, (name) => this.memberFile(name)))
    if (config.status !== 'setup' && this.store.hasGrant('tool', 'browser')) plugins.push(browserUsePlugin())
    if (config.status !== 'setup' && this.store.hasGrant('tool', 'web')) plugins.push(webPlugin(this.credentials(), this.env.BROWSER))
    if (config.status !== 'setup' && this.store.hasGrant('tool', 'skills')) {
      plugins.push(skillsPlugin({
        granted: () => this.home().loadableSkills(config.ownerId, this.store.grants().skills),
        content: async (name) => this.store.grants().skills.includes(name) ? this.home().skillContent(config.ownerId, name) : null,
      }))
    }
    return plugins
  }

  // ---------------------------------------------------------------- browser (robot-l9te, robot-t0vc, robot-0eew)

  /** Browser Rendering in production; tests substitute a stub browser. */
  protected browserDriver(): BrowserDriver {
    return new RenderingDriver(this.env.BROWSER)
  }

  /** The Robot's one browser session, opened on first use with its saved cookies and storage. */
  protected page(): Promise<BrowserPage> {
    this.browserPage ??= this.browserDriver().open(this.store.get<BrowserState>('browser-state') ?? null).catch((error: unknown) => {
      this.browserPage = undefined
      throw error
    })
    return this.browserPage
  }

  async browserOpen(url: string): Promise<Observation> {
    if (!/^https?:\/\//.test(url)) throw new Error('only http and https URLs')
    const page = await this.page()
    await page.goto(url)
    return this.observed(page)
  }

  async browserObserve(): Promise<Observation> {
    return this.observed(await this.page())
  }

  async browserAct(action: BrowserAction): Promise<Observation> {
    const page = await this.page()
    if (action.action === 'click' || (action.action === 'type' && action.submit === true)) {
      // Payment stays with the owner (robot-ueh0): the final pay/order step is never clicked by a Robot.
      const target = (await page.observe()).elements.find((element) => element.index === action.index)
      if (target !== undefined && PAYMENT_STEP.test(target.label)) {
        throw new Error(`"${target.label}" looks like the payment or final order step. Stop here: tell your owner what is ready, or call browser_request_takeover so they pay themselves.`)
      }
    }
    await page.act(action)
    return this.observed(page)
  }

  async browserWait(input: { text?: string; ms?: number }): Promise<Observation> {
    const page = await this.page()
    await page.waitFor(input)
    return this.observed(page)
  }

  async browserScreenshot(): Promise<{ path: string }> {
    const page = await this.page()
    return this.saveScreen(await page.screenshot())
  }

  private async observed(page: BrowserPage): Promise<Observation> {
    const observation = await page.observe()
    await this.loadSecretMasks()
    return { ...observation, text: this.mask(observation.text) }
  }

  /** A screenshot becomes the panel's screen thumbnail (robot-ksvy). */
  protected async saveScreen(png: Uint8Array): Promise<{ path: string }> {
    const at = Date.now()
    const path = `screens/${new Date(at).toISOString().replace(/[:.]/g, '-')}.png`
    await this.run(this.workspace.write(path, png, 'image/png'))
    this.store.set('screen', { path, at })
    this.broadcast({ type: 'screen' })
    return { path }
  }

  /** End of the Turn: save the login state and the last picture, then free the browser. */
  protected async closeBrowser(): Promise<void> {
    const opening = this.browserPage
    if (opening === undefined) return
    this.browserPage = undefined
    const page = await opening.catch(() => undefined)
    if (page === undefined) return
    try {
      this.store.set('browser-state', await page.exportState())
      await this.saveScreen(await page.screenshot())
    } catch (error) {
      console.warn('browser state was not saved', error)
    } finally {
      await page.close()
    }
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
      // The chat shows what happened, not the instruction to the model.
      payload: { summary: approve ? (answered.kind === 'setup' ? 'Setup approved' : 'Approved') : 'Rejected' },
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
    if (proposal.kind === 'skill' && proposal.skill !== null) {
      const visibility = proposal.payload['visibility'] === 'private' ? 'private' : 'home'
      await this.home().publishSkill(this.store.requireConfig().ownerId, proposal.skill.name, proposal.skill.description, String(proposal.payload['content'] ?? ''), visibility)
      return
    }
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
        ...(config.kind === 'mr-robot' && patch.sharing !== undefined ? { sharing: 'private' as const } : {}),
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
    // A failed Turn waiting for "Try again" is a state, not a raw error in the list (robot-n7th).
    if (this.store.get('failed-wakeup') !== undefined) return 'blocked'
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
    const last = this.store.get('failed-wakeup') !== undefined
      ? { text: 'Could not finish its last task. Open to see why.', at: this.conversation().items.at(-1)?.at ?? Date.now() }
      : lastLine(this.conversation().items)
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
    const memberId = request.headers.get('x-member-id')
    if (memberId === null) return new Response('a viewer must be a Member', { status: 400 })
    this.ctx.acceptWebSocket(server, [memberId])
    server.serializeAttachment({ memberId, live: false } satisfies ViewerState)
    server.send(JSON.stringify({ type: 'changed', working: this.store.activeTurn() !== undefined }))
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') {
      socket.send('pong')
      return
    }
    if (typeof message !== 'string') return
    const viewer = socket.deserializeAttachment() as ViewerState
    let input: Record<string, unknown>
    try {
      input = JSON.parse(message) as Record<string, unknown>
    } catch {
      return
    }
    try {
      await this.viewerMessage(socket, viewer, input)
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
    }
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    socket.close(code === 1005 ? 1000 : code)
    // A Member who leaves without handing back releases the claim (another can take over).
    const viewer = socket.deserializeAttachment() as ViewerState | null
    const takeover = this.store.get<TakeoverState>('takeover')
    if (viewer !== null && takeover?.claimedBy === viewer.memberId && this.ctx.getWebSockets(viewer.memberId).length === 0) {
      this.store.set('takeover', { ...takeover, claimedBy: null })
    }
    await this.updateScreencast()
  }

  /** A removed Member's open views end now, not when they next reconnect. */
  async disconnectMember(memberId: string): Promise<void> {
    for (const socket of this.ctx.getWebSockets(memberId)) {
      try { socket.close(1008, 'access removed') } catch { /* already closing */ }
    }
    const takeover = this.store.get<TakeoverState>('takeover')
    if (takeover?.claimedBy === memberId) this.store.set('takeover', { ...takeover, claimedBy: null })
    await this.updateScreencast()
  }

  // ---------------------------------------------------------------- live view and takeover (robot-ksvy, robot-g6qb, robot-doqx, robot-j4ll)

  private async viewerMessage(socket: WebSocket, viewer: ViewerState, input: Record<string, unknown>): Promise<void> {
    // Access is checked on every message: sharing, removal and deletion apply to open sockets too.
    const access = await this.home().access(viewer.memberId, this.store.requireConfig().id)
    if (access === null) {
      socket.close(1008, 'access removed')
      return
    }
    const controlling = input['type'] !== 'live'
    if (controlling && access !== 'owner') throw new Error('only the owner takes over this browser')
    switch (input['type']) {
      case 'live':
        socket.serializeAttachment({ ...viewer, live: input['on'] !== false } satisfies ViewerState)
        await this.updateScreencast()
        return
      case 'claim': {
        const takeover = this.store.get<TakeoverState>('takeover')
        if (takeover === undefined) throw new Error('the Robot did not ask for a takeover')
        if (takeover.claimedBy !== null && takeover.claimedBy !== viewer.memberId) {
          socket.send(JSON.stringify({ type: 'claim-refused', heldBy: takeover.claimedBy }))
          return
        }
        this.store.set('takeover', { ...takeover, claimedBy: viewer.memberId })
        socket.serializeAttachment({ ...viewer, live: true } satisfies ViewerState)
        socket.send(JSON.stringify({ type: 'claimed' }))
        await this.updateScreencast()
        return
      }
      case 'tap': case 'text': case 'key': case 'scroll': {
        const takeover = this.store.get<TakeoverState>('takeover')
        if (takeover?.claimedBy !== viewer.memberId) throw new Error('claim the browser first')
        const cdp = await (await this.page()).cdp()
        if (cdp === undefined) throw new Error('the browser cannot take input')
        await forwardInput(cdp, input)
        return
      }
      case 'handback': {
        const takeover = this.store.get<TakeoverState>('takeover')
        if (takeover === undefined) return
        if (takeover.claimedBy !== null && takeover.claimedBy !== viewer.memberId) throw new Error('someone else holds the browser')
        await this.handBack(viewer.memberId)
        return
      }
    }
  }

  /** Relay a CDP screencast while anyone watches and the browser is open. */
  private async updateScreencast(): Promise<void> {
    const watchers = this.ctx.getWebSockets().filter((socket) => (socket.deserializeAttachment() as ViewerState | null)?.live === true)
    if (watchers.length === 0 || this.browserPage === undefined) {
      const running = this.screencast
      this.screencast = undefined
      await running?.stop()
      return
    }
    if (this.screencast !== undefined) return
    const cdp = await (await this.page()).cdp()
    if (cdp === undefined) return
    const onFrame = (frame: { data: string; sessionId: number; metadata: Record<string, number> }) => {
      const text = JSON.stringify({ type: 'frame', data: frame.data, metadata: frame.metadata })
      for (const socket of this.ctx.getWebSockets()) {
        if ((socket.deserializeAttachment() as ViewerState | null)?.live === true) {
          try { socket.send(text) } catch { /* closing */ }
        }
      }
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined)
    }
    cdp.on('Page.screencastFrame', onFrame as never)
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 })
    this.screencast = {
      stop: async () => {
        cdp.off('Page.screencastFrame', onFrame as never)
        await cdp.send('Page.stopScreencast').catch(() => undefined)
      },
    }
  }

  async requestTakeover(reason: string): Promise<{ status: string }> {
    const page = await this.page()
    this.store.set('browser-state', await page.exportState())
    await this.saveScreen(await page.screenshot())
    this.store.set('takeover', { reason, url: page.url(), requestedAt: Date.now(), claimedBy: null } satisfies TakeoverState)
    const config = this.store.requireConfig()
    await this.notifyMembers('needs you', `${reason} Tap to take over the browser.`)
    this.broadcast({ type: 'takeover', reason, url: `/#/r/${encodeURIComponent(config.id)}/takeover` })
    return { status: 'Your owner was asked to take over. End your Turn now with one short line; you will be woken when they hand the browser back.' }
  }

  /** The owner is done: the Robot resumes with a note of where the browser is now. */
  private async handBack(memberId: string): Promise<void> {
    // Claimed synchronously so a second hand-back arriving during the awaits below is a no-op.
    if (this.handingBack) return
    this.handingBack = true
    try {
      await this.completeHandBack(memberId)
    } finally {
      this.handingBack = false
    }
  }

  private async completeHandBack(memberId: string): Promise<void> {
    const page = await this.page()
    this.store.set('browser-state', await page.exportState())
    const { path } = await this.saveScreen(await page.screenshot())
    const takeover = this.store.get<TakeoverState>('takeover')
    this.store.delete('takeover')
    const running = this.screencast
    this.screencast = undefined
    await running?.stop()
    const member = await this.home().member(memberId)
    await this.wake({
      kind: 'takeover',
      sender: { kind: 'platform' },
      payload: { summary: `${member?.name ?? 'Your owner'} handed the browser back` },
      text: `${member?.name ?? 'Your owner'} handed the browser back after "${takeover?.reason ?? 'the takeover'}". The page is now ${page.url()}; a screenshot of it is at ${path}. Observe the page before you continue.`,
    })
    await this.changed()
  }

  takeoverState(): TakeoverState | null {
    return this.store.get<TakeoverState>('takeover') ?? null
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

  /** Further alarm times: the earliest Routine and the next outbox retry. */
  protected alarmCandidates(): number[] {
    const config = this.store.config()
    if (config === undefined || config.status === 'deleted') return []
    const outbox = this.store.sql.exec<{ at: number | null }>("SELECT MIN(next_attempt) AS at FROM outbox WHERE status = 'pending'").one().at
    return [...this.store.routines().flatMap((routine) => routine.nextRun === null ? [] : [routine.nextRun]), ...(outbox === null ? [] : [outbox])]
  }

  // ---------------------------------------------------------------- Robot messages (robot-bsvs, robot-mv15, robot-ppzu, robot-bjq5)

  /** The causal chain of the current Turn: inherited from a Robot message, or a new root. */
  private currentChain(): { id: string; hops: number } {
    const active = this.store.activeTurn()
    const wakeup = active === undefined ? undefined : this.store.wakeup(active.wakeupId)
    const chain = wakeup?.payload['chain'] as { id: string; hops: number } | undefined
    return chain ?? { id: `chain-${active?.wakeupId ?? 'none'}-${this.store.requireConfig().id}`, hops: 0 }
  }

  /** Recipients the Robot holds a Grant for, that its owner can still reach, and that are active. */
  async directory(): Promise<DirectoryEntry[]> {
    const config = this.store.requireConfig()
    const granted = new Set(this.store.grants().recipients)
    return (await this.home().reachable(config.ownerId))
      .filter((robot) => granted.has(robot.id) && robot.id !== config.id && robot.status === 'active')
      .map((robot) => ({ id: robot.id, name: robot.identity.name, description: robot.identity.description, availability: robot.fleetState }))
  }

  async sendRobotMessage(to: string, text: string, idempotencyKey: string): Promise<{ requestId: string; status: string }> {
    const config = this.store.requireConfig()
    if (!this.store.hasGrant('recipient', to)) throw new Error(`You have no Grant to message ${to}. Ask your owner with propose_grants (recipients).`)
    if (!(await this.directory()).some((entry) => entry.id === to)) throw new Error(`${to} is not available to you now`)
    const chain = this.currentChain()
    if (chain.hops + 1 > MAX_CHAIN_HOPS) throw new Error(`This chain of Robot messages is already ${chain.hops} hops long; finish it without delegating further.`)
    const id = `msg-${await digest(`${config.id}:${idempotencyKey}`)}`
    const existing = this.store.sql.exec<{ status: string }>('SELECT status FROM outbox WHERE id = ?', id).toArray()[0]
    if (existing !== undefined) return { requestId: id, status: existing.status === 'failed' ? 'failed earlier' : 'already sent' }
    await this.loadSecretMasks()
    const message: RobotMessage = {
      id,
      kind: 'request',
      from: { robotId: config.id, ownerId: config.ownerId, name: config.identity.name, avatarColor: config.identity.avatarColor },
      text: this.mask(text),
      requestId: id,
      chain: { id: chain.id, hops: chain.hops + 1 },
    }
    this.enqueueOutbox(to, message)
    this.ctx.waitUntil(this.deliverOutbox())
    return { requestId: id, status: 'sent; the reply will arrive as a message' }
  }

  async replyRobotMessage(handle: string, text: string): Promise<{ status: string }> {
    const config = this.store.requireConfig()
    const row = this.store.sql.exec<{ sender_robot: string; request_id: string; chain: number; used_at: number | null }>('SELECT * FROM reply_handle WHERE id = ?', handle).toArray()[0]
    if (row === undefined) throw new Error('unknown reply handle')
    if (row.used_at !== null) throw new Error('this request was already answered')
    await this.loadSecretMasks()
    this.store.sql.exec('UPDATE reply_handle SET used_at = ? WHERE id = ?', Date.now(), handle)
    this.enqueueOutbox(row.sender_robot, {
      id: `reply-${handle}`,
      kind: 'reply',
      from: { robotId: config.id, ownerId: config.ownerId, name: config.identity.name, avatarColor: config.identity.avatarColor },
      text: this.mask(text),
      requestId: row.request_id,
      chain: { id: this.currentChain().id, hops: row.chain },
    })
    this.ctx.waitUntil(this.deliverOutbox())
    return { status: 'reply sent' }
  }

  private enqueueOutbox(recipient: string, message: RobotMessage): void {
    this.store.sql.exec(
      "INSERT INTO outbox (id, recipient, payload, status, attempts, next_attempt, created_at) VALUES (?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT (id) DO NOTHING",
      message.id, recipient, JSON.stringify(message), Date.now(), Date.now(),
    )
  }

  /** Deliver pending outbox rows; a lost RPC is retried on the alarm, the recipient dedupes. */
  private async deliverOutbox(): Promise<void> {
    const pending = this.store.sql.exec<{ id: string; recipient: string; payload: string; attempts: number }>(
      "SELECT id, recipient, payload, attempts FROM outbox WHERE status = 'pending' AND next_attempt <= ? ORDER BY created_at", Date.now(),
    ).toArray()
    for (const row of pending) {
      const message = JSON.parse(row.payload) as RobotMessage
      try {
        const result: ReceiveResult = await this.env.ROBOT.getByName(row.recipient).receive(message)
        this.store.sql.exec('UPDATE outbox SET status = ?, attempts = attempts + 1 WHERE id = ?', result.accepted ? 'delivered' : 'failed', row.id)
        if (!result.accepted) {
          await this.wake({ kind: 'platform', sender: { kind: 'platform' }, text: `Your ${message.kind} to robot ${row.recipient} was not delivered: ${undeliverable(result.reason)}` })
        }
      } catch {
        const attempts = row.attempts + 1
        if (attempts >= 8) {
          this.store.sql.exec("UPDATE outbox SET status = 'failed', attempts = ? WHERE id = ?", attempts, row.id)
          await this.wake({ kind: 'platform', sender: { kind: 'platform' }, text: `Your ${message.kind} to robot ${row.recipient} could not be delivered after ${attempts} attempts.` })
        } else {
          this.store.sql.exec('UPDATE outbox SET attempts = ?, next_attempt = ? WHERE id = ?', attempts, Date.now() + 2 ** attempts * 1000, row.id)
        }
      }
    }
    await this.rearm()
  }

  /** A message from another Robot arrives (robot-ppzu): deduped, capped, and queued as a Wake-up. */
  async receive(message: RobotMessage): Promise<ReceiveResult> {
    const config = this.store.config()
    if (config === undefined || config.status === 'deleted' || config.status === 'setup') return { accepted: false, reason: 'unavailable' }
    if (this.store.sql.exec('SELECT 1 FROM intake WHERE key = ?', message.id).toArray().length > 0) return { accepted: true }
    if (message.kind === 'request' && message.chain.hops > MAX_CHAIN_HOPS) return { accepted: false, reason: 'chain-limit' }
    if (this.store.pendingWakeups() >= MAX_QUEUED_WAKEUPS) return { accepted: false, reason: 'queue-full' }
    const handle = message.kind === 'request' ? `rh-${crypto.randomUUID()}` : undefined
    this.store.transaction(() => {
      this.store.sql.exec('INSERT INTO intake (key, sender, received_at) VALUES (?, ?, ?)', message.id, message.from.robotId, Date.now())
      if (handle !== undefined) {
        this.store.sql.exec('INSERT INTO reply_handle (id, sender_robot, request_id, chain) VALUES (?, ?, ?, ?)', handle, message.from.robotId, message.requestId, message.chain.hops)
      }
      this.store.enqueue(
        'robot',
        { kind: 'robot', robotId: message.from.robotId, name: message.from.name, avatarColor: message.from.avatarColor },
        message.text,
        message.kind === 'request'
          ? { requestId: message.requestId, replyHandle: handle, chain: message.chain }
          : { replyTo: message.requestId, chain: message.chain },
        Date.now(),
      )
    })
    this.drain()
    return { accepted: true }
  }

  // ---------------------------------------------------------------- Mr. Robot (robot-hk2s)

  async createRobot(brief: string): Promise<{ id: string; status: string }> {
    const config = this.store.requireConfig()
    if (config.kind !== 'mr-robot') throw new Error('only Mr. Robot creates Robots')
    const entry = await this.home().createRobot(config.ownerId, brief)
    return { id: entry.id, status: 'created; it is interviewing your owner in its own Conversation and will propose its Grants there' }
  }

  async configureRobot(id: string, change: { name?: string; title?: string; description?: string }): Promise<{ id: string; identity: unknown }> {
    const config = this.store.requireConfig()
    if (config.kind !== 'mr-robot') throw new Error('only Mr. Robot configures Robots')
    const entry = await this.home().entry(id)
    if (entry === undefined || entry.ownerId !== config.ownerId || entry.kind !== 'robot' || entry.status === 'deleted') throw new Error(`${id} is not one of your owner's Robots`)
    const identity = { ...entry.identity, ...Object.fromEntries(Object.entries(change).filter(([, value]) => typeof value === 'string' && value.trim() !== '')) }
    const settings = await this.env.ROBOT.getByName(id).updateSettings({ identity })
    return { id, identity: settings.identity }
  }

  // ---------------------------------------------------------------- Routines (robot-gbbt, robot-qyd5)

  /** Pause keeps the Routine and its schedule but stops its alarm; resume plans the next run from now (robot-qhll). */
  async pauseRoutine(id: string, paused: boolean): Promise<RoutineView> {
    const config = this.store.requireConfig()
    const routine = this.store.routine(id)
    if (routine === undefined) throw new Error('no such Routine')
    const now = Date.now()
    const next = paused ? null : nextRun(routine.schedule, routine.timeZone, now, routine.createdAt)
    const saved = { ...routine, paused, nextRun: next }
    this.store.saveRoutine(saved)
    await this.rearm()
    await this.changed()
    return routineView(config.id, saved, this.store.routineRuns(id))
  }

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
      paused: false,
      createdAt: now,
    }
    this.store.saveRoutine(routine)
    this.routinesChanged()
    return routineView(config.id, routine, this.store.routineRuns(routine.id))
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
    return routineView(config.id, routine, this.store.routineRuns(routine.id))
  }

  deleteRoutine(id: string): RoutineView {
    const config = this.store.requireConfig()
    const existing = this.store.routine(id)
    if (existing === undefined) throw new Error(`no Routine ${id}`)
    this.store.deleteRoutine(id)
    this.routinesChanged()
    return routineView(config.id, existing, this.store.routineRuns(existing.id))
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

/**
   * The live session's DSH events exactly as stored (every field, including surfaceOp), secrets
   * masked, for the DSH trajectory view (ticket 22). Pages backwards with before, forwards with after.
   */
  async sessionEvents(input: { before?: number; after?: number; limit?: number }): Promise<{ events: string; hasMore: boolean; sessionId: string }> {
    const config = this.store.requireConfig()
    await this.loadSecretMasks()
    const limit = Math.min(Math.max(input.limit ?? 400, 1), 2000)
    const rows = input.after !== undefined
      ? this.ctx.storage.sql.exec<{ seq: number; event: string }>('SELECT seq, event FROM session_event WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?', config.liveSessionId, input.after, limit).toArray()
      : this.ctx.storage.sql.exec<{ seq: number; event: string }>('SELECT seq, event FROM session_event WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?', config.liveSessionId, input.before ?? Number.MAX_SAFE_INTEGER, limit).toArray().reverse()
    const first = rows[0]?.seq
    const hasMore = first !== undefined && first > 0 && input.after === undefined
    // Events cross the RPC boundary as one JSON text (deep JSON types do not survive RPC typing).
    return { events: `[${rows.map((row) => this.mask(row.event)).join(',')}]`, hasMore, sessionId: config.liveSessionId }
  }

  async trajectoryMasked(): Promise<Trajectory> {
    await this.loadSecretMasks()
    return this.trajectoryView()
  }

  conversation(): Conversation {
    const config = this.store.requireConfig()
    const events = readStoredEvents(this.ctx.storage.sql, config.liveSessionId)
    const items = projectChat({
      events,
      notices: this.store.notices(config.liveSessionId),
      proposal: (id) => {
        const row = this.store.proposal(id)
        return row === undefined ? undefined : proposalView(row)
      },
    })
    // A proposal made inside a code-mode program has no direct tool result to project from; an open
    // proposal is always shown as a question so the owner can answer it (robot-vy9z).
    const shown = new Set(items.flatMap((item) => (item.kind === 'question' ? [item.proposal.id] : [])))
    for (const row of this.store.proposals('open')) {
      if (shown.has(row.id)) continue
      const position = items.findLastIndex((item) => item.at <= row.createdAt) + 1
      items.splice(position, 0, { kind: 'question', id: `proposal-${row.id}`, seq: items[position - 1]?.seq ?? 0, at: row.createdAt, proposal: proposalView(row) })
    }
    const working = this.store.activeTurn() !== undefined
    const activity = working ? runningTool(events) : undefined
    return {
      canRetry: this.store.get('failed-wakeup') !== undefined,
      robotId: config.id,
      working,
      items,
      ...(activity === undefined ? {} : { activity }),
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

  /** Replace secret values with a mask (robot-4zi6); stored history is already redacted at write. */
  protected mask(text: string): string {
    return maskSecrets(text, [...this.secretValues, ...this.turnSecrets])
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
    this.turnSecrets = [...this.turnSecrets.filter(([known]) => known !== name), [name, value]]
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

    await this.releaseComposition()
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
      // The notice below tells the owner; the instruction itself stays out of the chat.
      summary: '',
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
    await this.releaseComposition()
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
      takeover: (() => {
        const takeover = this.store.get<TakeoverState>('takeover')
        return takeover === undefined ? null : { reason: takeover.reason, claimedBy: takeover.claimedBy }
      })(),
    }
  }

  protected routineViews(): RoutineView[] {
    const id = this.store.requireConfig().id
    return this.store.routines().map((routine) => routineView(id, routine, this.store.routineRuns(routine.id)))
  }

  /** Filled by the browser and usage tickets. */

  protected screen(): ScreenView | null {
    const screen = this.store.get<{ path: string; at: number }>('screen')
    if (screen === undefined) return null
    const id = this.store.requireConfig().id
    return { path: screen.path, at: screen.at, url: `/api/robots/${encodeURIComponent(id)}/screen?at=${screen.at}` }
  }

  /** The latest screenshot's Workspace path (the thumbnail). */
  screenPath(): string | null {
    return this.store.get<{ path: string }>('screen')?.path ?? null
  }

  protected usage(): UsageView {
    const month = currentMonth()
    return { month, ...this.store.usage(month), limitUsd: this.store.requireConfig().spendLimitUsd }
  }

  /** Names of the tools the current composition registers (what the model may call). */
  toolNames(): string[] {
    return this.tools(this.store.requireConfig()).map((tool) => tool.name)
  }

  /** One row of the admin fleet list, from the DO itself (robot-x26m). */
  adminRow(): { fleetState: FleetState; status: RobotConfig['status']; grants: GrantSet; model: ModelChoice; usage: UsageView; routines: RoutineView[] } | null {
    const config = this.store.config()
    if (config === undefined) return null
    return { fleetState: this.fleetState(), status: config.status, grants: this.store.grants(), model: config.model, usage: this.usage(), routines: this.routineViews() }
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

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...bytes.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function undeliverable(reason: 'unavailable' | 'queue-full' | 'chain-limit'): string {
  return reason === 'unavailable' ? 'that Robot is not active' : reason === 'queue-full' ? 'that Robot has too much queued work; try later' : 'the chain of Robot messages is too long'
}

interface ViewerState {
  readonly memberId: string
  readonly live: boolean
}

export interface TakeoverState {
  readonly reason: string
  readonly url: string
  readonly requestedAt: number
  readonly claimedBy: string | null
}

/** Taps, text, keys and scrolls from the owner's device become CDP input (robot-g6qb). */
async function forwardInput(cdp: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }, input: Record<string, unknown>): Promise<void> {
  const x = Number(input['x'] ?? 0)
  const y = Number(input['y'] ?? 0)
  switch (input['type']) {
    case 'tap':
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      return
    case 'text':
      await cdp.send('Input.insertText', { text: String(input['text'] ?? '') })
      return
    case 'key': {
      const key = String(input['key'] ?? 'Enter')
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: KEY_CODES[key] ?? 0 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: KEY_CODES[key] ?? 0 })
      return
    }
    case 'scroll':
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: Number(input['dy'] ?? 0) })
      return
  }
}

const KEY_CODES: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }

/** The tool running now: the latest call without a result (a code program's latest inner call wins). */
function runningTool(events: ReadonlyArray<{ type: string; data: unknown }>): string | undefined {
  const open = new Map<string, string>()
  let inner: string | undefined
  for (const event of events) {
    const data = event.data as Record<string, unknown>
    if (event.type === 'tool/call') open.set(String(data['callId']), String(data['name']))
    else if (event.type === 'tool/ptc-dispatch') inner = String(data['name'])
    else if (event.type === 'tool/result') {
      const message = data['message'] as { toolCallId?: string } | undefined
      open.delete(String(message?.toolCallId))
      inner = undefined
    }
  }
  const last = [...open.values()].at(-1)
  return last === undefined ? undefined : last === 'run_code' ? (inner ?? 'code') : last
}

/** Labels of the final payment or order step, in English and Polish. */
const PAYMENT_STEP = /\b(pay( now)?|place (your )?order|buy now|complete (purchase|order)|confirm (and pay|payment|purchase)|submit order)\b|zapłać|płacę|kupuję|kupuj i płać|zamawiam|złóż zamówienie|potwierdzam (zakup|płatność)|przejdź do płatności/i

function routineView(robotId: string, routine: RoutineRow, runs: RoutineView['runs']): RoutineView {
  return {
    id: routine.id, name: routine.name, prompt: routine.prompt, schedule: routine.schedule, timeZone: routine.timeZone,
    nextRun: routine.nextRun, lastRun: routine.lastRun, paused: routine.paused, robotId,
    summary: describeSchedule(routine.schedule, routine.timeZone),
    cron: cronOf(routine.schedule, routine.timeZone),
    runs,
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
    // A failure notice is shown in the conversation; the list keeps the last real line.
    if (item.kind === 'notice' && !item.text.startsWith('The Turn failed')) return { text: item.text, at: item.at }
    if (item.kind === 'question') return { text: item.proposal.purpose, at: item.at }
  }
  return undefined
}