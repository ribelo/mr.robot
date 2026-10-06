/**
 * Shapes shared by the edge Worker, the Durable Objects and the PWA.
 * Vocabulary follows GLOSSARY.md. Request bodies are Effect Schemas so the edge
 * validates what it accepts; views are plain types the PWA renders.
 */
import * as Schema from 'effect/Schema'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

// ---------------------------------------------------------------- Home, Members

export type MemberRole = 'admin' | 'member'
export type MemberStatus = 'active' | 'invited' | 'removed'

export interface MemberView {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly role: MemberRole
  readonly status: MemberStatus
}

export interface Me extends MemberView {
  readonly home: string
  readonly timeZone: string
  readonly quietHours: QuietHours | null
  readonly vapidPublicKey: string
}

export const QuietHours = Schema.Struct({
  /** Local start, "HH:MM". */
  start: Schema.String,
  /** Local end, "HH:MM"; may be earlier than start (overnight). */
  end: Schema.String,
})
export type QuietHours = typeof QuietHours.Type

export const MemberPreferences = Schema.Struct({
  name: Schema.optional(Schema.String),
  timeZone: Schema.optional(Schema.String),
  quietHours: Schema.optional(Schema.NullOr(QuietHours)),
})

// ---------------------------------------------------------------- Robots

export type RobotStatus = 'setup' | 'active' | 'paused' | 'blocked' | 'deleted'
/** What the admin fleet view shows for a Robot. */
export type FleetState = 'sleeping' | 'working' | 'waiting for you' | 'paused' | 'blocked' | 'setup'
export type Sharing = 'private' | 'home'
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'max'

export const Identity = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  avatarColor: Schema.String,
})
export type Identity = typeof Identity.Type

export const GrantKind = Schema.Literals(['tool', 'skill', 'recipient', 'secret'])
export type GrantKind = typeof GrantKind.Type

export const GrantSet = Schema.Struct({
  tools: Schema.Array(Schema.String),
  skills: Schema.Array(Schema.String),
  recipients: Schema.Array(Schema.String),
  secrets: Schema.Array(Schema.String),
})
export type GrantSet = typeof GrantSet.Type
export const emptyGrants: GrantSet = { tools: [], skills: [], recipients: [], secrets: [] }

export const ModelChoice = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  effort: Schema.Literals(['off', 'low', 'medium', 'high', 'max']),
})
export type ModelChoice = typeof ModelChoice.Type

export const NotificationSettings = Schema.Struct({
  enabled: Schema.Boolean,
  /** Members notified; empty means the owner only. */
  members: Schema.Array(Schema.String),
  /** Enabled Channels by id; "pwa" is always present. */
  channels: Schema.Array(Schema.String),
})
export type NotificationSettings = typeof NotificationSettings.Type

/** Everything the advanced settings page edits. */
export interface RobotSettings {
  readonly identity: Identity
  readonly sharing: Sharing
  readonly model: ModelChoice
  readonly contextBudget: number
  readonly codeMode: boolean
  readonly compactionInstruction: string
  readonly grants: GrantSet
  readonly notifications: NotificationSettings
  /** Monthly limit in USD; null inherits the Home default. */
  readonly spendLimitUsd: number | null
  /** Keep the Robot's browser open between Turns and wake it when a page shows a notification (robot-lulc). */
  readonly wakeOnScreenNotifications: boolean
}

export const SettingsPatch = Schema.Struct({
  identity: Schema.optional(Identity),
  sharing: Schema.optional(Schema.Literals(['private', 'home'])),
  model: Schema.optional(ModelChoice),
  contextBudget: Schema.optional(Schema.Number),
  codeMode: Schema.optional(Schema.Boolean),
  wakeOnScreenNotifications: Schema.optional(Schema.Boolean),
  compactionInstruction: Schema.optional(Schema.String),
  grants: Schema.optional(GrantSet),
  notifications: Schema.optional(NotificationSettings),
  spendLimitUsd: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type SettingsPatch = typeof SettingsPatch.Type

/** One row of the robot list. */
export interface RobotSummary {
  readonly id: string
  readonly ownerId: string
  readonly ownerName: string
  readonly kind: 'mr-robot' | 'robot'
  readonly identity: Identity
  readonly sharing: Sharing
  readonly status: RobotStatus
  readonly fleetState: FleetState
  readonly lastLine: string
  readonly lastAt: number
  readonly unread: boolean
  /** This person's list settings (robot-mktj). */
  readonly pinned?: boolean
  readonly hidden?: boolean
}

export interface RobotPanel {
  readonly summary: RobotSummary
  readonly settings: RobotSettings
  readonly routines: readonly RoutineView[]
  readonly screen: ScreenView | null
  readonly usage: UsageView
  readonly canEdit: boolean
  /** The Robot asked for a takeover of its browser (robot-doqx). */
  readonly takeover: { readonly reason: string; readonly claimedBy: string | null } | null
}

export interface ScreenView {
  /** Workspace path of the last screenshot. */
  readonly path: string
  readonly url: string
  readonly at: number
}

// ---------------------------------------------------------------- Routines

export const RoutineSchedule = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('once'), at: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('interval'), everyMinutes: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal('daily'), time: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('weekly'), time: Schema.String, weekdays: Schema.Array(Schema.Number) }),
  Schema.Struct({ kind: Schema.Literal('cron'), expression: Schema.String }),
])
export type RoutineSchedule = typeof RoutineSchedule.Type

