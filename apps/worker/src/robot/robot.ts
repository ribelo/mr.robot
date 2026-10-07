/**
 * A Robot: one Durable Object, one endless Conversation (robot-ifp6, robot-frf5).
 *
 * Every Wake-up is queued in SQLite and drained one Turn at a time (robot-makt). The Turn
 * is driven by the DO, not by the request that caused it, so a closed tab does not stop it
 * (robot-p9jm). The active Turn is recorded before it starts and a heartbeat alarm stays
 * armed while it runs; if the DO dies mid-Turn, the alarm brings it back and the
 * interrupted Turn resumes from the last persisted event.
 */
import { exaAgentTools, exaResearchTools } from '../agent/exa.ts'
import { entryMatches, type LoginEntry } from '../platform/logins.ts'
import { DurableObject } from 'cloudflare:workers'
import * as Effect from 'effect/Effect'
import { LlmError, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { OpencodePool } from '../providers/opencode-go.ts'
import { buildForkSeed, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  HostView,
  WorkspaceFileContent,
  WorkspaceFileView,
  Attachment,
  BrowserBackend,
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
import type { RobotHost, WorkspaceHost } from '../agent/host.ts'
import { AlarmSchedule, dueDelivery, schedulePlugin, SCHEDULE_TOOL_NAMES, type ScheduleTask } from '../agent/schedule.ts'
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
import { skillFrontmatter, skillProposalTools, skillsPlugin } from '../agent/skills.ts'
import { browserTools, type BrowserHost, type ScreenshotImage } from '../agent/tools/browser.ts'
import { takeoverTools, type TakeoverHost } from '../agent/tools/takeover.ts'
import { fanOut, type ChannelAdapter, type ChannelOutput, type InboundEvent } from '../channels/channel.ts'
import { PwaChannel } from '../channels/pwa.ts'
import { backendLabel, browserCost, driverFor } from '../browser/backends.ts'
import { hostTools } from '../agent/tools/host.ts'
import { type BrowserAction, type BrowserDriver, type BrowserPage, type BrowserState } from '../browser/driver.ts'
import type { Observation } from '../browser/observe.ts'
import type { MemberFileName } from '../member/member.ts'
import { dailyNotePaths, PERSONA_FILES, personaText, type PersonaSnapshot } from '../workspace/persona.ts'
import { ROBOT_FILES } from '../workspace/templates.ts'
import { makeWorkspace, type WorkspaceShape } from '../workspace/workspace.ts'
import { HOME_ID, type Env } from '../env.ts'
import { currentMonth, type RegistryEntry } from '../home/home.ts'
import { projectChat } from './projection.ts'
import { cronOf, describeSchedule, nextRun, validateSchedule } from './schedule.ts'
import * as Layer from 'effect/Layer'
import { DurableRuntime } from '../platform/durable.ts'
import * as Programs from './programs.ts'
import * as Views from './views.ts'
import * as Browse from './browsing.ts'
import { Browsing } from './browsing.ts'
import { MR_ROBOT_COMPACTION, proposalView, RobotPlatform, RobotState, routineView, type AnswerResult, type ReceiveResult, type RobotMessage, type WakeInput } from './programs.ts'
export type { AnswerResult, ReceiveResult, RobotMessage, WakeInput } from './programs.ts'
import { RobotStore, type ProposalRow, type RobotConfig, type RoutineRow, type Wakeup, type WakeupKind } from './store.ts'

export { DEFAULT_CONTEXT_BUDGET } from './programs.ts'

export type { RobotInit } from './programs.ts'
import type { RobotInit } from './programs.ts'

export class Robot extends DurableObject<Env> implements RobotHost, WorkspaceHost, NotifyHost, SecretHost, MessagingHost, RobotsHost, BrowserHost, TakeoverHost {
  protected readonly store: RobotStore
  private composition: { readonly revision: number; readonly value: Composition; readonly scope: Scope.Closeable } | undefined
  private pumping: Promise<void> | undefined
  private persona: PersonaSnapshot = { files: [], soul: '' }
  private browserPage: Promise<BrowserPage> | undefined
  private screencast: { stop: () => Promise<void> } | undefined
  /** The wake-up a Turn is being started for, so a failure before the Turn begins can still be retried. */
  private starting: Wakeup | undefined
  private handingBack = false
  /** The hosts this Robot's owner reaches, refreshed each Turn (names for tools and labels). */
  private knownHosts: HostView[] = []
  /** The kind of the wake-up the running Turn serves. */
  private currentWakeup: string | undefined
  /** The browser was opened for a viewer (live view or takeover), not by a Turn (rb-keaw). */
  private openedForViewer = false
  /** Values of granted secrets, kept only in memory to mask views (never stored by the Robot). */
  private secretValues: Array<readonly [string, string]> = []
  /** Secret values fetched during the running Turn; redacted from everything stored. */
  private turnSecrets: Array<readonly [string, string]> = []
  /** backend|host pairs that showed a block page in the running Turn. */
  private readonly blockedThisTurn = new Set<string>()
  private pendingSeed: { readonly sessionId: string; readonly events: readonly SessionEvent[]; readonly inheritedEventCount: number; readonly parentSession: string } | undefined

  private readonly runtime: DurableRuntime<RobotState | RobotPlatform>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new RobotStore(ctx.storage)
    // An existing Mr. Robot gets the default compaction instruction once, unless one was set (rb-yagl).
    const existing = this.store.config()
    if (existing?.kind === 'mr-robot' && this.store.get('mr-compaction-default') === undefined) {
      if (existing.compactionInstruction.trim() === '') this.store.saveConfig({ ...existing, compactionInstruction: MR_ROBOT_COMPACTION, revision: existing.revision + 1 })
      this.store.set('mr-compaction-default', true)
    }
    // The Robot's state programs (programs.ts) run on Effect; this class adapts them to RPC,
    // the alarm and DSH's agent loop.
    this.runtime = new DurableRuntime(Layer.mergeAll(
      Layer.succeed(RobotState)(this.store),
      Layer.succeed(RobotPlatform)({
        env,
        rearm: () => Effect.promise(() => this.rearm()),
        changed: () => Effect.promise(() => this.changed()),
        drain: () => Effect.sync(() => this.drain()),
        background: (work) => Effect.sync(() => this.ctx.waitUntil(this.program(work))),
        masker: () => Effect.promise(async () => {
          await this.loadSecretMasks()
          return (text: string) => this.mask(text)
        }),
        mask: (text) => Effect.promise(async () => {
          await this.loadSecretMasks()
          return this.mask(text)
        }),
        stopWatching: () => Effect.promise(() => this.stopWatching()),
        setAlarm: (at) => Effect.promise(() => (at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at))),
        seedWorkspace: () => Effect.promise(() => this.seedWorkspace()),
        notifyMembers: (kind, body) => Effect.promise(() => this.notifyMembers(kind, body).catch(() => 0)),
        rememberSecret: (name, value) => Effect.sync(() => this.remember(name, value)),
        working: () => Effect.sync(() => this.store.activeTurn() !== undefined || this.pumping !== undefined),
        releaseAgent: () => Effect.promise(() => this.releaseComposition()),
        seedSession: (sessionId, seed, note) => Effect.promise(async () => {
          this.pendingSeed = { sessionId, ...seed }
          const { agent, ctx } = await this.agent()
          // The notice the program adds tells the owner; the instruction itself stays out of the chat.
          agent.inject(wakeupMessage({ sender: { kind: 'platform' }, text: note, summary: '' }))
          await ctx.sessions.flush(agent.session)
        }),
      }),
    ))
  }

  /** Run one of the Robot's Effect programs; typed failures reach the caller as Errors with a status. */
  protected program<A, E>(program: Effect.Effect<A, E, RobotState | RobotPlatform>): Promise<A> {
    return this.runtime.run(program as Effect.Effect<A, never, RobotState | RobotPlatform>)
  }

  // ---------------------------------------------------------------- lifecycle (robot-qo06)

  create(init: RobotInit): Promise<RobotConfig> {
    return this.program(Programs.create(init))
  }


  pause(): Promise<void> {
    return this.program(Programs.pause)
  }


  resume(): Promise<void> {
    return this.program(Programs.resume)
  }


  /** Delete: no more Wake-ups and gone from every list; the log and Workspace are kept as the archive. */
  remove(): Promise<void> {
    return this.program(Programs.remove)
  }


  // ---------------------------------------------------------------- wake-ups

  /** Queue a Wake-up and make sure the queue is being drained. */
  wake(input: WakeInput): Promise<number> {
    return this.program(Programs.wake(input))
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
  retry(): Promise<boolean> {
    return this.program(Views.retry)
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
      skills: config.status === 'setup' ? [] : [...this.store.effectiveGrants().skills],
    }
  }

  /** Resolves once no Turn is running and nothing runnable is queued. */
  async settled(): Promise<void> {
    while (this.pumping !== undefined) await this.pumping
  }

  override async alarm(): Promise<void> {
    const config = this.store.config()
    if (config !== undefined && config.status !== 'deleted') await this.fireRoutines(Date.now())
    if (config !== undefined && config.status !== 'deleted') await this.checkWatch(Date.now()).catch((error: unknown) => console.warn('screen watch failed', error))
    if (config !== undefined) await this.deliverOutbox()
    if (this.store.activeTurn() !== undefined || this.store.pendingWakeups() > 0) this.drain()
    await this.rearm()
  }

  /**
   * Due Routines become Wake-ups. However many occurrences were missed while the Robot was
   * down, each due Routine runs once (robot-v1gb), and its next run is computed from now.
   */
  /**
   * Due DSH schedule records become wake-ups with DSH's own framing; a recurring one contributes
   * only its latest missed occurrence and advances to a future target, a one-shot ends (robot-v1gb).
   */
  private fireRoutines(now: number): Promise<void> {
    return this.program(Programs.fireRoutines(now))
  }


  /** ctx.schedule over the routine table: DSH's records, stored here, fired by the alarm. */
  private schedule(): AlarmSchedule {
    const store = this.store
    return new AlarmSchedule({
      tasks: () => store.routines().map((routine): ScheduleTask => ({ record: routine.record, sessionId: routine.sessionId, active: routine.paused || routine.nextRun !== null })),
      save: (task) => {
        const existing = store.routine(task.record.id)
        const timeZone = 'timeZone' in task.record ? task.record.timeZone : store.requireConfig().timeZone
        store.saveRoutine({
          id: task.record.id, name: task.record.title, prompt: task.record.prompt, schedule: existing?.schedule ?? { kind: 'once', at: task.record.scheduledAt },
          timeZone, nextRun: existing?.paused === true ? null : Date.parse(task.record.scheduledAt), lastRun: existing?.lastRun ?? null,
          createdAt: existing?.createdAt ?? Date.now(), paused: existing?.paused ?? false, record: task.record, sessionId: task.sessionId,
        })
      },
      remove: (id) => store.deleteRoutine(id),
      changed: () => this.ctx.waitUntil(this.rearm().then(() => this.changed())),
    })
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
      // While a takeover is pending the Robot waits for the hand-back; later wake-ups queue behind it (robot-doqx).
      if (active === undefined && this.store.get('takeover') !== undefined) return
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
    this.currentWakeup = wakeup.kind
    // Hosts and Mr. Robot's reach decide which tools exist, so they are known before the composition.
    await this.refreshReach().catch((error: unknown) => console.warn('reach not refreshed', error))
    const { agent, ctx } = await this.agent()
    await this.refreshPersona()
    if (!resuming) {
      const startSeq = storedLength(this.ctx.storage.sql, agent.session.id)
      this.store.beginTurn(wakeup.id, agent.session.id, startSeq, Date.now())
      this.store.set(`turn-start:${wakeup.id}`, startSeq)
      // Files the owner edited since the last Turn: the Robot must not overwrite them from stale context (rb-xwks).
      const edits = this.store.get<string[]>('owner-edits') ?? []
      if (edits.length > 0) {
        this.store.delete('owner-edits')
        agent.followup(wakeupMessage({ sender: { kind: 'platform' }, text: `Your owner edited ${edits.join(', ')} in your Workspace since your last Turn. Read the current version before you rely on or change it.`, summary: '' }))
      }
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
    // A block is remembered for its own Turn only (rb-kank).
    this.blockedThisTurn.clear()
    this.store.endTurn(wakeup.id)
    await this.afterTurn(wakeup)
    await this.rearm()
    await this.changed()
  }

  /** Platform duties once a Turn ends: SOUL.md changes, and the hooks of later tickets. */
  protected async afterTurn(wakeup: Wakeup): Promise<void> {
    if (this.store.get('takeover') === undefined) {
      // Someone is watching the screen: the browser stays open for them and closes when they leave (rb-keaw).
      if (this.liveWatchers() > 0 && this.browserPage !== undefined) this.openedForViewer = true
      else if (this.store.requireConfig().wakeOnScreenNotifications === true) await this.keepWatching()
      else await this.closeBrowser()
    }
    const startSeq = this.store.get<number>(`turn-start:${wakeup.id}`) ?? 0
    this.store.delete(`turn-start:${wakeup.id}`)
    await this.accountTurn(startSeq)
    const failedTurn = this.rememberFailure(wakeup, startSeq)
    const shown = (item: ChatItem) => item.kind !== 'message' || item.reaction !== null || item.sender.kind !== 'member'
    if (!failedTurn && wakeup.kind !== 'routine' && !(await this.conversation()).items.some((item) => item.seq >= startSeq && shown(item))) {
      // A Turn that ends with nothing to show (e.g. a reasoning model spent its output cap thinking) is not silent.
      const config = this.store.requireConfig()
      this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `${config.identity.name} finished without a reply. If this repeats, raise its context budget in Advanced settings.`, Date.now())
    }
    if (wakeup.kind === 'routine') {
      const reply = (await this.conversation()).items.filter((item) => item.seq >= startSeq && item.kind === 'reply').at(-1)
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
    const replies = (await this.conversation()).items.filter((item) => item.seq >= startSeq && item.kind === 'reply')
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
    for (const item of (await this.conversation()).items) {
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
  private checkLimits(): Promise<boolean> {
    return this.program(Programs.checkLimits)
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
      ...(contextWindow === undefined ? {} : { modelWindow: contextWindow }),
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
      images: async (id) => {
        const image = await this.screenshotImage(id)
        return image === undefined ? undefined : { mediaType: image.mediaType, base64: image.base64 }
      },
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
    for (const group of this.store.effectiveGrants().tools.filter(isToolGroup)) tools.push(...this.groupTools(group, config))
    // Host files and shell follow the per-host grants, not a tool group (hs-5ktw).
    const hostGrants = this.store.effectiveGrants().hosts ?? []
    const names = (kind: string) => hostGrants.filter((grant) => grant.endsWith(`:${kind}`)).map((grant) => this.knownHosts.find((host) => `${host.id}:${kind}` === grant)?.name ?? grant.slice(0, -kind.length - 1))
    tools.push(...hostTools(this, { files: names('files'), shell: names('shell') }))
    return tools
  }

  /** Tools of one granted group. Groups whose tools come from a DSH plugin are mounted in plugins(). */
  protected groupTools(group: ToolGroup, config: RobotConfig): ToolDefinition[] {
    switch (group) {
      case 'files': return fileTools(this)
      // DSH's schedule tools, attached by schedulePlugin (see plugins()).
      case 'routines': return []
      case 'notify': return notifyTools(this)
      case 'secrets': return secretTools(this, this.store.effectiveGrants().secrets)
      case 'messaging': return messagingTools(this)
      case 'skills': return skillProposalTools(this)
      case 'browser': return [...browserTools(this), ...takeoverTools(this)]
      case 'robots': return config.kind === 'mr-robot' ? robotsTools(this) : []
      case 'exa': return exaResearchTools(this)
      case 'exa-agent': return exaAgentTools(this)
      default: return []
    }
  }

  /** Seam plugins for granted groups (DSH web, skills). */
  protected plugins(config: RobotConfig): Array<(ctx: import('@deepseek-ai/cordis').Context) => Promise<void>> {
    const plugins: Array<(ctx: import('@deepseek-ai/cordis').Context) => Promise<void>> = [credentialsPlugin(this.credentials())]
    // Setup may write its own persona files; afterwards only a files Grant gives the file tools.
    if (config.status === 'setup' || this.store.mayUse('tool', 'files')) plugins.push(filesPlugin(this.workspace, (name) => this.memberFile(name)))
    if (config.status !== 'setup' && this.store.mayUse('tool', 'browser')) plugins.push(browserUsePlugin())
    if (config.status !== 'setup' && this.store.mayUse('tool', 'web')) plugins.push(webPlugin(this.credentials(), this.env.BROWSER))
    if (config.status !== 'setup' && this.store.mayUse('tool', 'routines')) plugins.push(schedulePlugin(this.schedule()))
    if (config.status !== 'setup' && this.store.mayUse('tool', 'skills')) {
      plugins.push(skillsPlugin({
        granted: () => this.home().loadableSkills(config.ownerId, this.store.effectiveGrants().skills),
        content: async (name) => this.store.effectiveGrants().skills.includes(name) ? this.home().skillContent(config.ownerId, name) : null,
        local: () => this.localSkills(),
        localContent: (name) => this.run(this.workspace.readText(`skills/${name}/SKILL.md`)).then((text) => text ?? null),
      }))
    }
    return plugins
  }

  // ---------------------------------------------------------------- browser (robot-l9te, robot-t0vc, robot-0eew)

  /** The driver for a browser backend (rb-wgtd); tests substitute a stub browser. */
  protected browserDriver(backend: BrowserBackend): BrowserDriver {
    return driverFor(backend, this.env, {
      id: this.store.requireConfig().id,
      vpnConfig: () => this.home().vpnConfig(),
      proxyConfig: () => this.home().proxyConfig(),
      hostBrowser: {
        open: async (hostId) => {
          const owner = await this.hostOwnerStub(hostId)
          const session = await this.hostCall(() => owner.hostBrowserOpen(hostId, this.store.requireConfig().id, this.store.requireConfig().identity.name))
          const response = await owner.fetch(new Request(`https://member/host/relay?session=${encodeURIComponent(session)}&side=robot`, { headers: { Upgrade: 'websocket' } }))
          if (response.webSocket === null) throw new Error(`the host browser relay refused (${response.status})`)
          return { socket: response.webSocket, session }
        },
        close: async (hostId, session) => {
          await (await this.hostOwnerStub(hostId)).hostBrowserClose(hostId, this.store.requireConfig().id, session)
        },
      },
    })
  }

  // ---------------------------------------------------------------- Hosts (v1.2)

  /** For the host owner's Member DO: who this Robot is and whether it holds the grant (hs-5ktw, hs-44cm). */
  async hostAccess(hostId: string, grant: 'browser' | 'files' | 'shell'): Promise<{ ownerId: string; name: string; granted: boolean; mrRobot: boolean }> {
    const config = this.store.requireConfig()
    return { ownerId: config.ownerId, name: config.identity.name, granted: this.store.hasGrant('host', `${hostId}:${grant}`), mrRobot: config.kind === 'mr-robot' }
  }

  private async hostOwnerStub(hostId: string) {
    const owner = await this.home().hostOwner(hostId)
    if (owner === null) throw Object.assign(new Error(`there is no host ${hostId} any more`), { name: 'HostOffline' })
    return this.env.MEMBER.getByName(owner)
  }

  /** A host the Robot names, by name or id, among those its owner reaches. */
  private async resolveHost(name: string): Promise<HostView> {
    const hosts = await this.home().hostsFor(this.store.requireConfig().ownerId)
    const found = hosts.find((host) => host.id === name) ?? hosts.find((host) => host.name.toLowerCase() === name.trim().toLowerCase())
    if (found === undefined) throw new Error(`no host named "${name}"; your owner's hosts: ${hosts.map((host) => host.name).join(', ') || 'none'}`)
    return found
  }

  /** Host calls fail clearly (hs-bfr8); a Routine that hits an offline host tells the owner (hs-nwcl). */
  private async hostCall<A>(call: () => Promise<A>): Promise<A> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof Error && error.name === 'HostOffline' && this.currentWakeup === 'routine') {
        await this.notifyMembers('needs you', `could not finish a routine: ${error.message}. Start the Mr. Robot app on that computer.`).catch(() => 0)
      }
      throw error instanceof Error && error.name === 'HostOffline' ? new Error(`${error.message}. Tell your owner the computer needs to be on with the Mr. Robot app running; do not switch to a cloud browser.`) : error
    }
  }

  async hostRead(name: string, path: string): Promise<unknown> {
    const host = await this.resolveHost(name)
    const result = await this.hostCall(async () => (await this.hostOwnerStub(host.id)).hostRead(host.id, this.store.requireConfig().id, path))
    return { host: host.name, ...result }
  }

  async hostWrite(name: string, path: string, content: string, encoding: 'text' | 'base64'): Promise<unknown> {
    const host = await this.resolveHost(name)
    const result = await this.hostCall(async () => (await this.hostOwnerStub(host.id)).hostWrite(host.id, this.store.requireConfig().id, encoding === 'base64' ? { path, base64: content } : { path, text: content }))
    return { host: host.name, ...result }
  }

  async hostRun(name: string, command: string, cwd: string | undefined, timeoutSeconds: number | undefined): Promise<unknown> {
    const host = await this.resolveHost(name)
    const timeoutMs = Math.min(Math.max(timeoutSeconds ?? 120, 1), 600) * 1000
    const result = await this.hostCall(async () => (await this.hostOwnerStub(host.id)).hostRun(host.id, this.store.requireConfig().id, { command, ...(cwd === undefined ? {} : { cwd }), timeoutMs }))
    return { host: host.name, command, ...result }
  }

  /** This Robot's backend: its own choice, else the Home default (rb-ybt4). */
  private async chosenBackend(): Promise<BrowserBackend> {
    return this.store.requireConfig().browserBackend ?? (await this.home().settings()).defaultBrowserBackend
  }

  /** The backend of the session that is open now (attached or left running). */
  private sessionBackend(): BrowserBackend {
    return this.store.get<BrowserSession>('browser-session')?.backend ?? 'browser-run'
  }

  /**
   * Browser time into usage and spend limits, per backend (rb-y50l): from the session's start
   * (or the last account) until now. A session left running for screen watching is billed too.
   */
  private async accountBrowser(end: boolean): Promise<void> {
    const session = this.store.get<BrowserSession>('browser-session')
    if (session === undefined) return
    const now = Date.now()
    const ms = now - session.since
    if (ms > 0) {
      const config = this.store.requireConfig()
      const month = currentMonth()
      const cost = browserCost(session.backend, ms)
      this.store.addBrowserUsage(month, session.backend, ms, cost)
      this.store.addUsage(month, 0, 0, cost)
      await this.env.MEMBER.getByName(config.ownerId).addUsage(month, config.id, 0, 0, cost).catch(() => undefined)
    }
    if (end) this.store.delete('browser-session')
    else this.store.set('browser-session', { ...session, since: now } satisfies BrowserSession)
  }

  /** The Robot's one browser session: the watched one if it still runs, else a new one with saved cookies and storage. */
  protected page(): Promise<BrowserPage> {
    this.browserPage ??= this.resumeBrowser().catch((error: unknown) => {
      this.browserPage = undefined
      throw error
    })
    return this.browserPage
  }

  private async resumeBrowser(): Promise<BrowserPage> {
    const takeover = this.store.get<TakeoverState>('takeover')
    const watch = this.store.get<WatchState>('watch')
    const sessionId = watch?.sessionId ?? takeover?.sessionId
    const backend = await this.chosenBackend()
    // A session left running is reused only on the backend now chosen; a change applies on the next open.
    const attached = sessionId === undefined || this.sessionBackend() !== backend ? undefined : await this.browserDriver(backend).attach(sessionId)
    if (attached !== undefined) {
      if (this.store.get('browser-session') === undefined) this.store.set('browser-session', { backend, since: Date.now() } satisfies BrowserSession)
      return attached
    }
    await this.accountBrowser(true)
    // A new session with the saved cookies and storage (they follow the Robot across backends), back on the page it was on.
    const reopened = await this.browserDriver(backend).open(this.store.get<BrowserState>('browser-state') ?? null)
    this.store.set('browser-session', { backend, since: Date.now() } satisfies BrowserSession)
    const url = watch?.url ?? takeover?.url ?? this.store.get<string>('browser-url')
    if (url?.startsWith('http') === true) await reopened.goto(url).catch(() => undefined)
    return reopened
  }

  // ---------------------------------------------------------------- wake on screen notifications (robot-lulc)

  /** End of a Turn with the setting on: save state, leave the browser running, check it every minute. */
  protected async keepWatching(): Promise<void> {
    const opening = this.browserPage
    this.browserPage = undefined
    const page = await opening?.catch(() => undefined)
    if (page === undefined) {
      if (this.store.get<WatchState>('watch') !== undefined) this.store.set('watch-next', Date.now() + WATCH_INTERVAL_MS)
      await this.rearm()
      return
    }
    try {
      this.store.set('browser-state', await page.exportState())
      await this.saveScreen(await page.screenshot())
    } catch (error) {
      console.warn('browser state was not saved', error)
    }
    this.store.set('watch', { sessionId: page.sessionId(), url: page.url() } satisfies WatchState)
    this.store.set('watch-next', Date.now() + WATCH_INTERVAL_MS)
    await page.detach()
    await this.accountBrowser(false)
    await this.rearm()
  }

  /** The alarm's check: notifications the watched pages showed wake the Robot; an ended session is reopened. */
  protected async checkWatch(now: number): Promise<void> {
    const watch = this.store.get<WatchState>('watch')
    const due = this.store.get<number>('watch-next')
    if (watch === undefined || due === undefined || due > now || this.store.activeTurn() !== undefined || this.browserPage !== undefined) return
    this.store.set('watch-next', now + WATCH_INTERVAL_MS)
    const config = this.store.requireConfig()
    if (config.wakeOnScreenNotifications !== true || config.status !== 'active') return this.stopWatching()
    const backend = this.sessionBackend()
    let page = await this.browserDriver(backend).attach(watch.sessionId)
    console.log('screen watch', { robot: config.id, backend, attached: page !== undefined })
    if (page === undefined) {
      await this.accountBrowser(true)
      page = await this.browserDriver(backend).open(this.store.get<BrowserState>('browser-state') ?? null)
      this.store.set('browser-session', { backend, since: Date.now() } satisfies BrowserSession)
      if (watch.url.startsWith('http')) await page.goto(watch.url).catch(() => undefined)
      this.store.set('watch', { sessionId: page.sessionId(), url: page.url() } satisfies WatchState)
    }
    const notes = await page.takeNotifications()
    const url = page.url()
    console.log('screen watch', { robot: config.id, notes: notes.length, url })
    await page.detach()
    await this.accountBrowser(false)
    for (const note of notes) {
      const line = [note.title, note.body].filter((part) => part.trim() !== '').join(': ')
      await this.wake({
        kind: 'platform',
        sender: { kind: 'platform' },
        text: `A notification appeared on your screen (${url}): ${line}. Decide whether it needs action; open the browser to look.`,
        payload: { summary: `Notification on screen: ${line.slice(0, 100)}` },
      })
    }
  }

  /** The setting was switched off or the Robot paused: close the watched browser. */
  protected async stopWatching(): Promise<void> {
    const watch = this.store.get<WatchState>('watch')
    this.store.delete('watch')
    this.store.delete('watch-next')
    if (watch !== undefined && this.browserPage === undefined) {
      const page = await this.browserDriver(this.sessionBackend()).attach(watch.sessionId)
      await page?.close()
      await this.accountBrowser(true)
    }
    await this.rearm()
  }

  browserOpen(url: string): Promise<Observation> {
    return this.browsing(Browse.open(url))
  }


  browserObserve(): Promise<Observation> {
    return this.browsing(Browse.observe)
  }


  browserAct(action: BrowserAction): Promise<Observation> {
    return this.browsing(Browse.act(action))
  }


  browserWait(input: { text?: string; ms?: number }): Promise<Observation> {
    return this.browsing(Browse.wait(input))
  }


  browserScreenshot(): Promise<{ path: string; image: ScreenshotImage }> {
    return this.browsing(Browse.screenshot)
  }

  /** Run a browser program with the Robot's page, masking and screen as its Browsing service. */
  private browsing<A, E>(program: Effect.Effect<A, E, Browsing>): Promise<A> {
    return this.program(Effect.provideService(program, Browsing, {
      page: () => Effect.promise(() => this.page()),
      observed: (page) => Effect.promise(() => this.observed(page)),
      saveScreen: (png) => Effect.promise(() => this.saveScreen(png)),
      blockedThisTurn: this.blockedThisTurn,
    }))
  }


  /** Image bytes for a screenshot attachment id, for the model and the trajectory inspector. */
  async screenshotImage(attachmentId: string): Promise<{ mediaType: string; base64: string; body: ArrayBuffer } | undefined> {
    if (!attachmentId.startsWith('screen:') || attachmentId.includes('/')) return undefined
    const file = await this.run(this.workspace.read(`screens/${attachmentId.slice('screen:'.length)}`))
    if (file === undefined) return undefined
    const bytes = new Uint8Array(file.body)
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    return { mediaType: file.contentType || 'image/png', base64: btoa(binary), body: file.body }
  }

  private async observed(page: BrowserPage): Promise<Observation> {
    const observation = await page.observe()
    // The last page the Robot saw: where its browser reopens for a viewer (rb-keaw).
    if (observation.url.startsWith('http')) this.store.set('browser-url', observation.url)
    await this.loadSecretMasks()
    // The backend is named so a block page says which browser was blocked (rb-kank).
    return { ...observation, text: this.mask(observation.text), backend: backendLabel(this.sessionBackend(), this.knownHosts) }
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
      if (page.url().startsWith('http')) this.store.set('browser-url', page.url())
      await this.saveScreen(await page.screenshot())
    } catch (error) {
      console.warn('browser state was not saved', error)
    } finally {
      this.openedForViewer = false
      await page.close()
      await this.accountBrowser(true)
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

  /** Mr. Robot's reach: every login and skill its owner can grant (rb-b0rs). */
  private async refreshReach(): Promise<void> {
    const config = this.store.config()
    if (config === undefined) return
    this.knownHosts = await this.home().hostsFor(config.ownerId)
    if (config.kind !== 'mr-robot') return
    const [catalog, skills] = await Promise.all([this.home().catalog(config.ownerId, config.id), this.home().skills(config.ownerId)])
    this.store.setReach({ secrets: catalog.secrets.map((secret) => secret.name), skills: skills.map((skill) => skill.name), hosts: this.knownHosts.map((host) => host.id) })
  }

  private async refreshPersona(): Promise<void> {
    await this.refreshReach().catch((error: unknown) => console.warn('reach not refreshed', error))
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
  answer(proposalId: string, revision: number, approve: boolean): Promise<AnswerResult> {
    return this.program(Programs.answer(proposalId, revision, approve))
  }




  /** Mr. Robot's recipients follow what his Member can reach (robot-70kf). */
  setRecipients(robotIds: readonly string[]): Promise<void> {
    return this.program(Programs.setRecipients(robotIds))
  }


  /** Advanced settings (robot-vqtw): every change takes effect on the next Turn. */
  updateSettings(patch: SettingsPatch): Promise<RobotSettings> {
    return this.program(Programs.updateSettings(patch))
  }


  // ---------------------------------------------------------------- reporting and live updates

  protected owner(): { id: string; name: string } {
    return this.store.get<{ id: string; name: string }>('owner') ?? { id: this.store.requireConfig().ownerId, name: 'your owner' }
  }

  protected home() {
    return this.env.HOME.getByName(HOME_ID)
  }

  fleetState(): Promise<FleetState> {
    return this.program(Views.fleetState)
  }


  /** Report the registry row to the Home and tell open views to refresh. */
  protected async changed(): Promise<void> {
    this.broadcast()
    await this.report()
  }

  private report(): Promise<void> {
    return this.program(Views.report)
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
    await this.closeIfUnwatched()
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
        // The screen opens on demand: a waiting browser is reattached, an idle Robot's browser reopens at its last page (rb-keaw).
        if (input['on'] !== false) await this.openForViewer()
        await this.updateScreencast()
        await this.closeIfUnwatched()
        return
      case 'claim': {
        let takeover = this.store.get<TakeoverState>('takeover')
        if (takeover === undefined) {
          // The owner may take the browser of an idle Robot; its wake-ups wait until they hand it back.
          if (this.store.activeTurn() !== undefined) throw new Error('the Robot is using its browser; wait for it to finish or ask it to hand over')
          const page = await this.openForViewer()
          takeover = { reason: 'Opened by you', url: page.url(), requestedAt: Date.now(), claimedBy: null, sessionId: page.sessionId(), byOwner: true }
          this.store.set('takeover', takeover)
          await this.changed()
        }
        if (takeover.claimedBy !== null && takeover.claimedBy !== viewer.memberId) {
          socket.send(JSON.stringify({ type: 'claim-refused', heldBy: takeover.claimedBy }))
          return
        }
        this.store.set('takeover', { ...takeover, claimedBy: viewer.memberId })
        socket.serializeAttachment({ ...viewer, live: true } satisfies ViewerState)
        socket.send(JSON.stringify({ type: 'claimed' }))
        await this.page()
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
      case 'logins': {
        // Autofill in the takeover window (rb-o52a): the Robot's granted entries for the page shown.
        const page = await this.page()
        const config = this.store.requireConfig()
        const entries = await Promise.all(this.store.effectiveGrants().secrets.map(async (name) => [name, await this.home().resolveLogin(config.ownerId, name)] as const))
        socket.send(JSON.stringify({ type: 'logins', entries: entries.flatMap(([name, entry]) => entry !== null && entryMatches(entry, page.url()) ? [{ name, username: entry.username }] : []) }))
        return
      }
      case 'fill': {
        const takeover = this.store.get<TakeoverState>('takeover')
        if (takeover?.claimedBy !== viewer.memberId) throw new Error('claim the browser first')
        const name = String(input['name'] ?? '')
        if (!this.store.effectiveGrants().secrets.includes(name)) throw new Error(`"${name}" is not granted to this Robot`)
        const entry = await this.home().resolveLogin(this.store.requireConfig().ownerId, name)
        if (entry === null) throw new Error(`"${name}" no longer exists`)
        socket.send(JSON.stringify({ type: 'filled', message: await this.fillEntry(name, entry, await this.page()) }))
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

/** Sockets watching the screen. */
  private liveWatchers(): number {
    return this.ctx.getWebSockets().filter((socket) => (socket.deserializeAttachment() as ViewerState | null)?.live === true).length
  }

  /** Open the browser for a viewer when no Turn has it (rb-keaw). */
  private async openForViewer(): Promise<BrowserPage> {
    if (this.browserPage === undefined && this.store.activeTurn() === undefined && this.store.get('takeover') === undefined) this.openedForViewer = true
    return this.page()
  }

  /** A browser opened only for viewers closes when the last one leaves and no Turn or takeover needs it. */
  private async closeIfUnwatched(): Promise<void> {
    if (!this.openedForViewer || this.liveWatchers() > 0 || this.store.activeTurn() !== undefined || this.store.get('takeover') !== undefined) return
    if (this.store.requireConfig().wakeOnScreenNotifications === true) {
      this.openedForViewer = false
      await this.keepWatching()
    } else {
      await this.closeBrowser()
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
    this.store.set('takeover', { reason, url: page.url(), requestedAt: Date.now(), claimedBy: null, sessionId: page.sessionId() } satisfies TakeoverState)
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
    if (takeover?.byOwner === true) {
      // The owner opened it themselves: nothing to resume; the browser closes and held wake-ups run.
      this.openedForViewer = true
      await this.closeIfUnwatched()
      await this.rearm()
      if (this.store.pendingWakeups() > 0) this.drain()
      await this.changed()
      return
    }
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

  private rearm(): Promise<void> {
    return this.program(Programs.rearm)
  }



  // ---------------------------------------------------------------- Robot messages (robot-bsvs, robot-mv15, robot-ppzu, robot-bjq5)


  /** Recipients the Robot holds a Grant for, that its owner can still reach, and that are active. */
  directory(): Promise<DirectoryEntry[]> {
    return this.program(Programs.directory)
  }


  sendRobotMessage(to: string, text: string, idempotencyKey: string): Promise<{ requestId: string; status: string }> {
    return this.program(Programs.sendRobotMessage(to, text, idempotencyKey))
  }


  replyRobotMessage(handle: string, text: string): Promise<{ status: string }> {
    return this.program(Programs.replyRobotMessage(handle, text))
  }



  /** Deliver pending outbox rows; a lost RPC is retried on the alarm, the recipient dedupes. */
  private deliverOutbox(): Promise<void> {
    return this.program(Programs.deliverOutbox)
  }


  /** A message from another Robot arrives (robot-ppzu): deduped, capped, and queued as a Wake-up. */
  receive(message: RobotMessage): Promise<ReceiveResult> {
    return this.program(Programs.receive(message))
  }


  // ---------------------------------------------------------------- Mr. Robot (robot-hk2s)

  createRobot(brief: string): Promise<{ id: string; status: string }> {
    return this.program(Programs.createRobot(brief))
  }


/** Mr. Robot asks the owner to grant another Robot something: an ask in that Robot's chat, never a grant (rb-598m). */
  async proposeGrantsFor(robotId: string, purpose: string, grants: GrantSet): Promise<{ proposalId: string; status: string }> {
    const config = this.store.requireConfig()
    if (config.kind !== 'mr-robot') throw new Error('only Mr. Robot proposes Grants for other Robots')
    if (robotId === config.id || (await this.home().access(config.ownerId, robotId)) === null) throw new Error(`no Robot ${robotId} your owner can reach`)
    const proposal = await this.env.ROBOT.getByName(robotId).proposeFromChief(`${config.identity.name} asks: ${purpose}`, grants)
    return { proposalId: proposal.id, status: 'asked your owner in that Robot\'s chat; nothing is granted until they approve' }
  }

  /** A grant proposal Mr. Robot made for this Robot; the owner answers it here like the Robot's own. */
  async proposeFromChief(purpose: string, grants: GrantSet): Promise<ProposalView> {
    const proposal = this.propose('grants', purpose, { grants })
    await this.changed()
    return proposal
  }

  configureRobot(id: string, change: { name?: string; title?: string; description?: string }): Promise<{ id: string; identity: unknown }> {
    return this.program(Programs.configureRobot(id, change))
  }


  // ---------------------------------------------------------------- Routines (robot-gbbt, robot-qyd5)

  /** Pause keeps the Routine and its schedule but stops its alarm; resume plans the next run from now (robot-qhll). */
  pauseRoutine(id: string, paused: boolean): Promise<RoutineView> {
    return this.program(Programs.pauseRoutine(id, paused))
  }










  /** The owner deletes a Routine from the panel (robot-qyd5). */
  removeRoutine(id: string): Promise<void> {
    return this.program(Programs.removeRoutine(id))
  }



  // ---------------------------------------------------------------- views

  conversationView(): Promise<Conversation> {
    return this.program(Views.conversationView)
  }


/**
   * The live session's DSH events exactly as stored (every field, including surfaceOp), secrets
   * masked, for the DSH trajectory view (ticket 22). Pages backwards with before, forwards with after.
   */
  sessionEvents(input: { before?: number; after?: number; limit?: number }): Promise<{ events: string; hasMore: boolean; sessionId: string }> {
    return this.program(Views.sessionEvents(input))
  }


  /** The live log's events, secrets masked. */
  async trajectory(): Promise<TrajectoryEvent[]> {
    return [...(await this.program(Views.trajectory)).events]
  }

  trajectoryMasked(): Promise<Trajectory> {
    return this.program(Views.trajectory)
  }


  conversation(): Promise<Conversation> {
    return this.program(Views.conversation)
  }




  /** Replace secret values with a mask (robot-4zi6); stored history is already redacted at write. */
  protected mask(text: string): string {
    return maskSecrets(text, [...this.secretValues, ...this.turnSecrets])
  }

  /** The Workspace as the Files view lists it (rb-1miy): persona and memory first, then the rest. */
  async files(): Promise<WorkspaceFileView[]> {
    const entries = await this.run(this.workspace.list(''))
    const order = (path: string) => { const index = (PERSONA_FILES as readonly string[]).indexOf(path); return index === -1 ? PERSONA_FILES.length : index }
    const group = (path: string): WorkspaceFileView['group'] =>
      (PERSONA_FILES as readonly string[]).includes(path) ? 'persona'
        : /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(path) ? 'daily'
          : path.startsWith('skills/') ? 'skills'
            : path.startsWith('screens/') ? 'screens'
              : 'other'
    return entries
      .map((entry) => ({ path: entry.path, size: entry.size, updatedAt: entry.uploaded, group: group(entry.path) }))
      .sort((a, b) => order(a.path) - order(b.path) || (a.group === 'daily' && b.group === 'daily' ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path)))
  }

  /** One file for the editor; binary and large files are read-only (rb-q5eb). */
  async fileContent(path: string): Promise<WorkspaceFileContent> {
    const file = await this.run(this.workspace.read(path))
    if (file === undefined) throw Object.assign(new Error(`no file "${path}"`), { name: 'NotFound', status: 404 })
    if (file.size > MAX_EDITABLE_BYTES) return { path, size: file.size, text: null, readOnly: true, note: `${formatBytes(file.size)}: too large to edit here.` }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
    try {
      const decoded = text.decode(file.body)
      if (decoded.includes('\u0000')) throw new Error('binary')
      return { path, size: file.size, text: decoded, readOnly: false, note: null }
    } catch {
      return { path, size: file.size, text: null, readOnly: true, note: `${formatBytes(file.size)} binary file (${file.contentType || 'unknown type'}): shown read-only.` }
    }
  }

  /** The owner saved a file; the Robot hears about it at its next Turn (rb-xwks). */
  async saveFile(path: string, content: string): Promise<WorkspaceFileContent> {
    const current = await this.run(this.workspace.stat(path))
    if (current !== undefined && current.size > MAX_EDITABLE_BYTES) throw Object.assign(new Error('this file is too large to edit here'), { name: 'Invalid', status: 400 })
    await this.run(this.workspace.write(path, content, path.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8'))
    const edits = this.store.get<string[]>('owner-edits') ?? []
    this.store.set('owner-edits', [...new Set([...edits, path])])
    const config = this.store.requireConfig()
    this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `${this.owner().name} edited ${path}.`, Date.now())
    await this.changed()
    return this.fileContent(path)
  }

/** The Robot's local skills: skills/<name>/SKILL.md in its Workspace (rb-dkt1). */
  private async localSkills(): Promise<Array<{ name: string; description: string }>> {
    const entries = await this.run(this.workspace.list('skills'))
    const names = [...new Set(entries.flatMap((entry) => /^skills\/([a-z0-9][a-z0-9-]*)\/SKILL\.md$/.exec(entry.path)?.[1] ?? []))]
    return Promise.all(names.map(async (name) => ({ name, description: skillFrontmatter((await this.run(this.workspace.readText(`skills/${name}/SKILL.md`))) ?? '').description })))
  }

  /** Whether this Robot may change the Home library directly (Mr. Robot, ticket 10). */
  protected editsGlobalSkills(): boolean {
    return this.store.requireConfig().kind === 'mr-robot'
  }

  async writeSkill(name: string, content: string): Promise<{ path: string; scope: 'local' | 'global' }> {
    const config = this.store.requireConfig()
    const global = (await this.home().skills(config.ownerId)).find((skill) => skill.name === name)
    if (global !== undefined) {
      if (!this.editsGlobalSkills()) throw new Error(`"${name}" is a skill from the Home library and is read-only for you (rb-krq2). Write a local skill with another name, or ask your owner to change it.`)
      await this.home().saveSkill(name, skillFrontmatter(content).description || global.description, content, config.ownerId)
      return { path: `library: ${name}`, scope: 'global' }
    }
    const path = `skills/${name}/SKILL.md`
    await this.run(this.workspace.write(path, content, 'text/markdown; charset=utf-8'))
    return { path, scope: 'local' }
  }

  async promoteSkill(name: string, visibility: 'home' | 'private'): Promise<{ proposalId: string }> {
    const content = await this.run(this.workspace.readText(`skills/${name}/SKILL.md`))
    if (content === undefined) throw new Error(`You have no local skill "${name}". Write it with skill_write first.`)
    const description = skillFrontmatter(content).description
    const proposal = this.propose('skill', `Publish the skill "${name}"`, { skill: { name, description }, content, visibility })
    return { proposalId: proposal.id }
  }

  /** The owner deleted a file (a local skill, an old note). */
  async deleteFile(path: string): Promise<void> {
    await this.run(this.workspace.remove(path))
    const edits = this.store.get<string[]>('owner-edits') ?? []
    this.store.set('owner-edits', [...new Set([...edits, `${path} (deleted)`])])
  }

  exaKey(): Promise<string | null> {
    return this.home().exaKey()
  }

  /** An Exa call in usage and limits (rb-pb26); an agent run's cost is counted the first time it is seen. */
  async recordExa(costUsd: number, runId?: string): Promise<void> {
    let cost = costUsd
    if (runId !== undefined) {
      const billed = this.store.get<string[]>('exa-billed-runs') ?? []
      if (billed.includes(runId) || cost === 0) cost = 0
      else this.store.set('exa-billed-runs', [...billed.slice(-200), runId])
    }
    const config = this.store.requireConfig()
    const month = currentMonth()
    this.store.addServiceUsage(month, 'exa', 1, cost)
    if (cost > 0) {
      this.store.addUsage(month, 0, 0, cost)
      await this.env.MEMBER.getByName(config.ownerId).addUsage(month, config.id, 0, 0, cost).catch(() => undefined)
      await this.checkLimits()
    }
  }

  /** Granted login entries and whether each belongs to the open page (rb-vpes). */
  async logins(): Promise<Array<{ name: string; username: string; websites: readonly string[]; matchesPage: boolean; readable: boolean }>> {
    const config = this.store.requireConfig()
    const url = this.browserPage === undefined ? null : (await this.browserPage.catch(() => undefined))?.url() ?? null
    const entries = await Promise.all(this.store.effectiveGrants().secrets.map(async (name) => [name, await this.home().resolveLogin(config.ownerId, name)] as const))
    return entries.flatMap(([name, entry]) => entry === null ? [] : [{ name, username: entry.username, websites: entry.websites, matchesPage: url !== null && entryMatches(entry, url), readable: entry.allowRead }])
  }

  /**
   * Fill a granted entry into the open page (rb-e1ic): the Robot DO types it over CDP, so the password
   * never passes through the model's program or the conversation, and it is masked if a page echoes it.
   */
  async fillLogin(name: string): Promise<string> {
    const config = this.store.requireConfig()
    if (!this.store.effectiveGrants().secrets.includes(name)) throw new Error(`The login "${name}" is not granted to you. Ask with propose_grants.`)
    const entry = await this.home().resolveLogin(config.ownerId, name)
    if (entry === null) throw new Error(`The login "${name}" no longer exists`)
    return this.fillEntry(name, entry, await this.page())
  }

  private async fillEntry(name: string, entry: LoginEntry, page: BrowserPage): Promise<string> {
    const url = page.url()
    if (!entryMatches(entry, url)) {
      throw new Error(entry.websites.length === 0
        ? `"${name}" has no websites, so it cannot be filled anywhere. Ask your owner to add the site's address to it in their Logins.`
        : `"${name}" belongs to ${entry.websites.join(', ')}, not to ${url}. Open its own login page first.`)
    }
    this.remember(name, entry.password)
    const filled = await page.fillLogin(entry.username, entry.password)
    if (!filled.password) return `No password field is visible on ${url}. Open the login form (or its next step) and try again.`
    return `Filled ${filled.username && entry.username !== '' ? 'the username and ' : ''}the password of "${name}". Submit the form yourself.`
  }

  /** secret.get: a granted name only, resolved from the owner or the Home (robot-0bde). */
  secret(name: string): Promise<string> {
    return this.program(Programs.secret(name))
  }


  private remember(name: string, value: string): void {
    this.secretValues = [...this.secretValues.filter(([known]) => known !== name), [name, value]]
    this.turnSecrets = [...this.turnSecrets.filter(([known]) => known !== name), [name, value]]
  }

  /** Load every granted secret's value so views can mask them, also after a restart. */
  protected async loadSecretMasks(): Promise<void> {
    const config = this.store.config()
    if (config === undefined) return
    const granted = this.store.effectiveGrants().secrets
    const values = await Promise.all(granted.map(async (name) => [name, await this.home().resolveSecret(config.ownerId, name).catch(() => null)] as const))
    this.secretValues = values.filter((entry): entry is readonly [string, string] => entry[1] !== null)
  }

  // ---------------------------------------------------------------- rewind (robot-0q6a, robot-8v1t, robot-acr3)

  /**
   * Make a new live session seeded from the log up to and including `atSeq`. The old log
   * stays in this Robot's SQLite as the archive, with a rewind record; nothing is rewritten.
   * The Robot is told that external effects after the point still stand.
   */
/**
   * Rewind to before Turn n: before the inbox events that delivered its message too, so the
   * message is gone with the Turn (it is not delivered again).
   */
  rewindBeforeTurn(turn: number): Promise<RewindView> {
    return this.program(Programs.rewindBeforeTurn(turn))
  }


  rewind(atSeq: number): Promise<RewindView> {
    return this.program(Programs.rewind(atSeq))
  }


  /** Undo the latest rewind: its archived log becomes live again (robot-8v1t). */
  undoRewind(id: string): Promise<RewindView> {
    return this.program(Programs.undoRewind(id))
  }


  /** An archived log, read-only (the rewind archive). */
  archivedTrajectory(sessionId: string): Promise<TrajectoryEvent[]> {
    return this.program(Views.archivedTrajectory(sessionId))
  }


  settings(): Promise<RobotSettings> {
    return this.program(Programs.settings)
  }


  panel(canEdit: boolean, summary: RobotSummary): Promise<RobotPanel> {
    return this.program(Views.panel(canEdit, summary))
  }


  protected routineViews(): Promise<RoutineView[]> {
    return this.program(Views.routineViews)
  }


  /** Filled by the browser and usage tickets. */


  /** The latest screenshot's Workspace path (the thumbnail). */
  screenPath(): string | null {
    return this.store.get<{ path: string }>('screen')?.path ?? null
  }


  /** Names of the tools the current composition registers (what the model may call). */
  toolNames(): string[] {
    const config = this.store.requireConfig()
    const routines = config.status !== 'setup' && this.store.mayUse('tool', 'routines') ? [...SCHEDULE_TOOL_NAMES] : []
    return [...this.tools(config).map((tool) => tool.name), ...routines]
  }

  /** One row of the admin fleet list, from the DO itself (robot-x26m). */
  adminRow(): Promise<{ fleetState: FleetState; status: RobotConfig['status']; grants: GrantSet; model: ModelChoice; usage: UsageView; routines: RoutineView[] } | null> {
    return this.program(Views.adminRow)
  }


  openProposals(): ProposalView[] {
    return this.store.proposals('open').map(proposalView)
  }

  status(): Promise<{ status: RobotConfig['status']; fleetState: FleetState }> {
    return this.program(Views.status)
  }

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
  /** The Browser Rendering session to reattach after the Robot's DO restarts. */
  readonly sessionId?: string
  /** The owner opened the browser themselves; hand-back does not wake the Robot. */
  readonly byOwner?: boolean
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



/** The browser session open now, on which backend, and since when its time is unbilled. */
interface BrowserSession {
  readonly backend: BrowserBackend
  readonly since: number
}

interface WatchState {
  readonly sessionId: string
  readonly url: string
}

/** How often a watched browser is checked for notifications. */
const WATCH_INTERVAL_MS = 60_000

function runnable(config: RobotConfig): boolean {
  return config.status === 'active' || config.status === 'setup'
}

/** Files above this size open read-only in the Files view. */
const MAX_EDITABLE_BYTES = 256 * 1024

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function optionalString(payload: Record<string, unknown>, key: string): Record<string, string> {
  const value = payload[key]
  return typeof value === 'string' ? { [key]: value } : {}
}
