/**
 * Shapes shared by the edge Worker, the Durable Objects and the PWA.
 * Vocabulary follows GLOSSARY.md. Request bodies and views are Effect Schemas: the edge
 * validates what it accepts, and the PWA decodes every response at its boundary (fe-tln3).
 * Unknown keys in a response are ignored; an unknown variant of a closed union fails decoding.
 */
import * as Schema from 'effect/Schema'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

// ---------------------------------------------------------------- Home, Members

export const MemberRole = Schema.Literals(['admin', 'member'])
export type MemberRole = typeof MemberRole.Type
export const MemberStatus = Schema.Literals(['active', 'invited', 'removed'])
export type MemberStatus = typeof MemberStatus.Type

export const MemberView = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  role: MemberRole,
  status: MemberStatus,
})
export type MemberView = typeof MemberView.Type

export const WorkDetails = Schema.Literals(['compact', 'standard', 'detailed', 'verbose'])
export type WorkDetails = typeof WorkDetails.Type

export const QuietHours = Schema.Struct({
  /** Local start, "HH:MM". */
  start: Schema.String,
  /** Local end, "HH:MM"; may be earlier than start (overnight). */
  end: Schema.String,
})
export type QuietHours = typeof QuietHours.Type

export const Me = Schema.Struct({
  ...MemberView.fields,
  home: Schema.String,
  timeZone: Schema.String,
  quietHours: Schema.NullOr(QuietHours),
  vapidPublicKey: Schema.String,
  /** How much of a Robot's work the chat shows (pl-6eir). */
  workDetails: WorkDetails,
})
export type Me = typeof Me.Type

export const MemberPreferences = Schema.Struct({
  name: Schema.optional(Schema.String),
  timeZone: Schema.optional(Schema.String),
  quietHours: Schema.optional(Schema.NullOr(QuietHours)),
  workDetails: Schema.optional(Schema.Literals(['compact', 'standard', 'detailed', 'verbose'])),
})

// ---------------------------------------------------------------- Robots

export const RobotStatus = Schema.Literals(['setup', 'active', 'paused', 'blocked', 'deleted'])
export type RobotStatus = typeof RobotStatus.Type
/** What the admin fleet view shows for a Robot. */
export const FleetState = Schema.Literals(['sleeping', 'working', 'waiting for you', 'paused', 'blocked', 'setup'])
export type FleetState = typeof FleetState.Type
export const Sharing = Schema.Literals(['private', 'home'])
export type Sharing = typeof Sharing.Type
export const ThinkingEffort = Schema.Literals(['off', 'low', 'medium', 'high', 'max'])
export type ThinkingEffort = typeof ThinkingEffort.Type

export const Identity = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  avatarColor: Schema.String,
})
export type Identity = typeof Identity.Type

export const GrantKind = Schema.Literals(['tool', 'skill', 'recipient', 'secret', 'host'])
export type GrantKind = typeof GrantKind.Type

export const GrantSet = Schema.Struct({
  tools: Schema.Array(Schema.String),
  skills: Schema.Array(Schema.String),
  recipients: Schema.Array(Schema.String),
  secrets: Schema.Array(Schema.String),
  /** Host grants (v1.2, hs-5ktw): "<hostId>:browser", "<hostId>:files", "<hostId>:shell". */
  hosts: Schema.optional(Schema.Array(Schema.String)),
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

/** One file in a Robot's Workspace, as the Files view lists it (v1.1 ticket 08). */
export const WorkspaceFileView = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  updatedAt: Schema.Number,
  /** persona and memory files pinned first, then daily notes, local skills, screenshots, the rest. */
  group: Schema.Literals(['persona', 'daily', 'skills', 'screens', 'other']),
})
export type WorkspaceFileView = typeof WorkspaceFileView.Type

/** A file opened in the Files view; text is null for a file shown read-only (binary or too large). */
export const WorkspaceFileContent = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  text: Schema.NullOr(Schema.String),
  readOnly: Schema.Boolean,
  note: Schema.NullOr(Schema.String),
})
export type WorkspaceFileContent = typeof WorkspaceFileContent.Type