export interface RoutineView {
  readonly id: string
  readonly robotId: string
  readonly name: string
  readonly prompt: string
  readonly schedule: RoutineSchedule
  readonly timeZone: string
  readonly summary: string
  readonly nextRun: number | null
  readonly lastRun: number | null
  /** Paused by its owner: it keeps its schedule but does not run (robot-qhll). */
  readonly paused: boolean
  /** The schedule as a cron line with its time zone, when it has one ("CRON_TZ=Europe/Warsaw 0 9 * * 1-5"). */
  readonly cron: string | null
  /** The latest runs, newest first (robot-l3gr). */
  readonly runs: ReadonlyArray<{ readonly at: number; readonly outcome: 'running' | 'done' | 'failed'; readonly summary: string }>
}

// ---------------------------------------------------------------- Conversation

export interface Attachment {
  readonly name: string
  /** Workspace path, e.g. attachments/2026-10-06/report.pdf */
  readonly path: string
  readonly size: number
  readonly contentType: string
}

/** Who sent a message into a Robot's Conversation. */
export type Sender =
  | { readonly kind: 'member'; readonly memberId: string; readonly name: string }
  | { readonly kind: 'robot'; readonly robotId: string; readonly name: string; readonly avatarColor: string }
  | { readonly kind: 'routine'; readonly routineId: string; readonly name: string }
  | { readonly kind: 'channel'; readonly channel: string; readonly from: string }
  | { readonly kind: 'platform' }

/** One item of the simple chat view. */
export type ChatItem =
  | {
    readonly kind: 'message'
    readonly id: string
    readonly seq: number
    readonly at: number
    readonly sender: Sender
    readonly text: string
    readonly attachments: readonly Attachment[]
    readonly reaction: string | null
  }
  | { readonly kind: 'reply'; readonly id: string; readonly seq: number; readonly at: number; readonly text: string }
  | { readonly kind: 'routine'; readonly id: string; readonly seq: number; readonly at: number; readonly action: 'created' | 'updated' | 'deleted' | 'ran'; readonly name: string }
  | { readonly kind: 'question'; readonly id: string; readonly seq: number; readonly at: number; readonly proposal: ProposalView }
  | { readonly kind: 'notice'; readonly id: string; readonly seq: number; readonly at: number; readonly text: string }
  /** Tools the Robot used in one step, shown collapsed (robot-gr94). */
  | { readonly kind: 'activity'; readonly id: string; readonly seq: number; readonly at: number; readonly tools: readonly string[] }
  | { readonly kind: 'working'; readonly id: string; readonly seq: number; readonly at: number }

export interface Conversation {
  readonly robotId: string
  readonly items: readonly ChatItem[]
  readonly working: boolean
  /** While working: the tool running now, if any (robot-gr94). */
  readonly activity?: string
  /** The last Turn failed and can be run again. */
  readonly canRetry?: boolean
}

/** One raw event of the Trajectory, with secrets masked; data is JSON text. */
export interface TrajectoryEvent {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly turn: number | null
  readonly data: string
}

export interface Trajectory {
  readonly robotId: string
  readonly sessionId: string
  readonly events: readonly TrajectoryEvent[]
  readonly rewinds: readonly RewindView[]
}

export interface RewindView {
  readonly id: string
  readonly atSeq: number
  readonly archivedSessionId: string
  readonly liveSessionId: string
  readonly at: number
  readonly undone: boolean
}

// ---------------------------------------------------------------- Grant proposals and questions

export type ProposalKind = 'setup' | 'grants' | 'member-file' | 'skill' | 'takeover'

export interface ProposalView {
  readonly id: string
  readonly kind: ProposalKind
  readonly revision: number
  readonly status: 'open' | 'approved' | 'rejected' | 'superseded' | 'done'
  readonly purpose: string
  /** Grants asked for (setup, grants). */
  readonly grants: GrantSet | null
  /** Member file edit: file name and the full proposed content. */
  readonly file: { readonly name: string; readonly content: string } | null
  /** Skill proposed to the library. */
  readonly skill: { readonly name: string; readonly description: string } | null
}

export const ProposalAnswer = Schema.Struct({
  revision: Schema.Number,
  approve: Schema.Boolean,
})

// ---------------------------------------------------------------- Providers (robot-dic7, robot-lzu3, robot-7v9s)

export type ProviderName = 'deepseek' | 'openrouter' | 'workers-ai' | 'openai' | 'anthropic' | 'opencode-go'

export interface ProviderView {
  readonly provider: ProviderName
  readonly kind: 'api-key' | 'oauth'
  readonly shared: boolean
  readonly connectedAt: number
  readonly ownerId: string
  readonly ownerName: string
}

