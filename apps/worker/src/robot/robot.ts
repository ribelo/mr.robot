/**
 * A Robot: one Durable Object, one endless Conversation (robot-ifp6, robot-frf5).
 *
 * Every Wake-up is queued in SQLite and drained one Turn at a time (robot-makt). The Turn
 * is driven by the DO, not by the request that caused it, so a closed tab does not stop it
 * (robot-p9jm). The active Turn is recorded before it starts and a heartbeat alarm stays
 * armed while it runs; if the DO dies mid-Turn, the alarm brings it back and the
 * interrupted Turn resumes from the last persisted event.
 */
import { clearWorkspace } from '../workspace/workspace.ts'
import { SPILL_SWEEP_EVERY_MS, sweepSpill } from '../workspace/spill.ts'
import { bareScreenName, deleteScreenshots, readScreenshot, saveScreenshot, SCREEN_SWEEP_EVERY_MS, sweepScreenshots } from '../workspace/screens.ts'
import { entryMatches, type LoginEntry } from '../platform/logins.ts'
import { DurableObject } from 'cloudflare:workers'
import * as Effect from 'effect/Effect'
import { LlmError, ToolCallId, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { OpencodePool } from '../providers/opencode-go.ts'
import { CACHE_WARM, warmable } from '../providers/anthropic.ts'
import { IDLE_MEMORY_NOTE, IDLE_MEMORY_STEPS, idlePlan, idleSettings, type IdleStep } from './idle.ts'
import { buildForkSeed, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  HostView,
  WorkspaceFileContent,
  WorkspaceFileView,
  Attachment,
  BrowserBackend,
  ChatItem,
  Conversation,
  ConversationPage,
  ConversationSearchResult,
  TrajectoryExcerpt,
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
  ScreenView,
  Sender,
  UsageView,
  SettingsPatch,
  Sharing,
  ThreadEvent,
  ThreadView,
  Trajectory,
  TrajectoryEvent,
} from '@mr-robot/protocol'
import { isToolGroup } from '../agent/catalog.ts'
import { composeScoped, type Composition } from '../agent/compose.ts'
import { askGate, bothItems, fixedItems, NO_ITEMS, type AskGateHost, type GrantItem, type ItemsOf, type ToolCallRequest, type ToolItems } from '../agent/ask-gate.ts'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import type { RobotHost, WorkspaceHost } from '../agent/host.ts'
import { type NotifyHost } from '../agent/tools/notify.ts'
import { maskSecrets, type SecretHost } from '../agent/tools/secrets.ts'
import { type DirectoryEntry, type MessagingHost, type RobotsHost } from '../agent/tools/messaging.ts'
import { PLATFORM_SECTIONS, platformPrompt, setupPrompt } from '../agent/platform-prompt.ts'
import { prependedIdentity, providerAdapter, type CredentialSource } from '../agent/providers.ts'
import { chainOf, clock, failureKind, modelOf, WORKERS_AI_OFF } from './chain.ts'
import type { ChainEntry, HomeSpendLimit, ProviderView, UsageSource } from '@mr-robot/protocol'
import { capabilitiesView, capabilityItems, usableLevel, usableNames, type CapabilitiesView, type CapabilityItem, type RobotOwner, type SettingsCatalog } from '@mr-robot/protocol'
import { readStoredEvents, storedLength } from '../agent/session-log.ts'
import { joinedMessage, wakeupMessage, type HelpAnswerWake, type JoinedPart, type TaskRunBy, type ThreadWake } from '../agent/sources.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, UserMessage } from '@deepseek-ai/dsh-llm'
import { joinable } from './delivery.ts'
import { ptcPlugin } from '../agent/ptc.ts'
import { skillFrontmatter } from '../agent/skills.ts'
import { type BrowserHost, type ScreenshotImage } from '../agent/tools/browser.ts'
import { type TakeoverHost } from '../agent/tools/takeover.ts'
import { fanOut, type ChannelAdapter, type ChannelOutput, type InboundEvent, type ReplyRoute } from '../channels/channel.ts'
import { PwaChannel } from '../channels/pwa.ts'
import { rememberIdempotencyKey, WebhookChannel, webhookText } from '../channels/webhook.ts'
import { DiscordChannel } from '../channels/discord.ts'
import { backendLabel, browserCost, driverFor, hostIdOf, isHostBackend } from '../browser/backends.ts'
import { containerOpenStages } from '../browser/driver.ts'
import { mount, type Mount } from '../plugins/define.ts'
import { Memory, sharedFileEdit, type MemoryHost, type SharedFile } from '../plugins/memory.ts'
import { renderBaseline, type MemoryChange, type MemoryFile } from '../agent/memory.ts'
import { Browser } from '../plugins/browser.ts'
import { Conversation as ConversationPlugin } from '../plugins/conversation.ts'
import { Credentials } from '../plugins/credentials.ts'
import { Exa } from '../plugins/exa.ts'
import { Files } from '../plugins/files.ts'
import { GrantProposals } from '../plugins/grant-proposals.ts'
import { Help } from '../plugins/help.ts'
import { Host } from '../plugins/host.ts'
import { connectorCapability } from '../plugins/connector.ts'
import { connectorOn, disabledToolGroups } from '../plugins/catalog.ts'
import { CONNECTOR_PLUGINS } from '../connectors/registry.ts'
import { heldSkillNames } from '../connectors/skills.ts'
import type { ConnectorHost, ConnectorPlugin, GrantedConnection } from '../connectors/connector.ts'
import type { ConnectionView, ConnectorKind, SkillLibraryRow, WebhookView } from '@mr-robot/protocol'
import { Logins } from '../plugins/logins.ts'
import { Messaging } from '../plugins/messaging.ts'
import { Notify } from '../plugins/notify.ts'
import { Robots } from '../plugins/robots.ts'
import { Deputy } from '../plugins/deputy.ts'
import * as DeputyPrograms from './deputy.ts'
import { Tasks } from '../plugins/tasks.ts'
import { tasksHost, type TaskTurn } from './tasks-host.ts'
import type { TaskView } from '@mr-robot/protocol'
import { Setup } from '../plugins/setup.ts'
import { Skills } from '../plugins/skills.ts'
import { Web } from '../plugins/web.ts'
import { onSiteDomain, withoutSite, type BrowserAction, type BrowserDriver, type BrowserPage, type BrowserSite, type BrowserState } from '../browser/driver.ts'
import { SERVICE, SESSION_SITE, sessionValues, SIGN_IN_TIMEOUT_MS, START_URL, type SignInKind } from '@mr-robot/host-protocol'
import { connectPastedValues } from '../member/connect-pasted.ts'
import type { SessionCapture } from '@mr-robot/protocol'
import type { Observation } from '../browser/observe.ts'
import type { MemberFileName } from '../member/member.ts'
import { PRODUCT_DOCS, docsReadOnlyMessage, isDocsPath, productDoc } from '../docs/index.ts'
import { dailyNotePaths, PERSONA_FILES, personaText, type PersonaSnapshot } from '../workspace/persona.ts'
import { RETIRED_ROBOT_FILES, ROBOT_FILES } from '../workspace/templates.ts'
import { makeWorkspace, type WorkspaceShape } from '../workspace/workspace.ts'
import { HOME_ID, type Env } from '../env.ts'
import { currentMonth, type RegistryEntry } from '../home/home.ts'
import { projectChat } from './projection.ts'
import { dropRoutines, exportRoutines, type ExportedRoutine } from './routine-export.ts'
import * as Layer from 'effect/Layer'
import { DurableRuntime } from '../platform/durable.ts'
import * as Programs from './programs.ts'
import * as Views from './views.ts'
import { causeOf, LAST_WAKEUP, runningTool } from './views.ts'
import * as Threads from './threads.ts'
import * as Browse from './browsing.ts'
import { Browsing } from './browsing.ts'
import { IDLE_PLAN, MR_ROBOT_COMPACTION, proposalView, RobotPlatform, RobotState, type AnswerResult, type HelpAnswerer, type HelpAnswerResult, type ReceiveResult, type RobotMessage, type ToolCallAnswerWake, type WakeInput } from './programs.ts'
export type { AnswerResult, HelpAnswerer, HelpAnswerResult, ReceiveResult, RobotMessage, WakeInput } from './programs.ts'
import { RobotStore, storedToolCall, type ActiveTurn, type TaskCard, type ProposalRow, type RobotConfig, type Wakeup, type WakeupKind } from './store.ts'

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
  /** The owner's usable connections and the Home's plugin switches, refreshed with the reach (v1.5). */
  private knownConnections: ConnectionView[] = []
  /** What this Robot's owner can grant it, read at the start of each Turn: the items its levels are listed over. */
  private knownCatalog: SettingsCatalog | undefined
  private pluginsOn: Record<string, boolean> = {}
  /** The kind of the wake-up the running Turn serves. */
  private currentWakeup: string | undefined
  /** The browser was opened for a viewer (live view or takeover), not by a Turn (rb-keaw). */
  private openedForViewer = false
  /** Values of granted secrets, kept only in memory to mask views (never stored by the Robot). */
  private secretValues: Array<readonly [string, string]> = []
  /** Secret values fetched during the running Turn; redacted from everything stored. */
  private turnSecrets: Array<readonly [string, string]> = []
  /** Calls the platform runs because their owner approved them (sk-ed7r): they pass the ask gate once. */
  private readonly approvedCalls = new Set<string>()
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

  // ---------------------------------------------------------------- deletion (v1.3 ticket 06)

  /**
   * Delete this Robot for good (pl-3uoy): its storage, alarm, browser, Workspace files and screenshots. No undo.
   * The files go by the id the Home passes, not by this Robot's own config: a Robot whose storage is already
   * gone (deleted before v1.3) still loses its files (sk-44d5).
   */
  async destroy(robotId: string): Promise<void> {
    await this.releaseComposition().catch(() => undefined)
    await this.closeBrowser().catch(() => undefined)
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(1000, 'robot deleted') } catch { /* closing */ }
    }
    await clearWorkspace(this.env.FILES, robotId)
    await deleteScreenshots(this.env.FILES, robotId)
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.store.prepare()
  }

  /** Another Robot was deleted: it is no longer a recipient (pl-3uoy). */
  async dropRecipient(robotId: string): Promise<void> {
    if (this.store.config() === undefined) return
    const had = this.ctx.storage.sql.exec("SELECT 1 FROM grant_item WHERE kind = 'recipient' AND name = ?", robotId).toArray().length > 0
    if (!had) return
    this.ctx.storage.sql.exec("DELETE FROM grant_item WHERE kind = 'recipient' AND name = ?", robotId)
    this.store.updateConfig(() => ({}))
  }

  /**
   * Start the Conversation over (pl-05eu, pl-y228): a new session, without the old log, notices,
   * rewinds or queued wake-ups. Configuration, grants and every Workspace file stay (v1.11, sk-8won); its Tasks live at the Home.
   */
  async clearHistory(): Promise<void> {
    if (this.store.activeTurn() !== undefined) throw new Error('the Robot is working; wait for it to finish, then clear')
    await this.releaseComposition()
    const sql = this.ctx.storage.sql
    for (const table of ['session_event', 'session_log', 'notice', 'rewind', 'wakeup', 'turn', 'outbox', 'intake', 'reply_handle']) sql.exec(`DELETE FROM ${table}`)
    // Answered Asks go with the history; open ones are still decisions the owner owes.
    sql.exec("DELETE FROM proposal WHERE status != 'open'")
    this.store.search.clear()
    for (const key of ['memory-baseline', 'memory-changes', 'failed-wakeup', 'takeover', 'screen']) this.store.delete(key)
    this.store.updateConfig(() => ({ liveSessionId: `s-${crypto.randomUUID()}` }))
    await this.changed()
  }

  /**
   * Start over (sk-8won): clear the history, then reset the whole Workspace to the templates. Grants, Tasks,
   * Connections and settings stay. The product docs are not Workspace objects, so they stay too. The
   * screenshots go with the Conversation that showed them.
   */
  async startOver(): Promise<void> {
    await this.clearHistory()
    await clearWorkspace(this.env.FILES, this.store.requireConfig().id)
    await deleteScreenshots(this.env.FILES, this.store.requireConfig().id)
    this.store.delete('screens-sweep-next')
    await this.seedWorkspace()
    await this.rearm()
    await this.changed()
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
    // Exactly what the model reads (sk-xsat): the provider's identity line and the bridge when its adapter puts one first.
    const identity = this.providerIdentity(config)
    const sections = [
      ...(identity === null ? [] : [{ name: 'Provider identity', text: identity }]),
      { name: 'Platform', text: platformPrompt({ config, owner, afterProviderIdentity: identity !== null, ...this.capabilityInput() }) },
      // The rules each mounted capability adds, which reach the model as their own sections (sk-xsat).
      ...this.mounts(config).flatMap(({ plugin, config: options }) => {
        const text = plugin.rules(options as never)
        return text === '' ? [] : [{ name: plugin.name.replace(/^mr-robot-/, 'mr-robot:'), text }]
      }),
    ]
    if (config.status === 'setup') sections.push({ name: 'Setup interview', text: setupPrompt(owner.name, this.store.get<string>('brief') ?? null) })
    // The shared-memory tools are off during setup (mounts()).
    sections.push({ name: 'Memory (first message of the context)', text: renderBaseline(await this.memoryFiles(), MEMORY_BYTES, sharedFileEdit(config.kind, config.status !== 'setup')) })
    return {
      sections: sections.map((section) => ({ ...section, text: this.mask(section.text) })),
      tools: config.codeMode && config.status !== 'setup' ? ['run_code (code mode), calling:', ...this.toolNames()] : this.toolNames(),
      skills: config.status === 'setup' ? [] : usableNames(this.store.effectiveGrants().skills),
    }
  }

  /** Resolves once no Turn is running and nothing runnable is queued. */
  async settled(): Promise<void> {
    while (this.alarming !== undefined || this.pumping !== undefined) {
      if (this.alarming !== undefined) await this.alarming
      if (this.pumping !== undefined) await this.pumping
    }
  }

  /** The alarm handler in flight, so settled() also waits for Wake-ups it is about to queue. */
  private alarming: Promise<void> | undefined

  override async alarm(): Promise<void> {
    const run = this.runAlarm()
    this.alarming = run
    try {
      await run
    } finally {
      if (this.alarming === run) this.alarming = undefined
    }
  }

  private async runAlarm(): Promise<void> {
    const config = this.store.config()
    if (config !== undefined && config.status !== 'deleted') await this.expireCapture(Date.now()).catch((error: unknown) => console.warn('sign-in not ended', error))
    if (config !== undefined && config.status !== 'deleted') await this.program(Programs.fireTasks(Date.now())).catch((error: unknown) => console.warn('due Tasks not fetched', error))
    // Due Tasks start at once; housekeeping below must not delay their Turns.
    if (this.store.pendingWakeups() > 0) this.drain()
    if (config !== undefined && config.status !== 'deleted') await this.checkWatch(Date.now()).catch((error: unknown) => console.warn('screen watch failed', error))
    if (config !== undefined && config.status !== 'deleted') await this.sweepScreens(Date.now()).catch((error: unknown) => console.warn('screenshots not swept', error))
    if (config !== undefined) await this.deliverOutbox()
    if (config !== undefined && config.status !== 'deleted') this.resumeChain(Date.now())
    if (config !== undefined && config.status !== 'deleted') await this.escalateHelp(Date.now()).catch((error: unknown) => console.warn('help not escalated', error))
    if (config !== undefined && config.status === 'active') await this.runIdle(Date.now()).catch((error: unknown) => console.warn('idle work failed', error))
    if (this.store.activeTurn() !== undefined || this.store.pendingWakeups() > 0) this.drain()
    await this.rearm()
  }

  /**
   * The running Turn works on this Task, or on none (mc-w3cc, ao-lj6z): only a Task assigned to this Robot. The Home
   * records an attempt running; the Turn's end finishes it. Focus may change any number of times in a Turn: the
   * Task it leaves ends its attempt as skipped with the reason, and Mission Control shows the new focus at once (ao-cvpx).
   */
  async focusTask(taskId: string | null, reason: string): Promise<{ ok: true; title: string | null } | { ok: false; reason: string }> {
    const active = this.store.activeTurn()
    if (active === undefined) return { ok: false, reason: 'No Turn is running.' }
    if (active.task?.id === taskId || (active.task === null && taskId === null)) return { ok: true, title: active.task?.title ?? null }
    const started = taskId === null ? null : await this.home().attemptStarted(taskId, this.store.requireConfig().id)
    if (taskId !== null && started === null) return { ok: false, reason: 'That Task is not an open Task assigned to you.' }
    if (active.task !== null) await this.home().attemptFinished(active.task.attemptId, 'skipped', reason.trim() === '' ? 'Dropped for other work.' : reason.trim())
    this.store.setTurnTask(started === null || taskId === null ? null : { id: taskId, title: started.title, attemptId: started.attemptId })
    await this.report()
    return { ok: true, title: started?.title ?? null }
  }

  /** What the Task tools need of the running Turn. */
  private taskTurn(): TaskTurn {
    return {
      focus: (taskId, reason) => this.focusTask(taskId, reason),
      doneLine: (taskId, line) => {
        if (this.store.activeTurn()?.task?.id === taskId) this.store.set(DONE_LINE, line)
      },
    }
  }

  /**
   * A person stops the running Turn (mc-w5ee): the model call and tools are cancelled, the Wake-up is used up,
   * the attempt ends interrupted and the Conversation says who did it. False when no Turn runs.
   */
  async interrupt(by: string): Promise<{ interrupted: boolean }> {
    if (this.store.activeTurn() === undefined) return { interrupted: false }
    this.store.set(INTERRUPTED_BY, by)
    // A steer handed over but not read yet stays in the inbox: the next Turn reads it.
    this.composition?.value.agent.cancel({ kind: 'user' }, { keepInbox: true })
    return { interrupted: true }
  }

  /** A person ran one of this Robot's Tasks now (mc-n1aa): a Task Wake-up, unless one of that Task already waits. */
  async runTask(task: { id: string; title: string; instructions: string }, who: string): Promise<boolean> {
    if (this.store.taskQueued(task.id)) return false
    await this.wake({ kind: 'task', sender: { kind: 'task', taskId: task.id, name: task.title }, text: task.instructions, payload: { taskId: task.id, by: 'member', who } })
    return true
  }

  /** Someone else changed one of this Robot's Tasks: its Conversation shows a card naming who (mc-c1aa). */
  async taskCard(card: TaskCard): Promise<void> {
    const config = this.store.config()
    if (config === undefined || config.status === 'deleted') return
    const verb = card.action === 'done' ? 'marked done' : card.action
    this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `Task ${verb} by ${card.by}: ${card.title}`, Date.now(), card)
    await this.changed()
  }

  /** The Home planned this Robot's earliest due Task (mc-s1aa): the alarm comes then. */
  setNextDue(at: number | null): Promise<void> {
    return this.program(Programs.setNextDue(at))
  }

  protected drain(): void {
    this.deliverSteers()
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
      // Every entry of the model chain is unavailable: wait for the earliest reset (pa-dus3).
      if (active === undefined && (this.store.get<number>('chain-resume-at') ?? 0) > Date.now()) return
      const wakeup = active === undefined ? this.store.nextWakeup() : this.store.wakeup(active.wakeupId)
      if (wakeup === undefined) {
        if (active !== undefined) this.store.endTurn(active.wakeupId)
        return
      }
      if (active === undefined && config.status === 'active' && !(await this.pickEntry())) return
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
    await this.tidyWorkspace().catch((error: unknown) => console.warn('workspace not tidied', error))
    // Hosts and Mr. Robot's reach decide which tools exist, so they are known before the composition.
    await this.refreshReach().catch((error: unknown) => console.warn('reach not refreshed', error))
    const { agent, ctx } = await this.agent()
    await this.refreshPersona()
    if (!resuming) {
      // An approved tool call runs first, exactly as stored, and its result is what the Wake-up says (sk-ed7r).
      const toolCallAnswer = wakeup.kind === 'platform' ? wakeup.payload['toolCallAnswer'] as ToolCallAnswerWake | undefined : undefined
      const text = toolCallAnswer?.approved === true ? joinText(await this.runApprovedCall(ctx, toolCallAnswer.askId), wakeup.text) : wakeup.text
      const startSeq = storedLength(this.ctx.storage.sql, agent.session.id)
      this.store.beginTurn(wakeup.id, agent.session.id, startSeq, Date.now())
      this.store.set(`turn-start:${wakeup.id}`, startSeq)
      // A Task Wake-up makes the Task the Turn's subject, with an attempt at the Home (mc-t4dd).
      const taskId = wakeup.kind === 'task' && typeof wakeup.payload['taskId'] === 'string' ? wakeup.payload['taskId'] : undefined
      if (taskId !== undefined) await this.focusTask(taskId, '').catch((error: unknown) => console.warn('attempt not started', taskId, error))
      // Follow-ups from the same sender queued with it join its Turn; a Task never shares one (ao-rdhs).
      const joined = wakeup.kind === 'task' ? [] : joinable(wakeup, this.store.queuedWakeups())
      const first = this.wakeupMessageOf(wakeup, text, toolCallAnswer)
      agent.followup(joined.length === 0 ? first : joinedMessage([first, ...joined.map((other) => this.wakeupMessageOf(other, other.text))], [wakeup, ...joined].map(joinedPart)))
      this.store.consumeWakeups(joined.map((other) => other.id))
    } else {
      agent.followup(wakeupMessage({
        sender: { kind: 'platform' },
        text: 'Your previous Turn was interrupted by a platform restart. Its tool results above are real. Continue that work from where it stopped; do not redo finished steps.',
        summary: 'Resumed after a restart',
      }))
    }
    // From here until the agent is idle, the owner's steers reach this Turn at its next step (ao-9570).
    this.runningAgent = agent
    this.deliverSteers()
    await this.rearm()
    await this.changed()
    await agent.whenIdle()
    this.runningAgent = undefined
    await ctx.sessions.flush(agent.session)
    if (this.turnSecrets.length > 0) {
      // The in-memory session still holds plaintext; the next Turn starts from the redacted log.
      await this.releaseComposition()
      this.turnSecrets = []
    }
    // A block is remembered for its own Turn only (rb-kank).
    this.blockedThisTurn.clear()
    const turn = this.store.activeTurn()
    this.store.endTurn(wakeup.id)
    await this.afterTurn(wakeup, turn)
    this.planIdle()
    await this.rearm()
    await this.changed()
  }

  // ---------------------------------------------------------------- idle: cache warming and idle compaction (v1.14 ticket 09)

  /** The last ordinary request of the Robot's own session, as sent: what cache warming replays. */
  private lastRequest: { sessionId: string; options: GenerateOptions } | undefined

  /** A Turn ended: with nothing queued, the idle moments are planned and the request to replay is kept (ao-8hi8). */
  private planIdle(): void {
    const config = this.store.requireConfig()
    if (config.status !== 'active' || this.store.pendingWakeups() > 0) return this.store.delete(IDLE_PLAN)
    const plan = idlePlan(config, config.model.provider, Date.now())
    if (plan.length === 0) return this.store.delete(IDLE_PLAN)
    this.store.set(IDLE_PLAN, plan)
    const last = this.lastRequest
    if (plan.some((step) => step.action === 'warm') && last !== undefined && last.sessionId === config.liveSessionId) {
      const { signal: _signal, ...options } = last.options
      this.store.set(WARM_REQUEST, { provider: config.model.provider, model: config.model.model, effort: config.model.effort, options })
    }
  }

  /** The alarm's idle duty: the next planned moment, only while no Turn runs and nothing is queued. */
  private async runIdle(now: number): Promise<void> {
    const plan = this.store.get<IdleStep[]>(IDLE_PLAN)
    const step = plan?.[0]
    if (plan === undefined || step === undefined || step.at > now) return
    if (this.store.activeTurn() !== undefined || this.store.pendingWakeups() > 0 || this.pumping !== undefined) return
    const rest = plan.slice(1)
    if (rest.length === 0) this.store.delete(IDLE_PLAN)
    else this.store.set(IDLE_PLAN, rest)
    // A warming that comes much later than planned finds the cache gone: it is skipped, not run late.
    if (step.action === 'warm') { if (now - step.at < IDLE_LATE_MS) await this.warmCache() }
    else await this.idleCompact()
  }

  /** Replay the last request for one output token (ao-jlr0); it is a cache read, billed as the Robot's model cost. */
  private async warmCache(): Promise<void> {
    const config = this.store.requireConfig()
    const saved = this.store.get<{ provider: string; model: string; effort: string; options: GenerateOptions }>(WARM_REQUEST)
    if (saved === undefined || saved.provider !== config.model.provider || saved.model !== config.model.model || !warmable(saved.model, saved.effort)) return
    const chosen = (await this.home().modelList()).find((option) => option.provider === saved.provider && option.model === saved.model)
    const adapter = this.adapter(saved.provider, chosen?.contextWindow, saved.model, chosen?.wire)
    let usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } | undefined
    for await (const chunk of adapter.stream({ ...saved.options, maxTokens: 1, purpose: CACHE_WARM as never, signal: AbortSignal.timeout(120_000) })) {
      if (chunk.type === 'usage') usage = chunk.usage as typeof usage
    }
    if (usage === undefined) return
    const [input, output, cached] = [usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.cacheReadTokens ?? 0]
    const price = chosen?.price
    await this.recordUsage('robot', input, output, price === undefined ? 0 : ((input - cached) * price.input + cached * (price.cachedInput ?? price.input) + output * price.output) / 1_000_000)
  }

  /**
   * Compact once while idle, on the warm prefix (ao-f4sp): a context below the floor is left alone (ao-z22f). First
   * one bounded platform step for memory (ao-7bq9); a Wake-up during it means the compaction does not happen now.
   */
  private async idleCompact(): Promise<void> {
    const config = this.store.requireConfig()
    const { agent, ctx } = await this.agent()
    if (ctx.tokenMeter.measure(agent.session).totalTokens < idleSettings(config).idleCompactionFloorTokens) return
    const startSeq = storedLength(this.ctx.storage.sql, agent.session.id)
    let steps = 0
    const stop = ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'step/start' && ++steps >= IDLE_MEMORY_STEPS) agent.cancel({ kind: 'user' }, { keepInbox: true })
    })
    try {
      agent.followup(wakeupMessage({ sender: { kind: 'platform' }, text: IDLE_MEMORY_NOTE, summary: 'Idle: saving memory before compaction', woke: { at: Date.now(), timeZone: config.timeZone } }))
      await agent.whenIdle()
    } finally {
      stop()
    }
    await ctx.sessions.flush(agent.session)
    if (this.store.activeTurn() === undefined && this.store.pendingWakeups() === 0) {
      await ctx.compaction.compactNow(agent, AbortSignal.timeout(300_000)).catch((error: unknown) => console.warn('idle compaction did not run', error))
      await ctx.sessions.flush(agent.session)
    }
    await this.accountTurn(startSeq)
    await this.changed()
  }

  /** The agent of the Turn that is running now; set while a steer can still reach it. */
  private runningAgent: Agent | undefined

  /** A Wake-up as the model reads it: its source label, the local time, and the steer's Wake-up id. */
  private wakeupMessageOf(wakeup: Wakeup, text: string, toolCallAnswer?: ToolCallAnswerWake, steer = false): UserMessage {
    return wakeupMessage({
      sender: wakeup.sender,
      text,
      ...(toolCallAnswer === undefined ? {} : { toolCallAnswer }),
      attachments: (wakeup.payload['attachments'] as Attachment[] | undefined) ?? [],
      ...optionalString(wakeup.payload, 'requestId'),
      ...optionalString(wakeup.payload, 'replyTo'),
      ...optionalString(wakeup.payload, 'replyHandle'),
      ...optionalString(wakeup.payload, 'summary'),
      ...(wakeup.payload['thread'] !== undefined && wakeup.kind === 'robot' ? { thread: wakeup.payload['thread'] as ThreadWake } : {}),
      ...(wakeup.payload['helpAnswer'] !== undefined && wakeup.kind === 'platform' ? { helpAnswer: wakeup.payload['helpAnswer'] as HelpAnswerWake } : {}),
      ...optionalString(wakeup.payload, 'clientId'),
      ...(wakeup.kind === 'task' ? { taskRun: taskRunOf(wakeup.payload) } : {}),
      ...(steer ? { steer: { wakeupId: wakeup.id } } : {}),
      woke: { at: Date.now(), timeZone: this.store.requireConfig().timeZone },
    })
  }

  /**
   * Hand the queued steers to the running Turn (ao-9570): DSH reads them at the next step, and the log stores
   * each where it was read (ao-lfxt). They leave the queue at once, so a restart does not replay them as Turns;
   * the agent's inbox is durable in the session log. A reply goes back where the last steer came from.
   */
  private deliverSteers(): void {
    const agent = this.runningAgent
    const active = this.store.activeTurn()
    if (agent === undefined || active === undefined || agent.status !== 'running') return
    const steers = this.store.queuedWakeups().filter((queued) => queued.delivery === 'steer' && queued.id !== active.wakeupId)
    if (steers.length === 0) return
    for (const steer of steers) agent.steer(this.wakeupMessageOf(steer, steer.text, undefined, true))
    this.store.consumeWakeups(steers.map((steer) => steer.id))
    const route = steers.map((steer) => steer.payload['route'] as ReplyRoute | undefined).filter((found) => found !== undefined && found.channel !== 'webhook').at(-1)
    if (route !== undefined) this.store.set(`steer-route:${active.wakeupId}`, route)
    this.ctx.waitUntil(this.changed())
  }

  /**
   * Run a tool call its owner approved (sk-ed7r, sk-fx6q): the stored tool and arguments, never
   * regenerated, inside this composition, at most once. A restart during the call leaves its outcome
   * unknown, and the Robot is told so instead of running it again.
   */
  private async runApprovedCall(ctx: Composition['ctx'], askId: string): Promise<string> {
    const ask = this.store.proposal(askId)
    const call = ask === undefined || ask.kind !== 'tool-call' || ask.status !== 'approved' ? undefined : storedToolCall(ask.payload)
    if (call === undefined) return 'The approved call is no longer stored, so it did not run.'
    const started = `tool-call-started:${askId}`
    if (this.store.get(started) !== undefined) return 'The call was started before a platform restart; whether it finished is unknown. Check its effect before you do it again.'
    this.store.set(started, Date.now())
    const callId = `approved-${askId}`
    this.approvedCalls.add(callId)
    try {
      const result = await ctx.tools.execute({ callId: ToolCallId(callId), name: call.tool, arguments: call.arguments, signal: new AbortController().signal })
      if (result.isError) return `The call failed: ${result.error.message}`
      return result.content.map((block) => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
    } finally {
      this.approvedCalls.delete(callId)
    }
  }

  /** The ask gate of this Robot's tools (sk-hx8j): levels read live, Asks stored in its Conversation. */
  private askGateHost(): AskGateHost {
    return {
      level: (item) => this.store.levelOf(item.kind, item.name),
      askToolCall: (request) => this.askToolCall(request),
      approved: (callId) => this.approvedCalls.has(callId),
    }
  }

  /** Store one call of a tool under an item at ask as an Ask; the Robot is told to end its Turn. */
  private askToolCall(request: ToolCallRequest): { askId: string } {
    const config = this.store.requireConfig()
    const proposal = this.propose('tool-call', `${request.tool}: ${request.reason}`, {
      toolCall: { robot: config.identity.name, tool: request.tool, arguments: request.arguments, reason: request.reason, items: request.items },
    })
    return { askId: proposal.id }
  }

  /** Platform duties once a Turn ends: SOUL.md changes, and the hooks of later tickets. */
  protected async afterTurn(wakeup: Wakeup, turn?: ActiveTurn): Promise<void> {
    const interruptedBy = this.store.get<string>(INTERRUPTED_BY)
    this.store.delete(INTERRUPTED_BY)
    this.store.set(LAST_WAKEUP, { wakeup: causeOf(wakeup), task: turn?.task == null ? null : { id: turn.task.id, title: turn.task.title } })
    if (this.store.get('takeover') === undefined) {
      // Someone is watching the screen: the browser stays open for them and closes when they leave (rb-keaw).
      if (this.liveWatchers() > 0 && this.browserPage !== undefined) this.openedForViewer = true
      else if (this.store.requireConfig().wakeOnScreenNotifications === true) await this.keepWatching()
      else await this.closeBrowser()
    }
    const startSeq = this.store.get<number>(`turn-start:${wakeup.id}`) ?? 0
    this.store.delete(`turn-start:${wakeup.id}`)
    await this.accountTurn(startSeq)
    if (interruptedBy !== undefined) {
      // An interrupted Turn is over: its Wake-up is used up, not kept for Try again (mc-w5ee).
      const config = this.store.requireConfig()
      this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `Interrupted by ${interruptedBy}.`, Date.now())
      this.store.delete('failed-wakeup')
      if (turn?.task != null) await this.home().attemptFinished(turn.task.attemptId, 'interrupted', `Interrupted by ${interruptedBy}.`).catch((error: unknown) => console.warn('attempt not finished', error))
      return
    }
    const failedTurn = this.rememberFailure(wakeup, startSeq)
    const doneLine = this.store.get<string>(DONE_LINE)
    this.store.delete(DONE_LINE)
    if (turn?.task != null) {
      const reply = failedTurn ? undefined : (await this.conversation()).items.filter((item) => item.seq >= startSeq && item.kind === 'reply').at(-1)
      const firstLine = failedTurn ? 'The Turn failed.' : doneLine !== undefined ? doneLine : reply?.kind === 'reply' ? reply.text.split('\n')[0]!.slice(0, 160) : 'Finished without a reply.'
      await this.home().attemptFinished(turn.task.attemptId, failedTurn ? 'failed' : 'ok', firstLine).catch((error: unknown) => console.warn('attempt not finished', error))
    }
    if (failedTurn) await this.chainFailure(startSeq).catch((error: unknown) => console.warn('model chain not advanced', error))
    else await this.chainSucceeded().catch(() => undefined)
    const shown = (item: ChatItem) => item.kind !== 'message' || item.reaction !== null || item.sender.kind !== 'member'
    if (!failedTurn && wakeup.kind !== 'task' && !(await this.conversation()).items.some((item) => item.seq >= startSeq && shown(item))) {
      // A Turn that ends with nothing to show (e.g. a reasoning model spent its output cap thinking) is not silent.
      const config = this.store.requireConfig()
      this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `${config.identity.name} finished without a reply. If this repeats, raise its context budget in Advanced settings.`, Date.now())
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
    await this.notifyMembers('finished', last.text, (memberId) => memberId === watcher && this.ctx.getWebSockets(memberId).length > 0, true)
  }

  /**
   * Push to the Robot's notified Members through the Member DOs (quiet hours live there).
   * `replyCopy` marks a notification that only repeats the Turn's reply: Discord never gets it.
   * @returns how many Members were notified; 0 when notifications are off (robot-r2uz).
   */
  async notifyMembers(kind: NotificationKind, body: string, skip: (memberId: string) => boolean = () => false, replyCopy = false): Promise<number> {
    const config = this.store.requireConfig()
    if (!config.notifications.enabled) return 0
    const members = (config.notifications.members.length === 0 ? [config.ownerId] : config.notifications.members).filter((member) => !skip(member))
    await this.sendToChannels({
      kind: 'notification', id: `n-${crypto.randomUUID()}`, robotId: config.id, robotName: config.identity.name,
      notification: kind, text: body, memberIds: members, replyCopy,
    })
    return members.length
  }

  // ---------------------------------------------------------------- Channels (robot-vfqd)

  /** The Channel adapters this Robot can use; v1 has the PWA. Tests add a fake one. */
  protected channels(): Map<string, ChannelAdapter> {
    const pwa = new PwaChannel({ notify: (memberId, event) => this.env.MEMBER.getByName(memberId).notify(event) })
    const webhook = new WebhookChannel()
    const channels = new Map<string, ChannelAdapter>([[pwa.id, pwa], [webhook.id, webhook]])
    // Discord is a second door into the Conversation (cn-65gg). Having a channel of its own is not required:
    // a direct message to the bot reaches the Robot and the answer goes back to that DM.
    const config = this.store.config()
    if (config !== undefined) {
      const channelId = config.discordChannel ?? ''
      const discord = new DiscordChannel(config.ownerId, channelId === '' ? null : channelId, { post: (memberId, channel, text, replyTo) => this.home().discordPost(memberId, channel, text, replyTo) })
      channels.set(discord.id, discord)
    }
    return channels
  }

  /**
   * Who hears everything (the Channels of the Robot's list), and who hears only what nobody asked for:
   * Discord, when the Robot has a channel of its own and its owner allows it. The old 'discord' entry
   * in the list does nothing: Discord is on by having a channel.
   */
  private audience(): { readonly enabled: string[]; readonly unprompted: string[] } {
    const config = this.store.requireConfig()
    const hasChannel = (config.discordChannel ?? '') !== ''
    return {
      enabled: config.notifications.channels.filter((channel) => channel !== 'discord'),
      unprompted: hasChannel && config.discordProactive !== false ? ['discord'] : [],
    }
  }

  /** Output leaves through every enabled Channel; a failing Channel never fails the Turn. */
  protected async sendToChannels(output: ChannelOutput): Promise<string[]> {
    const config = this.store.requireConfig()
    const delivered = {
      has: (key: string) => this.store.get<boolean>(`delivered:${key}`) === true,
      add: (key: string) => this.store.set(`delivered:${key}`, true),
    }
    try {
      const { enabled, unprompted } = this.audience()
      return await fanOut(output, enabled, this.channels(), delivered, unprompted)
    } catch (error) {
      console.warn('channel delivery failed', error)
      return []
    }
  }

  /** An external event arrives through a Channel and wakes the Robot (deduplicated by event id). */
  async channelEvent(event: InboundEvent): Promise<{ accepted: boolean }> {
    const adapter = this.channels().get(event.channel)
    if (adapter === undefined) throw new Error(`no Channel ${event.channel}`)
    // Discord messages arrive only for Robots the Home routes them to (their channel, or Mr. Robot for a DM).
    if (event.channel !== 'discord' && event.channel !== 'webhook' && !this.store.requireConfig().notifications.channels.includes(event.channel)) return { accepted: false }
    const wakeup = adapter.inbound(event)
    if (wakeup.dedupeKey !== null) {
      if (this.store.get<boolean>(`inbound:${wakeup.dedupeKey}`) === true) return { accepted: true }
      this.store.set(`inbound:${wakeup.dedupeKey}`, true)
    }
    await this.wake({ kind: 'channel', sender: wakeup.sender, text: wakeup.text, payload: { route: wakeup.route, ...(event.fromOwner === true && event.channel !== 'webhook' ? { fromOwner: true } : {}) } })
    return { accepted: true }
  }

  // ---------------------------------------------------------------- webhook (v1.6 ticket 07)

  /** The address and key, for the owner; a Robot older than the webhook gets its key on first use. */
  webhook(): WebhookView {
    const config = this.store.requireConfig()
    const key = config.webhookKey ?? this.store.updateConfig(() => ({ webhookKey: newWebhookKey() }), false).webhookKey!
    return { path: `/hooks/${config.id}/${key}`, key }
  }

  /** A new key; the old address stops working at once. */
  regenerateWebhook(): WebhookView {
    this.store.updateConfig(() => ({ webhookKey: newWebhookKey() }), false)
    return this.webhook()
  }

  /** Whether this is the key of this Robot's webhook (compared in constant time). */
  webhookAccepts(key: string): boolean {
    const expected = this.store.config()?.webhookKey
    if (expected === undefined || this.store.config()?.status === 'deleted') return false
    const encoder = new TextEncoder()
    const [given, wanted] = [encoder.encode(key), encoder.encode(expected)]
    return given.byteLength === wanted.byteLength && crypto.subtle.timingSafeEqual(given, wanted)
  }

  /**
   * A webhook request wakes the Robot once per Idempotency-Key (every request, without one). Only the
   * last IDEMPOTENCY_KEYS_KEPT keys are remembered, so the list stays bounded.
   */
  async receiveWebhook(key: string, request: { contentType: string; body: string; idempotencyKey: string | null }): Promise<{ accepted: boolean }> {
    if (!this.webhookAccepts(key)) return { accepted: false }
    const config = this.store.requireConfig()
    if (request.idempotencyKey !== null) {
      const remembered = rememberIdempotencyKey(this.store.get<string[]>('webhook-idempotency-keys') ?? [], request.idempotencyKey)
      if (remembered.duplicate) return { accepted: true }
      this.store.set('webhook-idempotency-keys', remembered.seen)
    }
    return this.channelEvent({
      channel: 'webhook',
      eventId: request.idempotencyKey ?? '',
      from: 'webhook',
      text: webhookText(request.contentType, request.body),
      route: { channel: 'webhook', address: config.id },
    })
  }

  /** Replies of a Turn go back out as recipientsOf decides: to where the question came from, or unasked to the opted-in Channels. */
  private async deliverReplies(wakeup: Wakeup, startSeq: number): Promise<void> {
    const config = this.store.requireConfig()
    // A webhook has nobody to answer: its Turn replies like a Task's (app, and the Channels that opted in).
    const steered = this.store.get<ReplyRoute>(`steer-route:${wakeup.id}`)
    this.store.delete(`steer-route:${wakeup.id}`)
    const own = (wakeup.payload['route'] as ReplyRoute | undefined) ?? null
    const stored = own === null || own.channel === 'webhook' ? steered ?? own : own
    const route = stored?.channel === 'webhook' ? null : stored
    const unprompted = steered === undefined && wakeup.kind !== 'member' && (wakeup.kind !== 'channel' || stored?.channel === 'webhook')
    const replies = (await this.conversation()).items.filter((item) => item.seq >= startSeq && item.kind === 'reply')
    for (const item of replies) {
      if (item.kind !== 'reply') continue
      await this.sendToChannels({ kind: 'reply', id: item.id, robotId: config.id, robotName: config.identity.name, text: this.mask(item.text), route, final: item === replies.at(-1), unprompted })
    }
  }

  // ---------------------------------------------------------------- the model chain (v1.10 ticket 04)

  /** Account states as of the last pick, so a good Turn can clear a state it ran through. */
  private chainStates = new Map<string, ProviderView>()

  private activeIndex(chain: readonly ChainEntry[]): number {
    return Math.min(this.store.get<number>('chain-active') ?? 0, chain.length - 1)
  }

  /**
   * Each entry's account state now; unbound entries are always usable, Workers AI entries while the
   * Home admin leaves Workers AI on (ux-zh1l). `disabled`: unusable because the admin switched it off.
   */
  private async entryStates(chain: readonly ChainEntry[]): Promise<Array<{ usable: boolean; until: number | null; label: string; disabled: boolean }>> {
    const config = this.store.requireConfig()
    const bound = chain.some((entry) => entry.account !== '' && entry.account !== 'workers-ai')
    const { mine, shared } = bound ? await this.home().accountsFor(config.ownerId) : { mine: [], shared: [] }
    const workersAiOn = chain.some((entry) => entry.provider === 'workers-ai') ? (await this.home().settings()).workersAiEnabled : true
    this.chainStates = new Map([...mine, ...shared].map((account) => [account.id, account]))
    const now = Date.now()
    return chain.map((entry) => {
      if (entry.provider === 'workers-ai') return { usable: workersAiOn, until: null, label: 'Workers AI', disabled: !workersAiOn }
      if (entry.account === '') return { usable: true, until: null, label: entry.provider, disabled: false }
      const account = this.chainStates.get(entry.account)
      if (account === undefined) return { usable: false, until: null, label: 'an account that is gone', disabled: false }
      return { usable: account.status === 'ok' || (account.until ?? 0) <= now, until: account.until, label: account.label, disabled: false }
    })
  }

  /**
   * Run on the first usable entry of the chain (pa-14yx, pa-dus3). A change is a line in the
   * Conversation; with no usable entry the Robot waits for the earliest reset. False: do not run now.
   */
  private async pickEntry(reason?: string): Promise<boolean> {
    const config = this.store.requireConfig()
    const chain = chainOf(config)
    const states = await this.entryStates(chain)
    const index = states.findIndex((state) => state.usable)
    if (index < 0) {
      // Nothing to wait for but the admin's switch: the alarm looks again every hour (ux-mz3h).
      const earliest = Math.min(...states.map((state) => state.until ?? Date.now() + 3_600_000))
      const why = reason ?? (states.some((state) => state.disabled) ? WORKERS_AI_OFF : undefined)
      const blocked = why ?? 'unavailable'
      this.store.set('chain-resume-at', earliest)
      // A Robot that stays blocked for the same reason says so once, not at every look.
      if (this.store.get<string>('chain-blocked') !== blocked) {
        this.store.set('chain-blocked', blocked)
        const waits = states.every((state) => state.disabled) ? 'after the admin switches Workers AI on again' : `by itself at ${clock(earliest, config.timeZone)}`
        this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `Every model in the chain is unavailable${why === undefined ? '' : ` (${why})`}. ${config.identity.name} continues ${waits}, or sooner when you add another entry.`, Date.now())
        this.ctx.waitUntil(this.notifyMembers('blocked', `Every model in its chain is unavailable${states.some((state) => state.disabled) ? ` (${WORKERS_AI_OFF})` : ''}; it continues ${waits}.`).catch(() => 0))
        await this.changed()
      }
      await this.rearm()
      return false
    }
    this.store.delete('chain-resume-at')
    this.store.delete('chain-blocked')
    const active = this.activeIndex(chain)
    if (index === active) return true
    const entry = chain[index]!
    const was = states[active]!
    const line = index < active
      ? `Back to ${entry.model} on ${states[index]!.label}: it works again.`
      : `Switched to ${entry.model} on ${states[index]!.label}: ${reason ?? (was.disabled ? WORKERS_AI_OFF : `${was.label} is unavailable${was.until === null ? '' : ` until ${clock(was.until, config.timeZone)}`}`)}.`
    this.store.set('chain-active', index)
    this.store.updateConfig(() => ({ model: modelOf(entry) }))
    this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), line, Date.now())
    await this.changed()
    return true
  }

  /** A Turn failed: a limited or broken account moves the Robot down its chain and the work goes on (pa-kvsr, pa-q0dg). */
  private async chainFailure(startSeq: number): Promise<void> {
    const config = this.store.requireConfig()
    const end = readStoredEvents(this.ctx.storage.sql, config.liveSessionId)
      .filter((event) => event.seq >= startSeq && event.type === 'turn/end').at(-1)
    const failure = (end?.data as { reason?: { kind?: string; error?: { code?: string; status?: number; message?: string } } } | undefined)?.reason?.error
    if (failure === undefined) return
    const kind = failureKind(failure)
    if (kind === null) return
    const chain = chainOf(this.store.requireConfig())
    const entry = chain[this.activeIndex(chain)]!
    if (entry.account === '' || entry.account === 'workers-ai') return
    const resets = /resets at (\S+?)\)/.exec(failure.message ?? '')?.[1]
    const until = resets === undefined ? null : Date.parse(resets)
    const note = (failure.message ?? failure.code ?? 'failed').slice(0, 200)
    const label = await this.home().markAccount(entry.owner, entry.account, { status: kind, until: until !== null && Number.isFinite(until) ? until : null, note }, { id: config.id, name: config.identity.name })
    const reason = `${label ?? 'its account'} ${kind === 'limited' ? 'hit its limit' : 'stopped working'}`
    const before = this.activeIndex(chain)
    if (!(await this.pickEntry(reason))) return
    if (this.activeIndex(chain) === before) return
    // The work goes on with the next entry; the failed wake-up is not run again from the start.
    this.store.delete('failed-wakeup')
    this.store.enqueue('platform', { kind: 'platform' }, 'The previous model call failed because its account was unavailable; the Robot now runs on the next entry of its model chain. Continue the work from where it stopped; do not redo finished steps.', {}, Date.now())
  }

  /** A good Turn on an account marked limited or broken: it works again (pa-gqff, pa-bc78). */
  private async chainSucceeded(): Promise<void> {
    const config = this.store.requireConfig()
    const chain = chainOf(config)
    const entry = chain[this.activeIndex(chain)]!
    const state = this.chainStates.get(entry.account)
    if (state === undefined || state.status === 'ok') return
    await this.home().markAccount(entry.owner, entry.account, { status: 'ok', until: null, note: null }, { id: config.id, name: config.identity.name })
    this.chainStates.set(entry.account, { ...state, status: 'ok', until: null, note: null })
  }

  /** The earliest reset came: the Robot continues the work it was blocked on (pa-dus3). */
  private resumeChain(now: number): void {
    const at = this.store.get<number>('chain-resume-at')
    if (at === undefined || at > now) return
    this.store.delete('chain-resume-at')
    if (this.store.get('failed-wakeup') !== undefined || this.store.pendingWakeups() === 0) {
      this.store.delete('failed-wakeup')
      this.store.enqueue('platform', { kind: 'platform' }, 'Your model chain is usable again. Continue the work from where it stopped; do not redo finished steps.', {}, now)
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
      const attempt = active?.task?.attemptId
      if (attempt !== undefined) this.ctx.waitUntil(this.home().attemptFinished(attempt, 'failed', 'The Turn failed.').catch(() => undefined))
      this.store.delete(INTERRUPTED_BY)
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
    await this.recordUsage('robot', input, output, cost)
  }

  /** One cost on this Robot's and its owner's monthly counters, under its source (ao-zbld). */
  protected async recordUsage(source: UsageSource, inputTokens: number, outputTokens: number, costUsd: number): Promise<void> {
    const config = this.store.requireConfig()
    const month = currentMonth()
    this.store.addUsage(month, source, inputTokens, outputTokens, costUsd)
    await this.env.MEMBER.getByName(config.ownerId).addUsage(month, config.id, source, inputTokens, outputTokens, costUsd).catch((error: unknown) => console.warn('member usage not counted', error))
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
    const brief = this.store.get<string>('brief') ?? null
    const seed = this.pendingSeed?.sessionId === config.liveSessionId ? this.pendingSeed : undefined
    const chosen = (await this.home().modelList()).find((option) => option.provider === config.model.provider && option.model === config.model.model)
    const contextWindow = chosen?.contextWindow
    const adapter = this.adapter(config.model.provider, contextWindow, config.model.model, chosen?.wire)
    // The bridge follows the adapter that runs this composition (sk-74ym); every text is read at each request.
    const afterProviderIdentity = prependedIdentity(adapter) !== null
    const prompt = [
      // The owner is read with every text too: a rename or a new nickname reaches the next request (ux-nwi1).
      ...PLATFORM_SECTIONS.map((section) => ({ name: section.name, text: () => section.render({ config: this.store.requireConfig(), owner: this.owner(), afterProviderIdentity, ...this.capabilityInput() }) })),
      ...(config.status === 'setup' ? [{ name: 'setup', text: () => setupPrompt(this.owner().name, brief) }] : []),
    ]
    const mounts = this.mounts(config)
    const scope = await Effect.runPromise(Scope.make())
    const value = await Effect.runPromise(Scope.provide(scope)(composeScoped({
      storage: this.ctx.storage,
      sessionId: config.liveSessionId,
      ...(seed === undefined ? {} : { seed }),
      onAppend: () => {
        this.broadcast()
        this.reportActivity()
      },
      redact: (json) => maskSecrets(json, this.turnSecrets),
      provider: config.model.provider,
      model: config.model.model,
      effort: config.model.effort,
      adapter,
      contextBudget: config.contextBudget,
      ...(contextWindow === undefined ? {} : { modelWindow: contextWindow }),
      compactionInstruction: config.compactionInstruction,
      // A compacted context lost the memory baseline; the next step brings it back fresh (pl-552r).
      onCompacted: () => this.store.delete('memory-baseline'),
      onStream: (frame) => this.streamed(frame),
      onRequest: (options) => {
        if (options.sessionId !== undefined) this.lastRequest = { sessionId: String(options.sessionId), options }
      },
      prompt,
      mounts,
      spill: { workspace: this.workspace, fileTools: mounts.some((entry) => (entry.plugin as unknown) === Files) },
      ...(config.codeMode && config.status !== 'setup' ? { ptcRuntime: ptcPlugin(this.env.LOADER) } : {}),
    }))).catch(async (error: unknown) => {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      throw error
    })
    this.composition = { revision: config.revision, value, scope }
    this.pendingSeed = undefined
    return value
  }

  /** The identity line the adapter of the Robot's model puts before its prompt; null when none, or when no adapter can be built for it. */
  private providerIdentity(config: RobotConfig): string | null {
    try {
      return prependedIdentity(this.adapter(config.model.provider, undefined, config.model.model))
    } catch {
      return null
    }
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

  /**
   * The active chain entry's account, per request (v1.10). An entry made before accounts existed binds
   * to the account it first uses, so the chain names it from then on (pa-l3l9).
   */
  protected credentials(): CredentialSource {
    return {
      resolve: async (provider) => {
        const config = this.store.requireConfig()
        const chain = chainOf(config)
        const index = Math.min(this.store.get<number>('chain-active') ?? 0, chain.length - 1)
        const entry = chain[index]!
        if (entry.provider === provider && entry.account !== '') return (await this.home().accountCredential(config.ownerId, entry.owner, entry.account)) ?? undefined
        const found = await this.home().providerCredential(config.ownerId, provider)
        if (found === null) return undefined
        if (entry.provider === provider && found.account !== undefined) {
          const bound = chain.map((item, at) => (at === index ? { ...item, account: found.account!, owner: found.owner } : item))
          this.store.updateConfig(() => ({ chain: bound }), false)
          this.ctx.waitUntil(this.changed())
        }
        const { owner: _owner, ...credential } = found
        return credential
      },
    }
  }

  /**
   * The capability plugins this Robot mounts (v1.3 ticket 01, pl-rsoy): always the conversation,
   * then exactly its granted groups; while in setup only setup and files.
   */
  protected mounts(config: RobotConfig): Mount[] {
    const mounts: Mount[] = [mount(Credentials, { source: this.credentials() })]
    if (config.status === 'setup') {
      return [...mounts, mount(ConversationPlugin, { host: undefined }), mount(Setup, { host: this }), mount(Files, { host: this, workspace: this.workspace, memberFile: (name) => this.memberFile(name) }), mount(Memory, { host: this.memoryHost(config), maxBytes: MEMORY_BYTES, tools: false })]
    }
    mounts.push(mount(ConversationPlugin, { host: this }), mount(GrantProposals, { host: this }), ...(config.kind === 'mr-robot' ? [] : [mount(Help, { host: this })]), mount(Memory, { host: this.memoryHost(config), maxBytes: MEMORY_BYTES, tools: true }))
    // Items at allow or ask are registered, deny items are not (sk-746n); the tools of ask items are wrapped by the ask gate (sk-hx8j).
    const grants = this.store.effectiveGrants()
    // Plugins the Home switched off are not mounted for anyone (cn-dbm9).
    const off = disabledToolGroups(this.pluginsOn)
    const granted = new Set(usableNames(grants.tools).filter(isToolGroup).filter((group) => !off.has(group)))
    const items = this.mountItems(grants)
    const gate = (itemsOf: ItemsOf) => askGate(this.askGateHost(), itemsOf)
    const group = (name: string): ItemsOf => () => fixedItems({ kind: 'tool', name })
    if (granted.has('files')) mounts.push(mount(Files, { host: this, workspace: this.workspace, memberFile: (name) => this.memberFile(name) }, gate(group('files'))))
    if (granted.has('notify')) mounts.push(mount(Notify, { host: this }, gate(group('notify'))))
    if (granted.has('secrets')) mounts.push(mount(Logins, { host: this, granted: usableNames(grants.secrets) }, gate(items.logins)))
    if (granted.has('messaging')) mounts.push(mount(Messaging, { host: this }, gate(items.messaging)))
    if (granted.has('browser')) mounts.push(mount(Browser, { host: this }, gate(items.browser)))
    if (granted.has('robots') && config.kind === 'mr-robot') mounts.push(mount(Robots, { host: this }, gate(group('robots'))))
    if (granted.has('deputy') && config.kind === 'mr-robot') mounts.push(mount(Deputy, { host: DeputyPrograms.deputyHost((program) => this.program(program)) }, gate(group('deputy'))))
    if (granted.has('exa') || granted.has('exa-agent')) mounts.push(mount(Exa, { research: granted.has('exa'), agentRuns: granted.has('exa-agent'), host: this }, gate((tool) => fixedItems({ kind: 'tool', name: tool.startsWith('exa_agent_') ? 'exa-agent' : 'exa' }))))
    if (granted.has('web')) mounts.push(mount(Web, {}, gate(group('web'))))
    if (granted.has('tasks')) mounts.push(mount(Tasks, { host: tasksHost((program) => this.program(program), this.taskTurn()) }, gate(group('tasks'))))
    // Connector skills come with the connector grant, not with an ordinary skill grant (cn-go3s).
    const connectorSkills = this.connectorSkillNames()
    const skillNames = () => this.heldSkills()
    if (granted.has('skills') || connectorSkills.length > 0) {
      mounts.push(mount(Skills, {
        host: this,
        source: {
          granted: () => this.home().loadableSkills(config.ownerId, skillNames()),
          content: async (name) => skillNames().includes(name) ? this.home().skillContent(config.ownerId, name) : null,
          local: () => this.localSkills(),
          localContent: (name) => this.run(this.workspace.readText(`skills/${name}/SKILL.md`)).then((text) => text ?? null),
        },
      }, gate(items.skills(granted.has('skills')))))
    }
    // Host files and shell follow the per-host grants, not a tool group (hs-5ktw).
    const hostGrants = usableNames(grants.hosts)
    const names = (kind: string) => hostGrants.filter((grant) => grant.endsWith(`:${kind}`)).map((grant) => this.knownHosts.find((host) => `${host.id}:${kind}` === grant)?.name ?? grant.slice(0, -kind.length - 1))
    if (names('files').length > 0 || names('shell').length > 0) mounts.push(mount(Host, { host: this, files: names('files'), shell: names('shell') }, gate(items.hosts)))
    for (const [kind, plugin] of Object.entries(this.connectorPlugins()) as Array<[ConnectorKind, ConnectorPlugin]>) {
      if (!connectorOn(this.pluginsOn, kind)) continue
      const accounts = this.grantedConnections(kind)
      // Each connector tool names the Connection a call acts on (connectors/connector.ts).
      if (accounts.length > 0) mounts.push(mount(connectorCapability(kind), { plugin, host: this.connectorHost(kind, accounts) }, gate(() => NO_ITEMS)))
    }
    return mounts
  }

  /**
   * The grant items the calls of each capability use beyond its tool group (sk-hx8j): a login by name,
   * a recipient, the Host facet of a call or of the Host browser, a Home skill loaded by name.
   */
  private mountItems(grants: GrantSet): {
    readonly logins: ItemsOf
    readonly messaging: ItemsOf
    readonly browser: ItemsOf
    readonly skills: (group: boolean) => ItemsOf
    readonly hosts: ItemsOf
  } {
    const tool = (name: string): GrantItem => ({ kind: 'tool', name })
    const named = (kind: GrantItem['kind'], names: readonly string[], parameter: string): ToolItems => ({
      possible: names.map((name) => ({ kind, name })),
      used: async (args) => (typeof args[parameter] === 'string' ? [{ kind, name: args[parameter] }] : []),
    })
    const hostFacets = (facet: string) => usableNames(grants.hosts).filter((name) => name.endsWith(`:${facet}`)).map((name): GrantItem => ({ kind: 'host', name }))
    const hostFacet = (facet: 'files' | 'shell'): ToolItems => ({
      possible: hostFacets(facet),
      used: async (args) => {
        if (typeof args['host'] !== 'string') return []
        // An unknown host is the tool's own error; the gate then has nothing to ask about.
        const host = await this.resolveHost(args['host']).catch(() => undefined)
        return host === undefined ? [] : [{ kind: 'host', name: `${host.id}:${facet}` }]
      },
    })
    return {
      logins: (name) => bothItems(fixedItems(tool('secrets')), name === 'login_fill' || name === 'secret_get' ? named('secret', usableNames(grants.secrets), 'name') : NO_ITEMS),
      messaging: (name) => bothItems(fixedItems(tool('messaging')), name === 'robot_send' ? named('recipient', usableNames(grants.recipients), 'to') : NO_ITEMS),
      browser: () => bothItems(fixedItems(tool('browser')), {
        possible: hostFacets('browser'),
        used: async () => {
          const backend = await this.chosenBackend()
          return isHostBackend(backend) ? [{ kind: 'host', name: `${hostIdOf(backend)}:browser` }] : []
        },
      }),
      // The skills group covers every skill tool; loading a Home skill also uses that skill's item. Local skills are the Robot's own.
      skills: (group) => (name) => bothItems(group ? fixedItems(tool('skills')) : NO_ITEMS, name === 'skill' ? {
        possible: usableNames(grants.skills).map((skill): GrantItem => ({ kind: 'skill', name: skill })),
        used: async (args) => (typeof args['name'] === 'string' && Object.hasOwn(grants.skills, args['name']) ? [{ kind: 'skill', name: args['name'] }] : []),
      } : NO_ITEMS),
      hosts: (name) => (name === 'host_run' ? hostFacet('shell') : name === 'host_read' || name === 'host_write' ? hostFacet('files') : NO_ITEMS),
    }
  }

  // ---------------------------------------------------------------- connectors (v1.5)

  /** Skills of the connector kinds this Robot holds a granted connection for (and whose plugin is on). */
  private connectorSkillNames(): string[] {
    return heldSkillNames({ skills: {}, connections: this.store.effectiveGrants().connections }, this.knownConnections, this.connectorKindsOn())
  }

  /** Every skill this Robot holds: granted, or brought by a connector it holds. */
  private heldSkills(): string[] {
    return heldSkillNames(this.store.effectiveGrants(), this.knownConnections, this.connectorKindsOn())
  }

  /** Connector kinds with an implementation whose plugin the Home has on. */
  private connectorKindsOn(): ConnectorKind[] {
    return (Object.keys(this.connectorPlugins()) as ConnectorKind[]).filter((kind) => connectorOn(this.pluginsOn, kind))
  }

  /** The connector implementations; tests substitute fakes. */
  protected connectorPlugins(): Partial<Record<ConnectorKind, ConnectorPlugin>> {
    return CONNECTOR_PLUGINS
  }

  /** fetch for connector HTTP; tests substitute recorded responses. */
  protected connectorFetch(): typeof globalThis.fetch {
    return (input, init) => fetch(input, init)
  }

  /** Connections of a kind this Robot holds a grant for, with the write grant marked (cn-xezx). */
  private grantedConnections(kind: ConnectorKind): GrantedConnection[] {
    const usable = (name: string) => this.store.mayUse('connection', name)
    return this.knownConnections
      .filter((connection) => connection.kind === kind && usable(connection.id))
      .map((connection) => ({ id: connection.id, kind, label: connection.label, account: connection.account, services: connection.services, write: usable(`${connection.id}:write`), isDefault: connection.isDefault }))
  }

  private connectorHost(kind: ConnectorKind, accounts: GrantedConnection[]): ConnectorHost {
    const ownerId = this.store.requireConfig().ownerId
    return {
      kind,
      accounts,
      fetch: this.connectorFetch(),
      use: async (connectionId) => {
        // Checked again at each call: a grant withdrawn mid-Turn stops working at once.
        if (!this.store.mayUse('connection', connectionId)) throw new Error('this connection is no longer granted')
        const use = await this.home().useConnection(ownerId, connectionId)
        if (use === null) throw new Error('this connection no longer exists or is no longer shared')
        // Secrets of the call are masked out of everything this Turn writes (cn-a1i0).
        for (const [field, value] of Object.entries(use.secrets)) this.remember(`${use.connection.label}:${field}`, value)
        return { secrets: use.secrets, meta: use.meta }
      },
      markStatus: (connectionId, status, note) => this.home().updateUsedConnection(ownerId, connectionId, { status, statusNote: note }),
      saveFile: async (path, bytes) => {
        await this.run(this.workspace.write(path, bytes))
        return path
      },
      readFile: async (path) => {
        const file = await this.run(this.workspace.read(path))
        if (file === undefined) throw new Error(`no file ${path} in the Workspace`)
        return new Uint8Array(file.body)
      },
    }
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
    const facet = `${hostId}:${grant}`
    // The host's Member checks that the owner reaches the host; Mr. Robot then holds the facet unless his owner lowered it to deny (sk-br7y).
    const lowered = this.store.grants().hosts[facet]
    const granted = config.kind === 'mr-robot' ? lowered === undefined || usableLevel(lowered) : this.store.mayUse('host', facet)
    return { ownerId: config.ownerId, name: config.identity.name, granted, mrRobot: config.kind === 'mr-robot' }
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

  /** Host calls fail clearly (hs-bfr8); a Task's Turn that hits an offline host tells the owner (hs-nwcl). */
  private async hostCall<A>(call: () => Promise<A>): Promise<A> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof Error && error.name === 'HostOffline' && this.currentWakeup === 'task') {
        await this.notifyMembers('needs you', `could not finish a task: ${error.message}. Start the Mr. Robot app on that computer.`).catch(() => 0)
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
      const cost = browserCost(session.backend, ms)
      this.store.addBrowserUsage(currentMonth(), session.backend, ms, cost)
      await this.recordUsage('browser', 0, 0, cost)
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
    const started = Date.now()
    this.openTiming = { backend, startedAt: started, stages: {} }
    const stage = (name: string) => { if (this.openTiming !== undefined) this.openTiming.stages[name] = Date.now() - started }
    // A session left running is reused only on the backend now chosen; a change applies on the next open.
    const attached = sessionId === undefined || this.sessionBackend() !== backend ? undefined : await this.browserDriver(backend).attach(sessionId)
    stage('attach')
    if (attached !== undefined) {
      if (this.store.get('browser-session') === undefined) this.store.set('browser-session', { backend, since: Date.now() } satisfies BrowserSession)
      return attached
    }
    await this.accountBrowser(true)
    this.viewerStatus(`Starting ${backendLabel(backend, this.knownHosts)}…`)
    // A new session with the saved cookies and storage (they follow the Robot across backends), back on the page it was on.
    const reopened = await this.browserDriver(backend).open(this.store.get<BrowserState>('browser-state') ?? null)
    stage('backend')
    if (this.openTiming !== undefined) for (const [key, value] of Object.entries(containerOpenStages)) this.openTiming.stages[`backend.${key}`] = value
    this.store.set('browser-session', { backend, since: Date.now() } satisfies BrowserSession)
    const url = watch?.url ?? takeover?.url ?? this.store.get<string>('browser-url')
    if (url?.startsWith('http') === true) {
      this.viewerStatus(`Opening ${new URL(url).host}…`)
      // A viewer sees the page while it loads; a Turn waits for it (pl-n2vs).
      const navigation = reopened.goto(url).catch(() => undefined).finally(() => stage('page'))
      if (this.liveWatchers() === 0 || this.store.activeTurn() !== undefined) await navigation
    }
    return reopened
  }

  /** Where the last browser open spent its time (pl-n2vs): stage → ms since the open began. */
  private openTiming: { backend: string; startedAt: number; stages: Record<string, number> } | undefined

  /** What the takeover window is waiting for (pl-5agt). */
  private viewerStatus(text: string): void {
    const message = JSON.stringify({ type: 'status', text })
    for (const socket of this.ctx.getWebSockets()) {
      if ((socket.deserializeAttachment() as ViewerState | null)?.live === true) {
        try { socket.send(message) } catch { /* closing */ }
      }
    }
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


  browserScreenshot(): Promise<{ image: ScreenshotImage }> {
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
    const file = await readScreenshot(this.env.FILES, this.store.requireConfig().id, attachmentId.slice('screen:'.length))
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

  /**
   * A screenshot becomes the panel's screen thumbnail (robot-ksvy). It is stored apart from the Workspace
   * (sk-m7t1) and swept after 7 days; the first one arms the daily sweep.
   */
  protected async saveScreen(png: Uint8Array): Promise<{ name: string }> {
    const at = Date.now()
    const name = await saveScreenshot(this.env.FILES, this.store.requireConfig().id, png, at)
    this.store.set('screen', { path: name, at })
    if (this.store.get<number>('screens-sweep-next') === undefined) this.store.set('screens-sweep-next', at + SCREEN_SWEEP_EVERY_MS)
    this.broadcast({ type: 'screen' })
    return { name }
  }

  /** The alarm's daily sweep of screenshots older than 7 days; it rearms itself while any are left. */
  private async sweepScreens(now: number): Promise<void> {
    const due = this.store.get<number>('screens-sweep-next')
    if (due === undefined || due > now) return
    const left = await sweepScreenshots(this.env.FILES, this.store.requireConfig().id, now)
    if (left > 0) this.store.set('screens-sweep-next', now + SCREEN_SWEEP_EVERY_MS)
    else this.store.delete('screens-sweep-next')
  }

  /** The thumbnail's bytes, or undefined when there is no screen (or it was swept). */
  async screenImage(): Promise<ArrayBuffer | undefined> {
    const saved = this.store.get<{ path: string }>('screen')
    if (saved === undefined) return undefined
    return (await readScreenshot(this.env.FILES, this.store.requireConfig().id, bareScreenName(saved.path)))?.body
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

  /**
   * Once per Robot, at the start of a Turn (sk-vhlb): the memory/bank files earlier versions seeded are removed
   * when they still hold the template text; a file the Robot wrote into stays. A Robot that took screenshots
   * before v1.11 gets its sweep armed, so the ones in its Workspace age out.
   */
  private async tidyWorkspace(): Promise<void> {
    if (this.store.get('bank-retired') === undefined) {
      const ws = this.workspace
      for (const [path, template] of Object.entries(RETIRED_ROBOT_FILES)) {
        if ((await this.run(ws.readText(path))) === template) await this.run(ws.remove(path))
      }
      this.store.set('bank-retired', true)
    }
    if (this.store.get('screen') !== undefined && this.store.get('screens-sweep-next') === undefined) {
      this.store.set('screens-sweep-next', Date.now() + SCREEN_SWEEP_EVERY_MS)
      await this.rearm()
    }
    await this.tidySpill(Date.now())
  }

  /** Spill files older than 30 days go (ao-ry61); the Workspace is listed at most once a day for it. */
  protected async tidySpill(now: number): Promise<void> {
    const due = this.store.get<number>('spill-sweep-next')
    if (due !== undefined && due > now) return
    await sweepSpill(this.env.FILES, this.store.requireConfig().id, now)
    this.store.set('spill-sweep-next', now + SPILL_SWEEP_EVERY_MS)
  }

  /** Mr. Robot's reach: every login and skill its owner can grant (rb-b0rs). */
  private async refreshReach(): Promise<void> {
    const config = this.store.config()
    if (config === undefined) return
    ;[this.knownHosts, this.knownConnections, this.pluginsOn] = await Promise.all([this.home().hostsFor(config.ownerId), this.home().connectionsFor(config.ownerId), this.home().pluginsEnabled()])
    const [catalog, skills] = await Promise.all([this.home().catalog(config.ownerId, config.id), config.kind === 'mr-robot' ? this.home().skills(config.ownerId) : Promise.resolve([])])
    this.knownCatalog = catalog
    if (config.kind !== 'mr-robot') return
    this.store.setReach({ secrets: catalog.secrets.map((secret) => secret.name), skills: skills.map((skill) => skill.name), hosts: this.knownHosts.map((host) => host.id), connections: this.knownConnections.map((connection) => connection.id) })
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
    // Reviews, help requests and tool calls are each their own Ask: a new one never replaces an open one.
    const row = this.store.propose(kind, purpose, payload, Date.now(), (open) => kind === 'review' || kind === 'help' || kind === 'tool-call' ? false : kind !== 'member-file' || open.file?.name === (payload['file'] as { name?: string } | undefined)?.name)
    this.ctx.waitUntil(this.changed())
    // A request for help falls due 30 minutes on, or at once when urgent: the alarm must know.
    if (kind === 'help') this.ctx.waitUntil(this.rearm())
    const body = kind === 'help' ? `asks for help: ${purpose}` : kind === 'tool-call' ? `wants to use ${purpose}` : `${purpose}: waiting for your answer.`
    this.ctx.waitUntil(this.notifyMembers('needs you', body).catch(() => 0))
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
  answer(proposalId: string, revision: number, approve: boolean, approved?: readonly string[], scope?: string, note?: string): Promise<AnswerResult> {
    return this.program(Programs.answer(proposalId, revision, approve, approved, scope, note === undefined ? {} : { note }))
  }




  /**
   * Answer a help Ask (need_help): the first answer closes it and wakes the Robot with a labelled reply.
   * The owner's side calls this with their name; Mr. Robot's answer path calls it with 'mr-robot'.
   */
  answerHelp(requestId: string, text: string, answerer: HelpAnswerer): Promise<HelpAnswerResult> {
    return this.program(Programs.answerHelp(requestId, text, answerer))
  }

  /** Mr. Robot's recipients follow what his Member can reach (robot-70kf). */
  setRecipients(robotIds: readonly string[]): Promise<void> {
    return this.program(Programs.setRecipients(robotIds))
  }


  /** Advanced settings (robot-vqtw): every change takes effect on the next Turn. */
  updateSettings(patch: SettingsPatch, by?: string): Promise<RobotSettings> {
    return this.program(Programs.updateSettings(patch, by))
  }


  // ---------------------------------------------------------------- reporting and live updates

  protected owner(): { readonly id: string } & RobotOwner {
    return this.store.get<{ readonly id: string } & RobotOwner>('owner') ?? { id: this.store.requireConfig().ownerId, name: 'your owner' }
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

  /** The tool the registry row last showed, so a new event reports only when the running tool changed (mc-w6ff). */
  private reportedActivity: string | null = null

  private reportActivity(): void {
    const active = this.store.activeTurn()
    const activity = active === undefined ? null : runningTool(readStoredEvents(this.ctx.storage.sql, active.sessionId, active.startSeq)) ?? null
    if (activity === this.reportedActivity) return
    this.reportedActivity = activity
    this.ctx.waitUntil(this.report().catch(() => undefined))
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
    // Closing the window hands the browser back (pl-glfh): the Robot resumes, or an idle browser closes.
    // The chat's own socket of the same Member does not count: only a still-open browser view keeps the claim.
    // After hibernation getWebSockets returns new wrappers, so the closing socket is excluded by state, not identity.
    if (viewer !== null) { try { socket.serializeAttachment({ ...viewer, live: false } satisfies ViewerState) } catch { /* closed */ } }
    const stillViewing = viewer === null ? 0 : this.ctx.getWebSockets(viewer.memberId).filter((other) => other !== socket && other.readyState === WebSocket.OPEN && (other.deserializeAttachment() as ViewerState | null)?.live === true).length
    if (viewer !== null && takeover?.claimedBy === viewer.memberId && stillViewing === 0) {
      await this.handBack(viewer.memberId)
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
        const entries = await Promise.all(usableNames(this.store.effectiveGrants().secrets).map(async (name) => [name, await this.home().resolveLogin(config.ownerId, name)] as const))
        socket.send(JSON.stringify({ type: 'logins', entries: entries.flatMap(([name, entry]) => entry !== null && entryMatches(entry, page.url()) ? [{ name, username: entry.username }] : []) }))
        return
      }
      case 'fill': {
        const takeover = this.store.get<TakeoverState>('takeover')
        if (takeover?.claimedBy !== viewer.memberId) throw new Error('claim the browser first')
        const name = String(input['name'] ?? '')
        if (!this.store.mayUse('secret', name)) throw new Error(`"${name}" is not granted to this Robot`)
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
    const timing = this.openTiming
    if (timing !== undefined) timing.stages['screencast'] = Date.now() - timing.startedAt
    let first = true
    const onFrame = (frame: { data: string; sessionId: number; metadata: Record<string, number> }) => {
      if (first && timing !== undefined) {
        first = false
        timing.stages['firstFrame'] = Date.now() - timing.startedAt
        console.log('takeover open timing', JSON.stringify(timing))
        this.viewerStatus('')
        const report = JSON.stringify({ type: 'timing', backend: timing.backend, stages: timing.stages })
        for (const socket of this.ctx.getWebSockets()) { try { socket.send(report) } catch { /* closing */ } }
      }
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
    // A sign-in for a Connection: the tab's state is read and discarded, never saved for the Robot.
    if (this.store.get<TakeoverState>('takeover')?.capture !== undefined) {
      await this.endCapture()
      return
    }
    const page = await this.page()
    this.store.set('browser-state', await page.exportState())
    await this.saveScreen(await page.screenshot())
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
      text: `${member?.name ?? 'Your owner'} handed the browser back after "${takeover?.reason ?? 'the takeover'}". The page is now ${page.url()}. Observe the page before you continue.`,
    })
    await this.changed()
  }

  takeoverState(): TakeoverState | null {
    return this.store.get<TakeoverState>('takeover') ?? null
  }

  // ---------------------------------------------------------------- session capture through Takeover (v1.12 ticket 11, ux-8pek, ux-wgok, ux-j7m1)

  /** The attempt in progress, so a hand-back and the page's own end share one reading of the browser. */
  private capturing: Promise<SessionCapture> | undefined

  /**
   * Connect Slack or Discord as the owner from the PWA: this Mr. Robot's browser opens on the
   * service's sign-in page under a Takeover the owner takes. Hand-back, the page's end or the
   * ten-minute deadline reads the session (endCapture).
   */
  async startSessionCapture(kind: SignInKind): Promise<SessionCaptureStart> {
    const config = this.store.requireConfig()
    const name = config.identity.name
    if (config.kind !== 'mr-robot') return { ok: false, message: 'only Mr. Robot signs in to services for you' }
    if (this.store.activeTurn() !== undefined) return { ok: false, message: `${name} is working in its browser; try again when it has finished` }
    const current = this.store.get<TakeoverState>('takeover')
    if (current !== undefined && current.capture === undefined) return { ok: false, message: `${name}'s browser is waiting for you; take it over and hand it back first` }
    // An earlier attempt left open (another tab, a reload) ends first, its session discarded.
    if (current !== undefined) await this.endCapture()
    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS
    const takeover: TakeoverState = { reason: `Sign in to ${SERVICE[kind]}`, url: START_URL[kind], requestedAt: Date.now(), claimedBy: null, byOwner: true, capture: { kind, deadline } }
    // Stored before the browser opens, so a new session opens straight on the sign-in page.
    this.store.set('takeover', takeover)
    this.store.set('session-capture', { state: 'waiting', kind, deadline } satisfies SessionCapture)
    try {
      const page = await this.page()
      if (!onSiteDomain(pageHost(page.url()), SESSION_SITE[kind].domain)) await page.goto(START_URL[kind]).catch(() => undefined)
      this.store.set('takeover', { ...takeover, url: page.url(), sessionId: page.sessionId() } satisfies TakeoverState)
    } catch (error) {
      this.store.delete('takeover')
      const message = `${name}'s browser did not open: ${error instanceof Error ? error.message : String(error)}`
      this.store.set('session-capture', { state: 'failed', kind, message } satisfies SessionCapture)
      return { ok: false, message }
    }
    await this.rearm()
    await this.changed()
    return { ok: true, robotName: name }
  }

  /** Where the attempt for a kind is; none when the last one was for another kind. */
  async sessionCapture(kind: SignInKind): Promise<SessionCapture> {
    const known = this.store.get<SessionCapture>('session-capture')
    return known === undefined || known.state === 'none' || known.kind !== kind ? { state: 'none' } : known
  }

  /** The page's Takeover closed: end the attempt now and tell how it ended. */
  async endSessionCapture(kind: SignInKind): Promise<SessionCapture> {
    if (this.store.get<TakeoverState>('takeover')?.capture?.kind === kind) return this.endCapture()
    return this.capturing ?? this.sessionCapture(kind)
  }

  /** The alarm's check: an attempt past its deadline ends (ux-wgok). */
  private async expireCapture(now: number): Promise<void> {
    const deadline = this.store.get<TakeoverState>('takeover')?.capture?.deadline
    if (deadline !== undefined && deadline <= now) await this.endCapture()
  }

  private endCapture(): Promise<SessionCapture> {
    const capture = this.store.get<TakeoverState>('takeover')?.capture
    if (capture === undefined) return this.capturing ?? Promise.resolve(this.store.get<SessionCapture>('session-capture') ?? { state: 'none' })
    this.capturing ??= this.captureSession(capture.kind, capture.deadline).finally(() => { this.capturing = undefined })
    return this.capturing
  }

  /**
   * Read the session the owner signed in to, connect it through the paste path, then close the tab
   * and remove the service's cookies and storage from the browser and the Robot's saved state: the
   * session lives only in the Connection. The values never reach a Robot, a log or the page.
   */
  private async captureSession(kind: SignInKind, deadline: number): Promise<SessionCapture> {
    const site = SESSION_SITE[kind]
    const scope: BrowserSite = { domain: site.domain, origins: [site.storageOrigin] }
    const page = await this.page().catch(() => undefined)
    let outcome: SessionCapture
    try {
      const held = page === undefined ? undefined : await page.readSite(scope)
      const values = page === undefined || held === undefined ? undefined : sessionValues(kind, { url: page.url(), cookies: browserCookies(held.cookies), storage: held.storage[site.storageOrigin] ?? {} })
      outcome = values !== undefined ? await this.connectCaptured(kind, values)
        : Date.now() >= deadline ? { state: 'timedOut', kind }
          : { state: 'failed', kind, message: `no signed-in ${SERVICE[kind]} session was found in the browser` }
    } catch (error) {
      console.warn('session capture failed', error instanceof Error ? error.message : 'unknown')
      outcome = { state: 'failed', kind, message: `the browser could not be read` }
    }
    await this.discardSignIn(scope, page)
    this.store.delete('takeover')
    this.store.set('session-capture', outcome)
    // Wake-ups held while the owner had the browser run now.
    await this.rearm()
    if (this.store.pendingWakeups() > 0) this.drain()
    await this.changed()
    return outcome
  }

  private async connectCaptured(kind: SignInKind, values: Readonly<Record<string, string>>): Promise<SessionCapture> {
    const added = await Effect.runPromise(Effect.result(connectPastedValues(this.env, this.store.requireConfig().ownerId, kind, { shared: false, values })))
    return added._tag === 'Success' ? { state: 'connected', kind, account: added.success.account } : { state: 'failed', kind, message: `signing in worked, but connecting failed: ${added.failure.message}` }
  }

  /** The sign-in tab closes without saving its state; the service's part goes from the browser and from the saved state. */
  private async discardSignIn(site: BrowserSite, page: BrowserPage | undefined): Promise<void> {
    this.browserPage = undefined
    const running = this.screencast
    this.screencast = undefined
    await running?.stop()
    if (page !== undefined) {
      await page.forgetSite(site).catch((error: unknown) => console.warn('sign-in site not cleared', error instanceof Error ? error.message : 'unknown'))
      this.openedForViewer = false
      await page.close().catch(() => undefined)
      await this.accountBrowser(true)
    }
    const saved = this.store.get<BrowserState>('browser-state')
    if (saved !== undefined) this.store.set('browser-state', withoutSite(saved, site.domain))
    const url = this.store.get<string>('browser-url')
    if (url !== undefined && onSiteDomain(pageHost(url), site.domain)) this.store.delete('browser-url')
  }

  /** The model's output so far in this attempt, pushed to viewers as it grows (pl-jzr7); the stored log is unchanged. */
  private live = { text: '', thinking: '', sentAt: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined }

  private streamed(frame: { type: 'start' | 'chunk' | 'end'; chunk?: { type: string; text?: string } }): void {
    const live = this.live
    if (frame.type === 'start') {
      live.text = ''
      live.thinking = ''
      live.sentAt = 0
      return
    }
    if (frame.type === 'end') {
      // Text still waiting for the throttle goes out first.
      if (live.timer !== undefined) {
        clearTimeout(live.timer)
        this.broadcast({ type: 'stream', text: live.text, thinking: live.thinking.slice(-8_000) })
      }
      live.timer = undefined
      live.text = ''
      live.thinking = ''
      this.broadcast({ type: 'stream', text: '', thinking: '', done: true })
      return
    }
    if (frame.chunk?.type === 'text-delta') live.text += frame.chunk.text ?? ''
    else if (frame.chunk?.type === 'reasoning-delta') live.thinking += frame.chunk.text ?? ''
    else return
    // At most about eight updates a second; each carries the whole text so far.
    const send = () => {
      live.timer = undefined
      live.sentAt = Date.now()
      this.broadcast({ type: 'stream', text: live.text, thinking: live.thinking.slice(-8_000) })
    }
    if (Date.now() - live.sentAt >= 120) send()
    else live.timer ??= setTimeout(send, 120)
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



  /** Requests for help that stayed open 30 minutes, or are urgent, go to the owner's Mr. Robot (sk-35i9, sk-myhb). */
  private escalateHelp(now: number): Promise<void> {
    return this.program(Programs.escalateHelp(now))
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

  // ---------------------------------------------------------------- Threads between chiefs (v1.9)

  threadChiefs(): Promise<Array<{ id: string; ownerName: string; name: string; availability: string }>> {
    return this.program(Threads.chiefs)
  }

  threadOpen(chiefId: string, topic: string, scope: string): Promise<{ threadId: string; status: string }> {
    return this.program(Threads.open(chiefId, topic, scope))
  }

  threadSend(threadId: string, text: string, idempotencyKey: string): Promise<unknown> {
    return this.program(Threads.send(threadId, text, idempotencyKey))
  }

  threadClose(threadId: string, summary: string): Promise<unknown> {
    return this.program(Threads.close(threadId, summary))
  }

  threadList(): Promise<unknown> {
    return this.program(Threads.list)
  }

  /** The Home tells this chief about an invitation to answer (ch-vrl7, ch-hikl). */
  threadInvitation(view: ThreadView, phase: 'invitation-out' | 'invitation-in'): Promise<void> {
    return this.program(Threads.invitation(view, phase))
  }

  /** The Home tells this chief that a Thread opened, was declined, closed or went idle. */
  threadChanged(view: ThreadView, event: ThreadEvent, wake: boolean): Promise<void> {
    return this.program(Threads.changed(view, event, wake))
  }

  configureRobot(id: string, change: { name?: string; title?: string; description?: string; avatarColor?: string }): Promise<{ id: string; identity: unknown }> {
    return this.program(DeputyPrograms.configure(id, change))
  }


  // ---------------------------------------------------------------- Routines become Tasks (v1.13 ticket 05)

  /** The Robot's Routines and their runs, for the Home to store as Tasks; none once its tables are gone. */
  exportRoutines(): ExportedRoutine[] {
    return exportRoutines(this.ctx.storage.sql)
  }

  /** The Home stored them as Tasks: the Routine tables go. */
  dropRoutines(): void {
    dropRoutines(this.ctx.storage.sql)
  }

  // ---------------------------------------------------------------- views

  conversationView(details = false): Promise<Conversation> {
    return this.program(Views.conversationView(details))
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
    return this.program(Views.conversation())
  }

  /** The chat, newest item first, a page at a time: what another Robot reads for the owner (cd-gjhb). */
  conversationPage(page = 1): Promise<ConversationPage> {
    return this.program(Views.conversationPage(page))
  }

  /** A capped excerpt of the Trajectory around one chat item (cd-9te1). */
  trajectoryAround(itemId: string, before = 3, after = 15): Promise<TrajectoryExcerpt> {
    return this.program(Views.trajectoryAround(itemId, before, after))
  }

  /** Text search over this Robot's Conversation, newest first, paged (cd-ggem). */
  searchConversation(query: string, page = 1): Promise<ConversationSearchResult> {
    return this.program(Views.searchConversation(query, page))
  }




  /** Replace secret values with a mask (robot-4zi6); stored history is already redacted at write. */
  protected mask(text: string): string {
    return maskSecrets(text, [...this.secretValues, ...this.turnSecrets])
  }

  /** The Workspace as the Files view lists it (rb-1miy): persona and memory first, then the rest. */
  async files(): Promise<WorkspaceFileView[]> {
    const stored = (await this.run(this.workspace.list(''))).filter((entry) => !isDocsPath(entry.path))
    // The product docs come from the Worker bundle, never from R2 (v1.11 ticket 02).
    const bundled = PRODUCT_DOCS.map((entry) => ({ path: entry.path, size: new TextEncoder().encode(entry.text).length, uploaded: 0, etag: '' }))
    const entries = [...stored, ...bundled]
    const order = (path: string) => { const index = (PERSONA_FILES as readonly string[]).indexOf(path); return index === -1 ? PERSONA_FILES.length : index }
    const group = (path: string): WorkspaceFileView['group'] =>
      (PERSONA_FILES as readonly string[]).includes(path) ? 'persona'
        : isDocsPath(path) ? 'docs'
        : /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(path) ? 'daily'
          : path.startsWith('skills/') ? 'skills'
            : path.startsWith('screens/') ? 'screens'
              : path.startsWith('spill/') ? 'spill'
                : 'other'
    return entries
      .map((entry) => ({ path: entry.path, size: entry.size, updatedAt: entry.uploaded, group: group(entry.path) }))
      .sort((a, b) => order(a.path) - order(b.path) || (a.group === 'daily' && b.group === 'daily' ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path)))
  }

  /** One file for the editor; binary and large files are read-only (rb-q5eb). */
  /** A Workspace file as bytes, for preview and download (pl-ojbr). */
  async fileRaw(path: string): Promise<{ body: ArrayBuffer; mediaType: string } | undefined> {
    if (isDocsPath(path)) {
      const bundled = productDoc(path)
      return bundled === undefined ? undefined : { body: new TextEncoder().encode(bundled.text).buffer as ArrayBuffer, mediaType: mediaTypeOf(path) }
    }
    const file = await this.run(this.workspace.read(path))
    if (file === undefined) return undefined
    return { body: file.body as ArrayBuffer, mediaType: mediaTypeOf(path) }
  }

  async fileContent(path: string): Promise<WorkspaceFileContent> {
    if (isDocsPath(path)) {
      const bundled = productDoc(path)
      if (bundled === undefined) throw Object.assign(new Error(`no file "${path}"`), { name: 'NotFound', status: 404 })
      return { path, size: new TextEncoder().encode(bundled.text).length, text: bundled.text, readOnly: true, note: 'Product docs belong to the platform. They are read-only and a new release updates them.' }
    }
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
  async saveFile(path: string, content: string, by?: string): Promise<WorkspaceFileContent> {
    if (isDocsPath(path)) throw Object.assign(new Error(docsReadOnlyMessage(path)), { name: 'Invalid', status: 400 })
    const current = await this.run(this.workspace.stat(path))
    if (current !== undefined && current.size > MAX_EDITABLE_BYTES) throw Object.assign(new Error('this file is too large to edit here'), { name: 'Invalid', status: 400 })
    await this.run(this.workspace.write(path, content, path.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8'))
    await this.memoryChanged(path, by ?? 'your owner')
    const config = this.store.requireConfig()
    this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `${by ?? this.owner().name} edited ${path}.`, Date.now())
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

  async skillLibrary(): Promise<SkillLibraryRow[]> {
    const config = this.store.requireConfig()
    return this.home().skillLibrary(config.ownerId, { id: config.id, held: this.heldSkills() }, config.kind === 'mr-robot')
  }

  async promoteSkill(name: string, visibility: 'home' | 'private'): Promise<{ proposalId: string }> {
    const content = await this.run(this.workspace.readText(`skills/${name}/SKILL.md`))
    if (content === undefined) throw new Error(`You have no local skill "${name}". Write it with skill_write first.`)
    const description = skillFrontmatter(content).description
    const proposal = this.propose('skill', `Publish the skill "${name}"`, { skill: { name, description }, content, visibility })
    return { proposalId: proposal.id }
  }

// ---------------------------------------------------------------- memory (v1.3 ticket 02)

  /** Someone else changed a file this Robot reads; the note goes out with its next model step (pl-9n7w). */
  async memoryChanged(path: string, by: string): Promise<void> {
    const pending = this.store.get<MemoryChange[]>('memory-changes') ?? []
    this.store.set('memory-changes', [...pending, { path, by }].slice(-50))
  }

  /**
   * Another Member's connection stopped being shared with the Home (v1.12, ux-dz8p): its grant rows go,
   * and a Robot that held it hears the notice at its next Turn. Mr. Robot held it unless his owner
   * lowered it to deny. Returns whether this Robot held it.
   */
  async connectionWithdrawn(connectionId: string, notice: string): Promise<boolean> {
    const config = this.store.config()
    if (config === undefined || config.status === 'deleted') return false
    const names = [connectionId, `${connectionId}:write`]
    const grants = this.store.grants()
    const held = config.kind === 'mr-robot'
      ? grants.connections[connectionId] !== 'deny'
      : names.some((name) => usableLevel(grants.connections[name] ?? 'deny'))
    const connections = Object.fromEntries(Object.entries(grants.connections).filter(([name]) => !names.includes(name)))
    if (Object.keys(connections).length !== Object.keys(grants.connections).length) this.store.setGrants({ ...grants, connections })
    if (!held) return false
    const pending = this.store.get<MemoryChange[]>('memory-changes') ?? []
    this.store.set('memory-changes', [...pending, { path: 'connections', by: 'the platform', notice }].slice(-50))
    // The next Turn composes again without the connection's tools.
    this.store.updateConfig(() => ({}))
    await this.changed()
    return true
  }

  /** The owner's name or nickname changed (ux-nwi1): the prompt and my_capabilities name them the new way from the next request. */
  async ownerChanged(owner: RobotOwner): Promise<void> {
    const config = this.store.config()
    if (config === undefined || config.status === 'deleted') return
    this.store.set('owner', { id: config.ownerId, ...owner })
  }

  /**
   * The owner's profile zone changed (v1.11 ticket 08). The Robot's zone is the owner's, so the next Turn and
   * daily notes use the new one, and the model hears it once with its next step. Recurring Tasks move at the Home.
   */
  async timeZoneChanged(timeZone: string): Promise<void> {
    const config = this.store.config()
    if (config === undefined || config.status === 'deleted' || config.timeZone === timeZone) return
    this.store.transaction(() => {
      this.store.updateConfig(() => ({ timeZone }))
      const pending = this.store.get<MemoryChange[]>('memory-changes') ?? []
      this.store.set('memory-changes', [...pending, { path: 'time zone', by: 'your owner', notice: `Your owner's time zone changed to ${timeZone}. Daily notes, recurring Tasks and clock times use it from now on.` }].slice(-50))
    })
    await this.rearm()
    await this.changed()
  }

  /** Every memory file in scope: the Home, the owner, and this Robot's own (pl-o3ck, pl-fkg7, pl-yqno). */
  async memoryFiles(): Promise<MemoryFile[]> {
    const config = this.store.requireConfig()
    const own = [...PERSONA_FILES, ...dailyNotePaths(Date.now(), config.timeZone)]
    const [robotFiles, member, home] = await Promise.all([
      this.run(Effect.forEach(own, (path) => this.workspace.readText(path).pipe(Effect.map((content) => ({ scope: 'robot' as const, path, content: content ?? '' }))), { concurrency: 8 })),
      this.env.MEMBER.getByName(config.ownerId).files().catch(() => ({}) as Record<string, string>),
      this.home().homeMemory().catch(() => ''),
    ])
    return [
      { scope: 'home', path: 'HOME.md', content: home },
      ...Object.entries(member).map(([path, content]): MemoryFile => ({ scope: 'member', path, content })),
      ...robotFiles,
    ]
  }

  memoryChanges(): MemoryChange[] {
    return this.store.get<MemoryChange[]>('memory-changes') ?? []
  }

  needsBaseline(sessionId: string): boolean {
    return this.store.get<string>('memory-baseline') !== sessionId
  }

  memoryDelivered(sessionId: string, baseline: boolean): void {
    this.store.delete('memory-changes')
    if (baseline) this.store.set('memory-baseline', sessionId)
  }

  /** Mr. Robot writes shared memory directly; every other Robot of the owner (or the Home) is told. */
  private async writeShared(file: SharedFile, content: string): Promise<void> {
    const config = this.store.requireConfig()
    if (file === 'HOME.md') await this.home().setHomeMemory(content, config.identity.name, config.id)
    else await this.env.MEMBER.getByName(config.ownerId).writeFile(file, content, config.identity.name, config.id)
  }

  private memoryHost(config: RobotConfig): MemoryHost {
    return {
      memoryFiles: () => this.memoryFiles(),
      memoryChanges: () => this.memoryChanges(),
      needsBaseline: (sessionId) => this.needsBaseline(sessionId),
      memoryDelivered: (sessionId, baseline) => this.memoryDelivered(sessionId, baseline),
      shared: config.kind === 'mr-robot'
        ? { kind: 'mr-robot', write: (file: SharedFile, content: string) => this.writeShared(file, content) }
        : { kind: 'robot', propose: (kind, purpose, payload) => this.propose(kind, purpose, payload) },
    }
  }

  /** The owner deleted a file (a local skill, an old note). */
  async deleteFile(path: string, by?: string): Promise<void> {
    if (isDocsPath(path)) throw Object.assign(new Error(docsReadOnlyMessage(path)), { name: 'Invalid', status: 400 })
    await this.run(this.workspace.remove(path))
    await this.memoryChanged(path, `${by ?? 'your owner'} (deleted)`)
    if (by !== undefined) {
      const config = this.store.requireConfig()
      this.store.addNotice(config.liveSessionId, storedLength(this.ctx.storage.sql, config.liveSessionId), `${by} deleted ${path}.`, Date.now())
      await this.changed()
    }
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
    this.store.addServiceUsage(currentMonth(), 'exa', 1, cost)
    if (cost > 0) {
      await this.recordUsage('services', 0, 0, cost)
      await this.checkLimits()
    }
  }

  /** Granted login entries and whether each belongs to the open page (rb-vpes). */
  async logins(): Promise<Array<{ name: string; username: string; websites: readonly string[]; matchesPage: boolean; readable: boolean }>> {
    const config = this.store.requireConfig()
    const url = this.browserPage === undefined ? null : (await this.browserPage.catch(() => undefined))?.url() ?? null
    const entries = await Promise.all(usableNames(this.store.effectiveGrants().secrets).map(async (name) => [name, await this.home().resolveLogin(config.ownerId, name)] as const))
    return entries.flatMap(([name, entry]) => entry === null ? [] : [{ name, username: entry.username, websites: entry.websites, matchesPage: url !== null && entryMatches(entry, url), readable: entry.allowRead }])
  }

  /**
   * Fill a granted entry into the open page (rb-e1ic): the Robot DO types it over CDP, so the password
   * never passes through the model's program or the conversation, and it is masked if a page echoes it.
   */
  async fillLogin(name: string): Promise<string> {
    const config = this.store.requireConfig()
    if (!this.store.mayUse('secret', name)) throw new Error(`The login "${name}" is not granted to you. Ask with propose_grants.`)
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
    if (!filled.password) throw new Error(`No password field is visible on ${url}. Open the login form (or its next step) and try again.`)
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
    const granted = usableNames(this.store.effectiveGrants().secrets)
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


  /** Every grantable item with the level this Robot holds on it (sk-e1hh, sk-ixvp): the one list settings, my_capabilities and the prompt share. */
  private capabilityItems(): CapabilityItem[] | undefined {
    return this.knownCatalog === undefined ? undefined : capabilityItems(this.knownCatalog, this.store.effectiveGrants())
  }

  private capabilityInput(): { capabilities?: CapabilityItem[] } {
    const items = this.capabilityItems()
    return items === undefined ? {} : { capabilities: items }
  }

  /** The my_capabilities tool: the list as it is now, read fresh. */
  async capabilities(): Promise<CapabilitiesView> {
    await this.refreshReach()
    return capabilitiesView(this.capabilityItems() ?? [], this.owner())
  }

  async settings(): Promise<RobotSettings> {
    await this.reachForView()
    return this.program(Programs.settings)
  }

  /** Mr. Robot's settings show his real levels (sk-8llz): what his owner reaches now, not at his last Turn. */
  private async reachForView(): Promise<void> {
    if (this.store.config()?.kind === 'mr-robot') await this.refreshReach().catch((error: unknown) => console.warn('reach not refreshed', error))
  }


  /** `tasks`: the Robot's Tasks the viewer may see, from the Home. */
  async panel(canEdit: boolean, summary: RobotSummary, tasks: readonly TaskView[]): Promise<RobotPanel> {
    await this.reachForView()
    return this.program(Views.panel(canEdit, summary, tasks))
  }





  /** Filled by the browser and usage tickets. */




  /** Names of the tools the current composition registers (what the model may call). */
  toolNames(): string[] {
    const config = this.store.requireConfig()
    return this.mounts(config).flatMap(({ plugin, config: options }) => [...plugin.toolNames(options as never)])
  }

  /** One row of the admin fleet list, from the DO itself (robot-x26m). */
  /** `home` is the Home's per-Robot spend limit, which the row's limit in effect may follow. */
  adminRow(home: HomeSpendLimit): Promise<{ fleetState: FleetState; status: RobotConfig['status']; grants: GrantSet; model: ModelChoice; usage: UsageView } | null> {
    return this.program(Views.adminRow(home))
  }


  openProposals(): ProposalView[] {
    return this.store.proposals('open').map(proposalView)
  }

  /**
   * Mr. Robot, as his owner's deputy, calls one of this Robot's owner-side methods (cd-*). Reach and
   * ownership were checked by the caller; an expected failure comes back as a value, not as an RPC exception.
   */
  forDeputy(method: DeputyPrograms.DeputyMethod, args: readonly unknown[]): Promise<DeputyPrograms.DeputyOutcome> {
    return DeputyPrograms.answer(method, () => (this[method] as (...given: unknown[]) => unknown).apply(this, [...args]))
  }

  status(): Promise<{ status: RobotConfig['status']; fleetState: FleetState }> {
    return this.program(Views.status)
  }

}


interface ViewerState {
  readonly memberId: string
  readonly live: boolean
}

/** Whether the sign-in page opened in Mr. Robot's browser, or why not. */
export type SessionCaptureStart = { readonly ok: true; readonly robotName: string } | { readonly ok: false; readonly message: string }

export interface TakeoverState {
  readonly reason: string
  readonly url: string
  readonly requestedAt: number
  readonly claimedBy: string | null
  /** The Browser Rendering session to reattach after the Robot's DO restarts. */
  readonly sessionId?: string
  /** The owner opened the browser themselves; hand-back does not wake the Robot. */
  readonly byOwner?: boolean
  /** The owner signs in to a service here to connect it (v1.12 ticket 11); hand-back reads the session. */
  readonly capture?: { readonly kind: SignInKind; readonly deadline: number }
}

/** A page's host name; empty for about:blank and anything that is not a URL. */
function pageHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Cookies as the browser reported them, with the fields a session is read from. */
function browserCookies(cookies: BrowserState['cookies']): Array<{ name: string; value: string; domain?: string }> {
  return cookies.flatMap((cookie) => {
    const { name, value, domain } = cookie
    return typeof name === 'string' && typeof value === 'string' ? [{ name, value, ...(typeof domain === 'string' ? { domain } : {}) }] : []
  })
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
      // A key pressed on the focused takeover screen (pl-485j): special keys and shortcuts with modifiers.
      const key = String(input['key'] ?? 'Enter')
      const code = String(input['code'] ?? key)
      const modifiers = Number(input['modifiers'] ?? 0)
      const keyCode = KEY_CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
      return
    }
    case 'scroll':
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: Number(input['dy'] ?? 0) })
      return
  }
}

const KEY_CODES: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34, ' ': 32 }

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

/** 32 random bytes, URL-safe. */
function newWebhookKey(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function runnable(config: RobotConfig): boolean {
  return config.status === 'active' || config.status === 'setup'
}

/** The memory baseline's byte budget (pl-jsdm). */
const MEMORY_BYTES = 32_768

/** Files above this size open read-only in the Files view. */
const MAX_EDITABLE_BYTES = 256 * 1024

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function optionalString(payload: Record<string, unknown>, key: string): Record<string, string> {
  const value = payload[key]
  return typeof value === 'string' ? { [key]: value } : {}
}

/** Two texts as paragraphs; an empty one is left out. */
function joinText(first: string, second: string): string {
  return [first, second].filter((text) => text !== '').join('\n\n')
}

const MEDIA_TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json', html: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip',
}

/** The content type a file is served with; HTML and SVG-like scripts are never rendered as pages. */
function mediaTypeOf(path: string): string {
  return MEDIA_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

/** The kv key of the result line task_done gave the Turn's own Task. */
const DONE_LINE = 'task-done-line'

/** The kv key of who interrupted the running Turn, until the Turn has ended. */
const INTERRUPTED_BY = 'interrupted-by'
/** The last request of the Robot's session, kept for cache warming while idle (ao-jlr0). */
const WARM_REQUEST = 'warm-request'
/** A warming more than this late is skipped: the cache it would refresh is gone. */
const IDLE_LATE_MS = 5 * 60_000

/** Who started a Task Wake-up, from its payload: the schedule unless a person or a Robot ran it now. */
function taskRunOf(payload: Record<string, unknown>): { by: TaskRunBy; who?: string } {
  const by = payload['by'] === 'member' || payload['by'] === 'robot' ? payload['by'] : 'schedule'
  return typeof payload['who'] === 'string' ? { by, who: payload['who'] } : { by }
}

/** What the chat needs to show one joined follow-up as its own message: the app's id and its files. */
function joinedPart(wakeup: Wakeup): JoinedPart {
  const clientId = wakeup.payload['clientId']
  return { ...(typeof clientId === 'string' ? { clientId } : {}), attachments: (wakeup.payload['attachments'] as Attachment[] | undefined) ?? [] }
}