/** A Host: a computer running the Mr. Robot app, paired to a Member (v1.2, hs-ro43). */
export const HostView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.String,
  ownerId: Schema.String,
  ownerName: Schema.String,
  sharing: Sharing,
  online: Schema.Boolean,
  lastSeen: Schema.NullOr(Schema.Number),
  version: Schema.NullOr(Schema.String),
  capabilities: Schema.NullOr(Schema.Struct({ graphical: Schema.Boolean, chrome: Schema.NullOr(Schema.String) })),
  /** The caller paired it (may share and unpair it). */
  mine: Schema.Boolean,
  /** Robots using it right now (its browser). */
  users: Schema.Array(Schema.String),
})
export type HostView = typeof HostView.Type

/** One action a Robot took on a Host (pl-vcy7); outcome is "done" or the error text. */
export const HostAction = Schema.Struct({
  robotId: Schema.String,
  robotName: Schema.String,
  action: Schema.String,
  detail: Schema.String,
  outcome: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  at: Schema.Number,
})
export type HostAction = typeof HostAction.Type

/** A pairing code as the approving page sees it (hs-hend). */
export const HostPairing = Schema.Struct({ name: Schema.String, platform: Schema.String, approved: Schema.Boolean })
export type HostPairing = typeof HostPairing.Type
export const HostPaired = Schema.Struct({ hostId: Schema.String, name: Schema.String })
export type HostPaired = typeof HostPaired.Type

/** A login entry in the Member's settings (v1.1 ticket 05); never carries the password. */
export const LoginView = Schema.Struct({
  name: Schema.String,
  username: Schema.String,
  websites: Schema.Array(Schema.String),
  notes: Schema.String,
  allowRead: Schema.Boolean,
  scope: Schema.Literals(['member', 'home']),
  /** The Member may edit, reveal and delete it (their own, or a Home entry they shared). */
  mine: Schema.Boolean,
  updatedAt: Schema.Number,
  /** The Member's Robots that hold a grant for it. */
  robots: Schema.Array(Schema.String),
})
export type LoginView = typeof LoginView.Type

export const LoginInput = Schema.Struct({
  username: Schema.optional(Schema.String),
  /** Left out when editing: the stored password stays. */
  password: Schema.optional(Schema.String),
  websites: Schema.optional(Schema.Array(Schema.String)),
  notes: Schema.optional(Schema.String),
  allowRead: Schema.optional(Schema.Boolean),
  shared: Schema.Boolean,
})

/** Where a Robot's Chrome runs (rb-wgtd). */
export const BrowserBackend = Schema.Union([Schema.Literals(['browser-run', 'container', 'container-vpn', 'container-proxy']), Schema.TemplateLiteral(['host:', Schema.String])])
export type BrowserBackend = typeof BrowserBackend.Type

/** A backend as the settings show it: whether this Home can use it and why not. */
export const BrowserBackendOption = Schema.Struct({
  id: BrowserBackend,
  label: Schema.String,
  note: Schema.String,
  available: Schema.Boolean,
})
export type BrowserBackendOption = typeof BrowserBackendOption.Type

/** Everything the advanced settings page edits. */
export const RobotSettings = Schema.Struct({
  identity: Identity,
  sharing: Sharing,
  model: ModelChoice,
  contextBudget: Schema.Number,
  codeMode: Schema.Boolean,
  compactionInstruction: Schema.String,
  grants: GrantSet,
  notifications: NotificationSettings,
  /** Monthly limit in USD; null inherits the Home default. */
  spendLimitUsd: Schema.NullOr(Schema.Number),
  /** Keep the Robot's browser open between Turns and wake it when a page shows a notification (robot-lulc). */
  wakeOnScreenNotifications: Schema.Boolean,
  /** This Robot's browser backend; null follows the Home default (rb-wgtd). */
  browserBackend: Schema.NullOr(BrowserBackend),
})
export type RobotSettings = typeof RobotSettings.Type

export const SettingsPatch = Schema.Struct({
  identity: Schema.optional(Identity),
  sharing: Schema.optional(Schema.Literals(['private', 'home'])),
  model: Schema.optional(ModelChoice),
  contextBudget: Schema.optional(Schema.Number),
  codeMode: Schema.optional(Schema.Boolean),
  wakeOnScreenNotifications: Schema.optional(Schema.Boolean),
  browserBackend: Schema.optional(Schema.NullOr(BrowserBackend)),
  compactionInstruction: Schema.optional(Schema.String),
  grants: Schema.optional(GrantSet),
  notifications: Schema.optional(NotificationSettings),
  spendLimitUsd: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type SettingsPatch = typeof SettingsPatch.Type

/** One row of the robot list. */
export const RobotSummary = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  ownerName: Schema.String,
  kind: Schema.Literals(['mr-robot', 'robot']),
  identity: Identity,
  sharing: Sharing,
  status: RobotStatus,
  fleetState: FleetState,
  lastLine: Schema.String,
  lastAt: Schema.Number,
  unread: Schema.Boolean,
  /** This person's list settings (robot-mktj). */
  pinned: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
})
export type RobotSummary = typeof RobotSummary.Type