export interface ProvidersView {
  /** The caller's own credentials. */
  readonly mine: readonly ProviderView[]
  /** Credentials other Members share with the Home. */
  readonly shared: readonly ProviderView[]
  readonly models: readonly ModelOption[]
  readonly defaultModel: ModelChoice
}

/** An OpenCode Go key pool, keys masked (ticket 19). */
export interface OpencodeKeysView {
  readonly keys: ReadonlyArray<{ readonly id: string; readonly masked: string }>
  readonly activeId: string | null
  readonly shared: boolean
}

export const ApiKeyInput = Schema.Struct({ key: Schema.String, shared: Schema.Boolean })
export const OAuthFinish = Schema.Struct({ pasted: Schema.optional(Schema.String), shared: Schema.Boolean })
export const ShareInput = Schema.Struct({ shared: Schema.Boolean })
export const HomeSettingsPatch = Schema.Struct({
  defaultModel: Schema.optional(ModelChoice),
  robotSpendLimitUsd: Schema.optional(Schema.NullOr(Schema.Number)),
  memberSpendLimitUsd: Schema.optional(Schema.NullOr(Schema.Number)),
  models: Schema.optional(Schema.Array(Schema.Struct({
    provider: Schema.String,
    model: Schema.String,
    label: Schema.String,
    contextWindow: Schema.Number,
    price: Schema.optional(Schema.Struct({ input: Schema.Number, output: Schema.Number, cachedInput: Schema.optional(Schema.Number) })),
  }))),
})

// ---------------------------------------------------------------- Admin view (robot-x26m, robot-1rap, robot-bvme)

export interface FleetRow extends RobotSummary {
  readonly grants: GrantSet
  readonly model: ModelChoice
  readonly usage: UsageView
}

export interface AdminView {
  readonly fleet: readonly FleetRow[]
  readonly routines: ReadonlyArray<RoutineView & { readonly robotName: string; readonly ownerName: string }>
  readonly members: ReadonlyArray<MemberView & { readonly usage: UsageView }>
  readonly skills: readonly SkillView[]
  readonly skillRepository: { readonly repo: string; readonly ref: string; readonly path: string } | null
  readonly providers: ReadonlyArray<{ readonly provider: string; readonly ownerName: string; readonly shared: boolean }>
  /** Each Provider's live model list: how many models, when fetched, and the last error. */
  readonly modelLists?: ReadonlyArray<{ readonly provider: string; readonly count: number; readonly fetchedAt: number | null; readonly error: string | null }>
  readonly settings: { readonly defaultModel: ModelChoice; readonly robotSpendLimitUsd: number | null; readonly memberSpendLimitUsd: number | null; readonly models: readonly ModelOption[] }
}

// ---------------------------------------------------------------- Skills (robot-7qpi)

export interface SkillView {
  readonly name: string
  readonly description: string
  readonly source: 'git' | 'robot'
  readonly visibility: 'home' | 'private'
  readonly ownerId: string | null
  readonly updatedAt: number
}

export const SkillRepositoryInput = Schema.Struct({
  repo: Schema.String,
  ref: Schema.String,
  path: Schema.String,
  token: Schema.optional(Schema.String),
})

// ---------------------------------------------------------------- What a Robot's settings can choose from

export interface ModelOption {
  readonly provider: string
  readonly model: string
  readonly label: string
  readonly contextWindow: number
  /** USD per million tokens; subscription models cost 0 here (the plan is paid flat). */
  readonly price?: { readonly input: number; readonly output: number; readonly cachedInput?: number }
  /** OpenCode Go: the API format this model speaks (from models.dev). */
  readonly wire?: 'chat' | 'anthropic' | 'responses'
}

export interface SettingsCatalog {
  readonly toolGroups: ReadonlyArray<{ readonly name: string; readonly description: string }>
  readonly skills: ReadonlyArray<{ readonly name: string; readonly description: string }>
  readonly robots: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly secrets: ReadonlyArray<{ readonly name: string; readonly scope: 'member' | 'home' }>
  readonly models: readonly ModelOption[]
  /** Models of Providers this Member has not connected; shown so the list explains itself. */
  readonly unavailableModels?: readonly ModelOption[]
}

// ---------------------------------------------------------------- Notifications (robot-9xoj)

export type NotificationKind = 'finished' | 'needs you' | 'blocked'

export const PushSubscriptionInput = Schema.Struct({
  endpoint: Schema.String,
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
  device: Schema.optional(Schema.String),
})

// ---------------------------------------------------------------- Usage

export interface UsageView {
  readonly month: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number
  readonly limitUsd: number | null
}

/** One row of the cost table: a Robot's or a Member's month. */
export interface UsageRow extends UsageView {
  readonly robotId: string | null
  readonly memberId: string
  readonly name: string
}

// ---------------------------------------------------------------- Requests

export const SendMessage = Schema.Struct({
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    size: Schema.Number,
    contentType: Schema.String,
  }))),
})
export type SendMessage = typeof SendMessage.Type

/** Rewind to an event, or to before a Turn (its message included). */
export const RewindRequest = Schema.Struct({ atSeq: Schema.optional(Schema.Number), beforeTurn: Schema.optional(Schema.Number) })