export const ScreenView = Schema.Struct({
  /** Workspace path of the last screenshot. */
  path: Schema.String,
  url: Schema.String,
  at: Schema.Number,
})
export type ScreenView = typeof ScreenView.Type

// ---------------------------------------------------------------- Routines

export const RoutineSchedule = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('once'), at: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('interval'), everyMinutes: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal('daily'), time: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('weekly'), time: Schema.String, weekdays: Schema.Array(Schema.Number) }),
  Schema.Struct({ kind: Schema.Literal('cron'), expression: Schema.String }),
])
export type RoutineSchedule = typeof RoutineSchedule.Type

export const RoutineView = Schema.Struct({
  id: Schema.String,
  robotId: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  schedule: RoutineSchedule,
  timeZone: Schema.String,
  summary: Schema.String,
  nextRun: Schema.NullOr(Schema.Number),
  lastRun: Schema.NullOr(Schema.Number),
  /** Paused by its owner: it keeps its schedule but does not run (robot-qhll). */
  paused: Schema.Boolean,
  /** The schedule as a cron line with its time zone, when it has one ("CRON_TZ=Europe/Warsaw 0 9 * * 1-5"). */
  cron: Schema.NullOr(Schema.String),
  /** The latest runs, newest first (robot-l3gr). */
  runs: Schema.Array(Schema.Struct({ at: Schema.Number, outcome: Schema.Literals(['running', 'done', 'failed']), summary: Schema.String })),
})
export type RoutineView = typeof RoutineView.Type

// ---------------------------------------------------------------- Conversation

// ---------------------------------------------------------------- Grant proposals and questions

export const ProposalKind = Schema.Literals(['setup', 'grants', 'member-file', 'skill', 'takeover'])
export type ProposalKind = typeof ProposalKind.Type

export const ProposalView = Schema.Struct({
  id: Schema.String,
  kind: ProposalKind,
  revision: Schema.Number,
  status: Schema.Literals(['open', 'approved', 'rejected', 'superseded', 'done']),
  purpose: Schema.String,
  /** Grants asked for (setup, grants). */
  grants: Schema.NullOr(GrantSet),
  /** Member file edit: file name and the full proposed content. */
  file: Schema.NullOr(Schema.Struct({ name: Schema.String, content: Schema.String })),
  /** Skill proposed to the library. */
  skill: Schema.NullOr(Schema.Struct({ name: Schema.String, description: Schema.String })),
})
export type ProposalView = typeof ProposalView.Type

export const ProposalAnswer = Schema.Struct({
  revision: Schema.Number,
  approve: Schema.Boolean,
})

// ---------------------------------------------------------------- Conversation

export const Attachment = Schema.Struct({
  name: Schema.String,
  /** Workspace path, e.g. attachments/2026-10-06/report.pdf */
  path: Schema.String,
  size: Schema.Number,
  contentType: Schema.String,
})
export type Attachment = typeof Attachment.Type

/** Who sent a message into a Robot's Conversation. */
export const Sender = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('member'), memberId: Schema.String, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('robot'), robotId: Schema.String, name: Schema.String, avatarColor: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('routine'), routineId: Schema.String, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('channel'), channel: Schema.String, from: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('platform') }),
])
export type Sender = typeof Sender.Type

/** One tool call as Standard, Detailed and Verbose show it (pl-6eir); text fields are truncated. */
export const ToolCallView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.String,
  result: Schema.String,
  error: Schema.Boolean,
  /** Code mode: the tools the program called. */
  inner: Schema.Array(Schema.Struct({ name: Schema.String, args: Schema.String })),
})
export type ToolCallView = typeof ToolCallView.Type

const itemFields = { id: Schema.String, seq: Schema.Number, at: Schema.Number }

/** One item of the simple chat view. */
export const ChatItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('message'), ...itemFields, sender: Sender, text: Schema.String, attachments: Schema.Array(Attachment), reaction: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('reply'), ...itemFields, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('routine'), ...itemFields, action: Schema.Literals(['created', 'updated', 'deleted', 'ran']), name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('question'), ...itemFields, proposal: ProposalView }),
  Schema.Struct({ kind: Schema.Literal('notice'), ...itemFields, text: Schema.String }),
  /** Tools the Robot used in one step, shown collapsed (robot-gr94). */
  Schema.Struct({ kind: Schema.Literal('activity'), ...itemFields, tools: Schema.Array(Schema.String), calls: Schema.optional(Schema.Array(ToolCallView)) }),
  /** The model's thinking, shown at Detailed and Verbose (pl-etps). */
  Schema.Struct({ kind: Schema.Literal('thinking'), ...itemFields, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('working'), ...itemFields }),
])
export type ChatItem = typeof ChatItem.Type

export const Conversation = Schema.Struct({
  robotId: Schema.String,
  items: Schema.Array(ChatItem),
  working: Schema.Boolean,
  /** While working: the tool running now, if any (robot-gr94). */
  activity: Schema.optional(Schema.String),
  /** The last Turn failed and can be run again. */
  canRetry: Schema.optional(Schema.Boolean),
})
export type Conversation = typeof Conversation.Type

/** One raw event of the Trajectory, with secrets masked; data is JSON text. */
export const TrajectoryEvent = Schema.Struct({
  seq: Schema.Number,
  type: Schema.String,
  time: Schema.Number,
  turn: Schema.NullOr(Schema.Number),
  data: Schema.String,
})
export type TrajectoryEvent = typeof TrajectoryEvent.Type

export const RewindView = Schema.Struct({
  id: Schema.String,
  atSeq: Schema.Number,
  archivedSessionId: Schema.String,
  liveSessionId: Schema.String,
  at: Schema.Number,
  undone: Schema.Boolean,
})
export type RewindView = typeof RewindView.Type

export const Trajectory = Schema.Struct({
  robotId: Schema.String,
  sessionId: Schema.String,
  events: Schema.Array(TrajectoryEvent),
  rewinds: Schema.Array(RewindView),
})
export type Trajectory = typeof Trajectory.Type

/**
 * One page of a Robot's raw session events for the trajectory (ticket 22): DSH session events as
 * stored, oldest first. Only the fields the PWA relies on are checked; the rest passes through to DSH's assembler.
 */
export const SessionEventsPage = Schema.Struct({
  sessionId: Schema.String,
  hasMore: Schema.Boolean,
  events: Schema.Array(Schema.StructWithRest(Schema.Struct({ seq: Schema.Number, type: Schema.String }), [Schema.Record(Schema.String, Schema.Unknown)])),
})
export type SessionEventsPage = typeof SessionEventsPage.Type

/** What the model is given at the start of a Turn (robot-vqtw). */
export const PromptPreview = Schema.Struct({
  sections: Schema.Array(Schema.Struct({ name: Schema.String, text: Schema.String })),
  tools: Schema.Array(Schema.String),
  skills: Schema.Array(Schema.String),
})
export type PromptPreview = typeof PromptPreview.Type

// ---------------------------------------------------------------- Models and usage

export const ModelOption = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  label: Schema.String,
  contextWindow: Schema.Number,
  /** USD per million tokens; subscription models cost 0 here (the plan is paid flat). */
  price: Schema.optional(Schema.Struct({ input: Schema.Number, output: Schema.Number, cachedInput: Schema.optional(Schema.Number) })),
  /** OpenCode Go: the API format this model speaks (from models.dev). */
  wire: Schema.optional(Schema.Literals(['chat', 'anthropic', 'responses'])),
})
export type ModelOption = typeof ModelOption.Type

export const UsageView = Schema.Struct({
  month: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  costUsd: Schema.Number,
  limitUsd: Schema.NullOr(Schema.Number),
  /** Browser time this month per backend (rb-y50l); its cost is included in costUsd. */
  browser: Schema.optional(Schema.Array(Schema.Struct({ backend: BrowserBackend, minutes: Schema.Number, costUsd: Schema.Number }))),
  /** Paid services this month (Exa); their cost is included in costUsd (rb-pb26). */
  services: Schema.optional(Schema.Array(Schema.Struct({ service: Schema.String, calls: Schema.Number, costUsd: Schema.Number }))),
})
export type UsageView = typeof UsageView.Type

/** One row of the cost table: a Robot's or a Member's month. */
export interface UsageRow extends UsageView {
  readonly robotId: string | null
  readonly memberId: string
  readonly name: string
}

export const RobotPanel = Schema.Struct({
  summary: RobotSummary,
  settings: RobotSettings,
  routines: Schema.Array(RoutineView),
  screen: Schema.NullOr(ScreenView),
  usage: UsageView,
  canEdit: Schema.Boolean,
  /** The Robot asked for a takeover of its browser (robot-doqx). */
  takeover: Schema.NullOr(Schema.Struct({ reason: Schema.String, claimedBy: Schema.NullOr(Schema.String) })),
})
export type RobotPanel = typeof RobotPanel.Type

// ---------------------------------------------------------------- Providers (robot-dic7, robot-lzu3, robot-7v9s)

export const ProviderName = Schema.Literals(['deepseek', 'openrouter', 'workers-ai', 'openai', 'anthropic', 'opencode-go'])
export type ProviderName = typeof ProviderName.Type

export const ProviderView = Schema.Struct({
  provider: ProviderName,
  kind: Schema.Literals(['api-key', 'oauth']),
  shared: Schema.Boolean,
  connectedAt: Schema.Number,
  ownerId: Schema.String,
  ownerName: Schema.String,
})
export type ProviderView = typeof ProviderView.Type

export const ProvidersView = Schema.Struct({
  /** The caller's own credentials. */
  mine: Schema.Array(ProviderView),
  /** Credentials other Members share with the Home. */
  shared: Schema.Array(ProviderView),
  models: Schema.Array(ModelOption),
  defaultModel: ModelChoice,
})
export type ProvidersView = typeof ProvidersView.Type

/** An OpenCode Go key pool, keys masked (ticket 19). */
export const OpencodeKeysView = Schema.Struct({
  keys: Schema.Array(Schema.Struct({ id: Schema.String, masked: Schema.String })),
  activeId: Schema.NullOr(Schema.String),
  shared: Schema.Boolean,
})
export type OpencodeKeysView = typeof OpencodeKeysView.Type

/** A sign-in started with a provider: open url (and type userCode when the provider shows one). */
export const OAuthStart = Schema.Struct({ url: Schema.String, userCode: Schema.optional(Schema.String) })
export type OAuthStart = typeof OAuthStart.Type

export const ApiKeyInput = Schema.Struct({ key: Schema.String, shared: Schema.Boolean })
export const OAuthFinish = Schema.Struct({ pasted: Schema.optional(Schema.String), shared: Schema.Boolean })
export const ShareInput = Schema.Struct({ shared: Schema.Boolean })
export const HomeSettingsPatch = Schema.Struct({
  defaultModel: Schema.optional(ModelChoice),
  defaultBrowserBackend: Schema.optional(BrowserBackend),
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

// ---------------------------------------------------------------- Skills (robot-7qpi)

export const SkillView = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** git: imported by sync; robot: promoted from a Robot's local skill; home: written in the UI or by Mr. Robot. */
  source: Schema.Literals(['git', 'robot', 'home']),
  visibility: Schema.Literals(['home', 'private']),
  ownerId: Schema.NullOr(Schema.String),
  updatedAt: Schema.Number,
  /** An imported skill changed here; later syncs leave it as it is (rb-t937). */
  edited: Schema.optional(Schema.Boolean),
})
export type SkillView = typeof SkillView.Type

export const SkillRepositoryInput = Schema.Struct({
  repo: Schema.String,
  ref: Schema.String,
  path: Schema.String,
  token: Schema.optional(Schema.String),
})

// ---------------------------------------------------------------- Admin view (robot-x26m, robot-1rap, robot-bvme)

export const FleetRow = Schema.Struct({
  ...RobotSummary.fields,
  grants: GrantSet,
  model: ModelChoice,
  usage: UsageView,
})
export type FleetRow = typeof FleetRow.Type

export const HomeSettingsView = Schema.Struct({
  defaultModel: ModelChoice,
  defaultBrowserBackend: BrowserBackend,
  robotSpendLimitUsd: Schema.NullOr(Schema.Number),
  memberSpendLimitUsd: Schema.NullOr(Schema.Number),
  models: Schema.Array(ModelOption),
})
export type HomeSettingsView = typeof HomeSettingsView.Type

export const AdminView = Schema.Struct({
  fleet: Schema.Array(FleetRow),
  routines: Schema.Array(Schema.Struct({ ...RoutineView.fields, robotName: Schema.String, ownerName: Schema.String })),
  members: Schema.Array(Schema.Struct({ ...MemberView.fields, usage: UsageView })),
  skills: Schema.Array(SkillView),
  skillRepository: Schema.NullOr(Schema.Struct({ repo: Schema.String, ref: Schema.String, path: Schema.String })),
  providers: Schema.Array(Schema.Struct({ provider: Schema.String, ownerName: Schema.String, shared: Schema.Boolean })),
  /** Each Provider's live model list: how many models, when fetched, and the last error. */
  modelLists: Schema.optional(Schema.Array(Schema.Struct({ provider: Schema.String, count: Schema.Number, fetchedAt: Schema.NullOr(Schema.Number), error: Schema.NullOr(Schema.String) }))),
  settings: HomeSettingsView,
  browserBackends: Schema.optional(Schema.Array(BrowserBackendOption)),
  /** Whether the Home's Proton VPN WireGuard configuration is stored (rb-rb1x); the value is never sent. */
  vpnConfigured: Schema.optional(Schema.Boolean),
  /** Whether the Home has an Exa API key (rb-x8i3); the key is never sent. */
  exaConfigured: Schema.optional(Schema.Boolean),
  /** Every Host of the Home (hs-w8vi). */
  hosts: Schema.optional(Schema.Array(HostView)),
  proxyConfigured: Schema.optional(Schema.Boolean),
})
export type AdminView = typeof AdminView.Type

/** An admin secret setting changed: whether one is stored now (VPN, Exa, proxy). */
export const ConfiguredResult = Schema.Struct({ ok: Schema.Boolean, configured: Schema.Boolean })
export type ConfiguredResult = typeof ConfiguredResult.Type

export const ModelListRefresh = Schema.Array(Schema.Struct({ provider: Schema.String, count: Schema.Number, error: Schema.NullOr(Schema.String) }))
export type ModelListRefresh = typeof ModelListRefresh.Type

// ---------------------------------------------------------------- What a Robot's settings can choose from

export const SettingsCatalog = Schema.Struct({
  toolGroups: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  skills: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  robots: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  secrets: Schema.Array(Schema.Struct({ name: Schema.String, scope: Schema.Literals(['member', 'home']), username: Schema.optional(Schema.String), websites: Schema.optional(Schema.Array(Schema.String)) })),
  models: Schema.Array(ModelOption),
  /** Models of Providers this Member has not connected; shown so the list explains itself. */
  unavailableModels: Schema.optional(Schema.Array(ModelOption)),
  /** Browser backends and whether this Home can use them (rb-wgtd). */
  browserBackends: Schema.optional(Schema.Array(BrowserBackendOption)),
  defaultBrowserBackend: Schema.optional(BrowserBackend),
  /** Hosts the owner reaches, for per-host grants (hs-5ktw). */
  hosts: Schema.optional(Schema.Array(HostView)),
})
export type SettingsCatalog = typeof SettingsCatalog.Type

// ---------------------------------------------------------------- Notifications (robot-9xoj)

export const NotificationKind = Schema.Literals(['finished', 'needs you', 'blocked'])
export type NotificationKind = typeof NotificationKind.Type

export const PushSubscriptionInput = Schema.Struct({
  endpoint: Schema.String,
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
  device: Schema.optional(Schema.String),
})

// ---------------------------------------------------------------- Small responses

/** A named text: a member file, a skill, HOME.md. */
export const NamedText = Schema.Struct({ name: Schema.String, content: Schema.String })
export type NamedText = typeof NamedText.Type
export const TextContent = Schema.Struct({ content: Schema.String })
export const CreatedRobot = Schema.Struct({ id: Schema.String })
export const RetryResult = Schema.Struct({ retried: Schema.Boolean })
export const RevealedLogin = Schema.Struct({ password: Schema.String })
export const OAuthFinished = Schema.Struct({ connected: Schema.Boolean })
export const SkillsSynced = Schema.Struct({ synced: Schema.Array(Schema.String) })

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