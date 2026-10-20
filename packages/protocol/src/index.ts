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

/** An avatar colour, "#rrggbb". */
export const AvatarColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))
export type AvatarColor = typeof AvatarColor.Type

/**
 * A Member's avatar (ux-2ft4, ux-s88l): their initials on a colour, or an uploaded picture (the colour
 * stays behind it). `key` names the picture; it is served at /api/members/<id>/avatar/<key>.
 */
export const MemberAvatar = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('initials'), color: AvatarColor }),
  Schema.Struct({ kind: Schema.Literal('picture'), color: AvatarColor, key: Schema.String }),
])
export type MemberAvatar = typeof MemberAvatar.Type

/** The path the API serves a Member's avatar picture at. */
export const memberAvatarPath = (memberId: string, key: string): string =>
  `/api/members/${encodeURIComponent(memberId)}/avatar/${encodeURIComponent(key)}`

export const MemberView = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  role: MemberRole,
  status: MemberStatus,
  avatar: MemberAvatar,
})
export type MemberView = typeof MemberView.Type

export const WorkDetails = Schema.Literals(['compact', 'standard', 'detailed', 'verbose'])
export type WorkDetails = typeof WorkDetails.Type
/** The Member's theme choice: follow the system, or pin light or dark (ap-itj1). */
export const ThemeChoice = Schema.Literals(['system', 'light', 'dark'])
export type ThemeChoice = typeof ThemeChoice.Type

export const QuietHours = Schema.Struct({
  /** Local start, "HH:MM". */
  start: Schema.String,
  /** Local end, "HH:MM"; may be earlier than start (overnight). */
  end: Schema.String,
})
export type QuietHours = typeof QuietHours.Type

/** How Mission Control's Tasks table is grouped (mc-m5ee). */
export const MissionGroup = Schema.Literals(['assignee', 'parent', 'time'])
export type MissionGroup = typeof MissionGroup.Type
/** Which Tasks the table shows (mc-m6ff); open by default. */
export const MissionState = Schema.Literals(['open', 'done', 'cancelled', 'all'])
export type MissionState = typeof MissionState.Type

/** Mission Control as the Member left it (mc-m5ee, mc-m7gg, mc-n4dd): grouping, state filter, Whole Home, the Mr. Robot drawer. */
export const MissionPrefs = Schema.Struct({ group: MissionGroup, state: MissionState, wholeHome: Schema.Boolean, drawer: Schema.Boolean })
export type MissionPrefs = typeof MissionPrefs.Type
export const DEFAULT_MISSION_PREFS: MissionPrefs = { group: 'assignee', state: 'open', wholeHome: false, drawer: false }

export const Me = Schema.Struct({
  ...MemberView.fields,
  /** How the person's Robots address them (ux-i8ff); absent: by their name. */
  nickname: Schema.optional(Schema.String),
  home: Schema.String,
  /** The zone the person's Robots work in: the app's zone, unless the person pinned one by hand. */
  timeZone: Schema.String,
  /** The person set the zone by hand; the app's zone no longer replaces it. */
  timeZonePinned: Schema.Boolean,
  /** The zone the app last reported (browser or system); null before the first report. */
  detectedTimeZone: Schema.NullOr(Schema.String),
  quietHours: Schema.NullOr(QuietHours),
  vapidPublicKey: Schema.String,
  /** How much of a Robot's work the chat shows (pl-6eir). */
  workDetails: WorkDetails,
  /** System, light or dark (ap-itj1). */
  theme: ThemeChoice,
  /** Mission Control as the Member left it. */
  mission: MissionPrefs,
  /** The Members whose Robots may give this Member Tasks (mc-a1aa). */
  acceptTasksFrom: Schema.Array(Schema.String),
})
export type Me = typeof Me.Type

export const MemberPreferences = Schema.Struct({
  name: Schema.optional(Schema.String),
  /** The nickname to keep; an empty or blank text removes it (ux-i8ff). */
  nickname: Schema.optional(Schema.String),
  /** An IANA zone typed by the person; setting it pins the zone. */
  timeZone: Schema.optional(Schema.String),
  /** Unpin: adopt the zone the app detected. */
  useDetectedTimeZone: Schema.optional(Schema.Literal(true)),
  quietHours: Schema.optional(Schema.NullOr(QuietHours)),
  workDetails: Schema.optional(Schema.Literals(['compact', 'standard', 'detailed', 'verbose'])),
  theme: Schema.optional(ThemeChoice),
  /** The avatar colour; a picture keeps it behind (ux-2ft4). The picture itself goes through PUT /api/me/avatar. */
  avatarColor: Schema.optional(AvatarColor),
  /** Mission Control's remembered choices; fields left out stay. */
  mission: Schema.optional(Schema.Struct({ group: Schema.optional(MissionGroup), state: Schema.optional(MissionState), wholeHome: Schema.optional(Schema.Boolean), drawer: Schema.optional(Schema.Boolean) })),
  /** Replaces the whole list (mc-a1aa). */
  acceptTasksFrom: Schema.optional(Schema.Array(Schema.String)),
})
/** What PATCH /api/me accepts. */
export type MePatch = typeof MemberPreferences.Type

// ---------------------------------------------------------------- Robots

export const RobotStatus = Schema.Literals(['setup', 'active', 'paused', 'blocked', 'deleted'])
export type RobotStatus = typeof RobotStatus.Type
/** What the admin fleet view shows for a Robot. */
export const FleetState = Schema.Literals(['sleeping', 'working', 'waiting for you', 'paused', 'blocked', 'setup'])
export type FleetState = typeof FleetState.Type
export const Sharing = Schema.Literals(['private', 'home'])
export type Sharing = typeof Sharing.Type
export const ThinkingEffort = Schema.Literals(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
export type ThinkingEffort = typeof ThinkingEffort.Type

/** What a Robot's ball avatar is drawn from (ux-0zm6); "Another look" draws a new one. */
export const AvatarSeed = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))

export const Identity = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  avatarColor: Schema.String,
  /** Always present in a view: a Robot that never drew one uses its id (ux-4fgy). */
  avatarSeed: AvatarSeed,
})
export type Identity = typeof Identity.Type

/** An identity as a settings change gives it: without a seed the stored one stays. */
export const IdentityPatch = Schema.Struct({ ...Identity.fields, avatarSeed: Schema.optional(AvatarSeed) })
export type IdentityPatch = typeof IdentityPatch.Type

/** An identity as storage holds it: written before avatar seeds existed, it has none. */
export type StoredIdentity = Omit<Identity, 'avatarSeed'> & { readonly avatarSeed?: string }

/** The title Mr. Robot carries when his owner gave him none (sk-78g5): his role block names it. */
export const CHIEF_TITLE = 'Chief of Staff'

/** The identity a view shows: a Robot without a stored seed uses its id (ux-4fgy); Mr. Robot without a title is the Chief of Staff. */
export const robotIdentity = (stored: StoredIdentity, robotId: string, kind?: 'mr-robot' | 'robot'): Identity =>
  ({
    ...stored,
    title: kind === 'mr-robot' && stored.title.trim() === '' ? CHIEF_TITLE : stored.title,
    avatarSeed: stored.avatarSeed === undefined || stored.avatarSeed === '' ? robotId : stored.avatarSeed,
  })

export const GrantKind = Schema.Literals(['tool', 'skill', 'recipient', 'secret', 'host', 'connection'])
export type GrantKind = typeof GrantKind.Type

/** One grant item by kind and name: a tool group, a skill, a recipient, a login, a Host facet or a Connection (with :write). */
export const GrantItemRef = Schema.Struct({ kind: GrantKind, name: Schema.String })
export type GrantItemRef = typeof GrantItemRef.Type

/**
 * The level of one grant item (v1.11, sk-746n): allow, ask (each call waits for the owner's answer)
 * or deny (its tools are not registered). An item that is not named is at deny.
 */
export const GrantLevel = Schema.Literals(['allow', 'ask', 'deny'])
export type GrantLevel = typeof GrantLevel.Type
export const isGrantLevel = Schema.is(GrantLevel)
export const GRANT_LEVELS: readonly GrantLevel[] = ['allow', 'ask', 'deny']

/** The items of one kind and their levels, by item name. */
export const GrantLevels = Schema.Record(Schema.String, GrantLevel)
export type GrantLevels = typeof GrantLevels.Type

/** Every grant item of a Robot with its level. */
export const GrantSet = Schema.Struct({
  /** Tool groups (agent/catalog.ts). */
  tools: GrantLevels,
  skills: GrantLevels,
  /** Robot ids it may message. */
  recipients: GrantLevels,
  /** Login entry names. */
  secrets: GrantLevels,
  /** Host grants (v1.2, hs-5ktw): "<hostId>:browser", "<hostId>:files", "<hostId>:shell". */
  hosts: GrantLevels,
  /** Connection grants (v1.5, cn-xezx): "<connectionId>" reads; "<connectionId>:write" also sends (Gmail send, Slack post). */
  connections: GrantLevels,
})
export type GrantSet = typeof GrantSet.Type
export type GrantField = keyof GrantSet
export const emptyGrants: GrantSet = { tools: {}, skills: {}, recipients: {}, secrets: {}, hosts: {}, connections: {} }

/** The GrantSet field that holds the items of a kind. */
export const GRANT_FIELDS: Readonly<Record<GrantKind, GrantField>> = { tool: 'tools', skill: 'skills', recipient: 'recipients', secret: 'secrets', host: 'hosts', connection: 'connections' }

/**
 * Grants as a request names them: per kind, levels by name, or a list of names that are all at allow
 * (the shape before v1.11, still accepted). A kind left out has no items.
 */
const GrantItemsInput = Schema.Union([Schema.Array(Schema.String), GrantLevels])
export const GrantSetInput = Schema.Struct({
  tools: Schema.optional(GrantItemsInput),
  skills: Schema.optional(GrantItemsInput),
  recipients: Schema.optional(GrantItemsInput),
  secrets: Schema.optional(GrantItemsInput),
  hosts: Schema.optional(GrantItemsInput),
  connections: Schema.optional(GrantItemsInput),
})
export type GrantSetInput = typeof GrantSetInput.Type

const levelsFrom = (items: typeof GrantItemsInput.Type | undefined): GrantLevels =>
  items === undefined ? {} : isNameList(items) ? Object.fromEntries(items.map((name) => [name, 'allow' as const])) : { ...items }

function isNameList(items: typeof GrantItemsInput.Type): items is readonly string[] {
  return Array.isArray(items)
}

/** A decoded request's grants as a GrantSet: lists become allow. */
export function grantSetFrom(input: GrantSetInput): GrantSet {
  return {
    tools: levelsFrom(input.tools), skills: levelsFrom(input.skills), recipients: levelsFrom(input.recipients),
    secrets: levelsFrom(input.secrets), hosts: levelsFrom(input.hosts), connections: levelsFrom(input.connections),
  }
}

/** Stored or foreign grants (a proposal payload of any version); null when they do not decode. */
export function parseGrantSet(value: unknown): GrantSet | null {
  const decoded = Schema.decodeUnknownOption(GrantSetInput)(value)
  return decoded._tag === 'Some' ? grantSetFrom(decoded.value) : null
}

/** The level of one item: what the set names, deny when it names nothing (sk-746n). */
export function grantLevel(grants: GrantSet, kind: GrantKind, name: string): GrantLevel {
  const levels = grants[GRANT_FIELDS[kind]]
  return Object.hasOwn(levels, name) ? levels[name]! : 'deny'
}

/** Whether a level lets the Robot use the item: allow, or ask (each call asks the owner). */
export function usableLevel(level: GrantLevel): boolean {
  return level !== 'deny'
}

/** The names of one kind the Robot may use (allow or ask). */
export function usableNames(levels: GrantLevels): string[] {
  return Object.entries(levels).filter(([, level]) => usableLevel(level)).map(([name]) => name)
}

/** `top` over `base`: every item `top` names takes its level from `top`. */
export function overlayGrants(base: GrantSet, top: GrantSet): GrantSet {
  return {
    tools: { ...base.tools, ...top.tools }, skills: { ...base.skills, ...top.skills }, recipients: { ...base.recipients, ...top.recipients },
    secrets: { ...base.secrets, ...top.secrets }, hosts: { ...base.hosts, ...top.hosts }, connections: { ...base.connections, ...top.connections },
  }
}

export const ModelChoice = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  effort: Schema.Literals(['off', 'low', 'medium', 'high', 'xhigh', 'max']),
})
export type ModelChoice = typeof ModelChoice.Type

/**
 * One entry of a Robot's model chain (v1.10): a model on one Provider account. `account` and `owner`
 * are empty while an entry made before accounts existed is not yet bound; Workers AI uses "workers-ai".
 */
export const ChainEntry = Schema.Struct({
  account: Schema.String,
  owner: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  effort: Schema.Literals(['off', 'low', 'medium', 'high', 'xhigh', 'max']),
})
export type ChainEntry = typeof ChainEntry.Type

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
  group: Schema.Literals(['persona', 'daily', 'skills', 'screens', 'docs', 'spill', 'other']),
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

/** How completely a Host confines a command (v1.16 ticket 02, ob-n72n): full, partial (an older kernel, Windows) or none (a confined command fails closed). */
export const HostSandbox = Schema.Literals(['full', 'partial', 'none'])
export type HostSandbox = typeof HostSandbox.Type

/** The shell a Host runs a Robot's commands in (v1.16 ticket 09, ob-vyyg): bash, or pwsh on Windows. The same words as the Host protocol's Shell. */
export const HostShellName = Schema.Literals(['bash', 'pwsh'])
export type HostShellName = typeof HostShellName.Type

/**
 * What a Host grant lets a Robot change (v1.16 ticket 02, ob-wh59): read-only, workspace-write (its own directory on the Host and the
 * roots listed) or full. Reads are as wide as the OS user in every mode. The same words as the Host protocol's HostMode.
 */
export const HostGrantMode = Schema.Literals(['read-only', 'workspace-write', 'full'])
export type HostGrantMode = typeof HostGrantMode.Type
export const HOST_GRANT_MODES: readonly HostGrantMode[] = ['read-only', 'workspace-write', 'full']

export const HostGrantAccess = Schema.Struct({
  mode: HostGrantMode,
  /** Directories besides the Robot's own that workspace-write may change: absolute, or ~/ for the home directory of the Host's OS user. */
  roots: Schema.Array(Schema.String),
})
export type HostGrantAccess = typeof HostGrantAccess.Type

/** What a grant that names no mode means: workspace-write with the Robot's directory as the only root. */
export const DEFAULT_HOST_GRANT_ACCESS: HostGrantAccess = { mode: 'workspace-write', roots: [] }

/** A root as a person types it: a home path (~, ~/x) or an absolute one (/x, C:\x). Anything else is not a place on a Host. */
export const isHostRoot = (root: string): boolean => /^(~([\\/].*)?|\/.*|[A-Za-z]:[\\/].*)$/.test(root)

/** The access of every Host facet of a Robot, by facet item name ("<hostId>:files"); a facet it does not list has the default. */
export const HostAccessByFacet = Schema.Record(Schema.String, HostGrantAccess)
export type HostAccessByFacet = typeof HostAccessByFacet.Type

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
  capabilities: Schema.NullOr(Schema.Struct({ graphical: Schema.Boolean, chrome: Schema.NullOr(Schema.String), sandbox: Schema.optional(HostSandbox), shell: Schema.optional(HostShellName) })),
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

/** Where a Robot's Chrome runs (rb-wgtd, ob-myzd): Browser Rendering, or the Chrome of a Host. */
export const BrowserBackend = Schema.Union([Schema.Literal('browser-run'), Schema.TemplateLiteral(['host:', Schema.String])])
export type BrowserBackend = typeof BrowserBackend.Type

/** A backend as the settings show it: whether this Home can use it and why not. */
export const BrowserBackendOption = Schema.Struct({
  id: BrowserBackend,
  label: Schema.String,
  note: Schema.String,
  available: Schema.Boolean,
})
export type BrowserBackendOption = typeof BrowserBackendOption.Type

// ---------------------------------------------------------------- Spend limits (ux-dbx4, ux-q8ve, ux-ommv, ux-en86)

/** A monthly spend limit in whole US dollars, at least 1. */
export const SpendAmount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const NoSpendLimit = Schema.Struct({ kind: Schema.Literal('none') })
const UsdSpendLimit = Schema.Struct({ kind: Schema.Literal('usd'), amount: SpendAmount })
/** The Home's limit per Robot or per Member: no limit, or an amount. */
export const HomeSpendLimit = Schema.Union([NoSpendLimit, UsdSpendLimit])
export type HomeSpendLimit = typeof HomeSpendLimit.Type
/** A Robot's own choice: the Home's per-Robot limit, no limit, or an amount. */
export const RobotSpendLimit = Schema.Union([Schema.Struct({ kind: Schema.Literal('home') }), NoSpendLimit, UsdSpendLimit])
export type RobotSpendLimit = typeof RobotSpendLimit.Type
/** The limit that applies to a Robot or a Member, and whether it is the Home's or the Robot's own. */
export const EffectiveSpendLimit = Schema.Struct({ limit: HomeSpendLimit, from: Schema.Literals(['home', 'robot']) })
export type EffectiveSpendLimit = typeof EffectiveSpendLimit.Type

/** The one resolution of a Robot's limit (ux-en86): the spend check, the Admin table and the settings all use it. */
export function effectiveSpendLimit(robot: RobotSpendLimit, home: HomeSpendLimit): EffectiveSpendLimit {
  return robot.kind === 'home' ? { limit: home, from: 'home' } : { limit: robot, from: 'robot' }
}

/** "$20 (Home)", "no limit (Home)", "$50", "no limit". */
export function spendLimitText(effective: EffectiveSpendLimit): string {
  const text = effective.limit.kind === 'usd' ? `$${effective.limit.amount}` : 'no limit'
  return effective.from === 'home' ? `${text} (Home)` : text
}

/** Everything the advanced settings page edits. */
/** A route a Robot's Subagents may run on (ao-2z4n). */
export const SubagentModel = Schema.Struct({ provider: Schema.String, model: Schema.String })
export type SubagentModel = typeof SubagentModel.Type

export const RobotSettings = Schema.Struct({
  identity: Identity,
  sharing: Sharing,
  model: ModelChoice,
  /** The ordered model chain (pa-mho0); `model` is its active entry. */
  chain: Schema.Array(ChainEntry),
  contextBudget: Schema.Number,
  codeMode: Schema.Boolean,
  compactionInstruction: Schema.String,
  grants: GrantSet,
  notifications: NotificationSettings,
  /** The Robot's monthly spend limit: the Home's, no limit, or an amount. */
  spendLimit: RobotSpendLimit,
  /** What "the Home's" is now: the Home's per-Robot limit. */
  homeSpendLimit: HomeSpendLimit,
  /** Keep the Robot's browser open between Turns and wake it when a page shows a notification (robot-lulc). */
  wakeOnScreenNotifications: Schema.Boolean,
  /** This Robot's browser backend; null follows the Home default (rb-wgtd). */
  browserBackend: Schema.NullOr(BrowserBackend),
  /** The Discord channel this Robot talks in (cn-y1ac); null: no Discord. */
  discordChannel: Schema.NullOr(Schema.String),
  /** Also send the Robot's own messages (Task results, notifications) to its Discord channel; replies to Discord messages always go back. */
  discordProactive: Schema.Boolean,
  /** Refresh the provider's prompt cache while idle (ao-jlr0); on for Mr. Robot by default. */
  cacheWarming: Schema.Boolean,
  /** Compact once shortly before the cache expires while idle (ao-f4sp); on for other Robots by default. */
  idleCompaction: Schema.Boolean,
  /** A context below this many tokens is not compacted while idle (ao-z22f). */
  idleCompactionFloorTokens: Schema.Number,
  /** A reviewer model checks each call of an item at allow before it runs (ao-c8k9); off by default. */
  autoReview: Schema.Boolean,
  /** The reviewer's route; null follows the Home default (ao-6m9i). */
  reviewer: Schema.NullOr(ModelChoice),
  /** v1.16 (ob-5nvd): no Task runs while a Host the Robot holds a facet on is offline. Absent: off. */
  requiresHosts: Schema.optional(Schema.Boolean),
  /** What the Home default is now; null: the Robot's own model. */
  homeReviewer: Schema.NullOr(ModelChoice),
  /** The routes its Subagents may run on: the subagents grant's list, empty by default (ao-2z4n). */
  subagentModels: Schema.Array(SubagentModel),
  /** v1.16 (ob-wh59): the mode and write roots of its Host files and shell grants. Absent: every facet has the default. */
  hostAccess: Schema.optional(HostAccessByFacet),
})
export type RobotSettings = typeof RobotSettings.Type

/** A Robot's webhook address and its secret key (cd-pqt8); shown to the owner only. */
export const WebhookView = Schema.Struct({
  /** Path on this deployment: /hooks/<robotId>/<key>. */
  path: Schema.String,
  key: Schema.String,
})
export type WebhookView = typeof WebhookView.Type

/**
 * What Mr. Robot, as his owner's deputy, may change in another Robot's settings (cd-hpkr). Grants, the
 * spend limit and sharing are not here: they stay with the owner, so a patch naming them does not decode.
 */
export const DeputySettingsPatch = Schema.Struct({
  model: Schema.optional(Schema.Struct({ provider: Schema.String, model: Schema.String })),
  chain: Schema.optional(Schema.Array(ChainEntry)),
  thinking: Schema.optional(ThinkingEffort),
  codeMode: Schema.optional(Schema.Boolean),
  contextBudget: Schema.optional(Schema.Number),
  compactionInstruction: Schema.optional(Schema.String),
  discordChannel: Schema.optional(Schema.NullOr(Schema.String)),
  discordProactive: Schema.optional(Schema.Boolean),
  browserBackend: Schema.optional(Schema.NullOr(BrowserBackend)),
  notifications: Schema.optional(Schema.Struct({ enabled: Schema.optional(Schema.Boolean), channels: Schema.optional(Schema.Array(Schema.String)) })),
  wakeOnScreenNotifications: Schema.optional(Schema.Boolean),
  cacheWarming: Schema.optional(Schema.Boolean),
  idleCompaction: Schema.optional(Schema.Boolean),
  idleCompactionFloorTokens: Schema.optional(Schema.Number),
  autoReview: Schema.optional(Schema.Boolean),
  requiresHosts: Schema.optional(Schema.Boolean),
  reviewer: Schema.optional(Schema.NullOr(ModelChoice)),
  subagentModels: Schema.optional(Schema.Array(SubagentModel)),
})
export type DeputySettingsPatch = typeof DeputySettingsPatch.Type

export const SettingsPatch = Schema.Struct({
  identity: Schema.optional(IdentityPatch),
  sharing: Schema.optional(Schema.Literals(['private', 'home'])),
  model: Schema.optional(ModelChoice),
  chain: Schema.optional(Schema.Array(ChainEntry)),
  contextBudget: Schema.optional(Schema.Number),
  codeMode: Schema.optional(Schema.Boolean),
  wakeOnScreenNotifications: Schema.optional(Schema.Boolean),
  browserBackend: Schema.optional(Schema.NullOr(BrowserBackend)),
  compactionInstruction: Schema.optional(Schema.String),
  /** Replaces the whole set; lists of names (before v1.11) are at allow. */
  grants: Schema.optional(GrantSetInput),
  notifications: Schema.optional(NotificationSettings),
  spendLimit: Schema.optional(RobotSpendLimit),
  discordChannel: Schema.optional(Schema.NullOr(Schema.String)),
  discordProactive: Schema.optional(Schema.Boolean),
  cacheWarming: Schema.optional(Schema.Boolean),
  idleCompaction: Schema.optional(Schema.Boolean),
  idleCompactionFloorTokens: Schema.optional(Schema.Number),
  autoReview: Schema.optional(Schema.Boolean),
  requiresHosts: Schema.optional(Schema.Boolean),
  reviewer: Schema.optional(Schema.NullOr(ModelChoice)),
  subagentModels: Schema.optional(Schema.Array(SubagentModel)),
  /** Replaces the whole map of Host facet access. */
  hostAccess: Schema.optional(HostAccessByFacet),
})
export type SettingsPatch = typeof SettingsPatch.Type

/** What starts a Turn (GLOSSARY: Wake-up). */
export const WakeupKind = Schema.Literals(['member', 'task', 'robot', 'channel', 'takeover', 'platform'])
export type WakeupKind = typeof WakeupKind.Type

/** What woke a Robot (mc-w1aa): the kind of Wake-up and who or what sent it ("Anna", "schedule", "slack #ops"). */
export const WakeupCause = Schema.Struct({ kind: WakeupKind, from: Schema.String })
export type WakeupCause = typeof WakeupCause.Type

/** The Task a Turn works on (mc-w2bb). */
export const TaskRef = Schema.Struct({ id: Schema.String, title: Schema.String })
export type TaskRef = typeof TaskRef.Type

/** The running Turn of a Robot: its cause, its subject when it has one, the tool running and since when (mc-w6ff). */
export const RobotTurn = Schema.Struct({ wakeup: WakeupCause, task: Schema.NullOr(TaskRef), activity: Schema.NullOr(Schema.String), since: Schema.Number })
export type RobotTurn = typeof RobotTurn.Type

/** The cause and subject of the Robot's last Turn. */
export const LastWakeup = Schema.Struct({ wakeup: WakeupCause, task: Schema.NullOr(TaskRef) })
export type LastWakeup = typeof LastWakeup.Type

/** A running Subagent as its Robot's row shows it (ao-j8t9): label, since when, the tool it runs. */
export const SubagentLine = Schema.Struct({ id: Schema.String, label: Schema.String, since: Schema.Number, activity: Schema.NullOr(Schema.String) })
export type SubagentLine = typeof SubagentLine.Type

/** One of a Robot's Subagents (v1.14 ticket 06): never a Robot, a Task's doer or a Fleet row of its own. */
export const SubagentView = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  mode: Schema.Literals(['spawn', 'fork']),
  model: ModelChoice,
  status: Schema.Literals(['running', 'done', 'interrupted', 'failed', 'archived']),
  startedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
  /** The first line of its report; null while it runs. */
  result: Schema.NullOr(Schema.String),
  /** The tool it runs now. */
  activity: Schema.NullOr(Schema.String),
})
export type SubagentView = typeof SubagentView.Type

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
  /** The running Turn; null while the Robot does not work. */
  turn: Schema.NullOr(RobotTurn),
  lastWakeup: Schema.NullOr(LastWakeup),
  /** Its running Subagents (ao-j8t9); absent or empty when none runs. */
  subagents: Schema.optional(Schema.Array(SubagentLine)),
  unread: Schema.Boolean,
  /** This person's list settings (robot-mktj). */
  pinned: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  /** The person's own group this Robot is in (ux-wxbm); absent: ungrouped. */
  groupId: Schema.optional(Schema.String),
})
export type RobotSummary = typeof RobotSummary.Type

// ---------------------------------------------------------------- Sidebar groups (ux-wxbm, ux-o7po, ux-xbvi, ux-oltg)

/** A group name as typed: trimmed, 1 to 60 characters. */
export const GroupName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(60))

/** One of a Member's own sidebar groups; the list they come in is their order. */
export const RobotGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  collapsed: Schema.Boolean,
})
export type RobotGroup = typeof RobotGroup.Type

export const GroupInput = Schema.Struct({ name: GroupName })
export type GroupInput = typeof GroupInput.Type
export const GroupPatch = Schema.Struct({ name: Schema.optional(GroupName), collapsed: Schema.optional(Schema.Boolean) })
export type GroupPatch = typeof GroupPatch.Type
/** The new order: every group id once. */
export const GroupOrder = Schema.Struct({ ids: Schema.Array(Schema.String) })
export type GroupOrder = typeof GroupOrder.Type

/** Where a Robot sits in the person's sidebar: out of every group, or in one of theirs. */
export const GroupPlace = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('ungrouped') }),
  Schema.Struct({ kind: Schema.Literal('group'), groupId: Schema.String }),
])
export type GroupPlace = typeof GroupPlace.Type

/** A change to one Robot's place in the person's list (robot-mktj, ux-sj2f); absent fields stay. */
export const ListPrefPatch = Schema.Struct({
  pinned: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  unread: Schema.optional(Schema.Boolean),
  group: Schema.optional(GroupPlace),
})
export type ListPrefPatch = typeof ListPrefPatch.Type

export const ScreenView = Schema.Struct({
  /** Workspace path of the last screenshot. */
  path: Schema.String,
  url: Schema.String,
  at: Schema.Number,
})
export type ScreenView = typeof ScreenView.Type

// ---------------------------------------------------------------- Tasks (v1.13)

/** Who does a Task (mc-t1aa): a Member, a Robot, or nobody yet. */
export const TaskAssignee = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('nobody') }),
  Schema.Struct({ kind: Schema.Literal('member'), memberId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('robot'), robotId: Schema.String }),
])
export type TaskAssignee = typeof TaskAssignee.Type

/** The rule of a recurring Task: every N minutes, daily, on weekdays (ISO, Monday 1), or a five-field cron line. */
export const RecurringSchedule = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('interval'), everyMinutes: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal('daily'), time: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('weekly'), time: Schema.String, weekdays: Schema.Array(Schema.Number) }),
  Schema.Struct({ kind: Schema.Literal('cron'), expression: Schema.String }),
])
export type RecurringSchedule = typeof RecurringSchedule.Type

/**
 * When a Task wakes its doer (mc-t2bb), as Todoist models it: unscheduled (an optional deadline), scheduled
 * (a moment and an optional deadline not before it), or recurring (a rule, its zone and the next occurrence;
 * no deadline). Only a recurring Task can be paused. Moments are epoch milliseconds.
 */
export const TaskTiming = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unscheduled'), deadline: Schema.NullOr(Schema.Number) }),
  Schema.Struct({ kind: Schema.Literal('scheduled'), at: Schema.Number, deadline: Schema.NullOr(Schema.Number) }),
  Schema.Struct({ kind: Schema.Literal('recurring'), schedule: RecurringSchedule, timeZone: Schema.String, next: Schema.Number, paused: Schema.Boolean }),
])
export type TaskTiming = typeof TaskTiming.Type

/**
 * A timing as a request gives it: the server computes a recurring Task's next occurrence. A recurring timing
 * may name a deadline only so the refusal can say why it has none; the zone defaults to the caller's.
 */
export const TaskTimingInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unscheduled'), deadline: Schema.optional(Schema.NullOr(Schema.Number)) }),
  Schema.Struct({ kind: Schema.Literal('scheduled'), at: Schema.Number, deadline: Schema.optional(Schema.NullOr(Schema.Number)) }),
  Schema.Struct({ kind: Schema.Literal('recurring'), schedule: RecurringSchedule, timeZone: Schema.optional(Schema.String), deadline: Schema.optional(Schema.NullOr(Schema.Number)) }),
])
export type TaskTimingInput = typeof TaskTimingInput.Type

/** Open, done or cancelled (mc-t3cc); working is a fact about a Turn and failing a fact about an attempt. */
export const TaskState = Schema.Literals(['open', 'done', 'cancelled'])
export type TaskState = typeof TaskState.Type

/** Whether the Home reminds a person before the Task's moment (mc-s3cc). */
export const Remind = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('none') }),
  Schema.Struct({ kind: Schema.Literal('before'), minutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
])
export type Remind = typeof Remind.Type

export const AttemptOutcome = Schema.Literals(['running', 'ok', 'failed', 'skipped', 'interrupted'])
export type AttemptOutcome = typeof AttemptOutcome.Type

/** One Turn of a Robot on a Task (mc-t4dd): when it started and finished, how it ended, the first line of its reply. */
export const Attempt = Schema.Struct({
  robotId: Schema.String,
  startedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
  outcome: AttemptOutcome,
  firstLine: Schema.String,
})
export type Attempt = typeof Attempt.Type

/** A reference to the same work elsewhere (mc-t6ff): a Jira issue, later through a Connector. */
export const TaskExternal = Schema.Struct({ kind: Schema.String, key: Schema.String, url: Schema.String })
export type TaskExternal = typeof TaskExternal.Type

const TaskTitle = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))

/** A new Task as a person or a Robot gives it. */
export const TaskInput = Schema.Struct({
  title: TaskTitle,
  instructions: Schema.optional(Schema.String),
  assignee: TaskAssignee,
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  timing: Schema.optional(TaskTimingInput),
  remind: Schema.optional(Remind),
  external: Schema.optional(Schema.NullOr(TaskExternal)),
})
export type TaskInput = typeof TaskInput.Type

/** A change to a Task's fields; the assignee, the state and a pause have their own actions. */
export const TaskPatch = Schema.Struct({
  title: Schema.optional(TaskTitle),
  instructions: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  timing: Schema.optional(TaskTimingInput),
  remind: Schema.optional(Remind),
  external: Schema.optional(Schema.NullOr(TaskExternal)),
})
export type TaskPatch = typeof TaskPatch.Type

/** What happened to a Task, as its card in a Conversation says (mc-c1aa). */
export const TaskAction = Schema.Literals(['created', 'updated', 'assigned', 'done', 'cancelled', 'paused', 'resumed', 'ran'])
export type TaskAction = typeof TaskAction.Type

export const TaskAssign = Schema.Struct({ assignee: TaskAssignee })
export const TaskPause = Schema.Struct({ paused: Schema.Boolean })

// ---------------------------------------------------------------- Conversation

// ---------------------------------------------------------------- Grant proposals and questions

export const ProposalKind = Schema.Literals(['setup', 'grants', 'member-file', 'skill', 'takeover', 'review', 'thread', 'help', 'tool-call', 'question', 'credential'])
export type ProposalKind = typeof ProposalKind.Type

/** A review Ask (cd-dt2x): a titled list of items the owner approves one by one or all at once. */
export const ReviewItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  /** What approving this item does, e.g. "Send"; the owner sees it beside the item. */
  action: Schema.optional(Schema.String),
})
export type ReviewItem = typeof ReviewItem.Type

export const ReviewView = Schema.Struct({
  title: Schema.String,
  items: Schema.Array(ReviewItem),
  /** Set once the owner has answered: the ids approved and the ids rejected (cd-7gwt). */
  decision: Schema.optional(Schema.Struct({ approved: Schema.Array(Schema.String), rejected: Schema.Array(Schema.String) })),
})
export type ReviewView = typeof ReviewView.Type

/**
 * A Thread Ask (ch-vrl7, ch-hikl, ch-408z): an invitation sent by this chief, an invitation received,
 * or the question whether to go on after 20 messages. `scope` is the proposed text, or the answered one.
 */
export const ThreadAsk = Schema.Struct({
  id: Schema.String,
  phase: Schema.Literals(['invitation-out', 'invitation-in', 'continue']),
  topic: Schema.String,
  /** The other chief, as people name it ("Ben's Mr. Robot"). */
  other: Schema.String,
  scope: Schema.String,
})
export type ThreadAsk = typeof ThreadAsk.Type

/**
 * A help Ask (need_help): what the Robot is doing, what it tried, what it needs and whether it is urgent,
 * when it asked, and who answered with what. `answeredBy` is none while the request is open. `escalated` says that
 * Mr. Robot was woken with it; `override` is the owner's later answer on a request Mr. Robot had answered (sk-q86i).
 */
export const HelpAsk = Schema.Struct({
  doing: Schema.String,
  tried: Schema.String,
  need: Schema.String,
  urgent: Schema.Boolean,
  created: Schema.Number,
  answeredBy: Schema.Literals(['owner', 'mr-robot', 'none']),
  answer: Schema.NullOr(Schema.String),
  escalated: Schema.Boolean,
  override: Schema.NullOr(Schema.String),
})
export type HelpAsk = typeof HelpAsk.Type

/** One open request for help, as the Robot panel lists it (sk-fmvh); the id links to the card in the Conversation. */
export const HelpRequestView = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  urgent: Schema.Boolean,
  created: Schema.Number,
  escalated: Schema.Boolean,
})
export type HelpRequestView = typeof HelpRequestView.Type

/**
 * A tool-call Ask (sk-hx8j): one call of a tool under an item at ask, stored exactly. The owner reads the
 * Robot's name, the tool, its arguments and the Robot's reason; approval runs this stored call once.
 * Argument values are JSON text (a string argument as itself), secrets masked in views.
 */
/** One version of a draft (v1.17, dp-o3st): the Robot's first text, a draft_revise, or the owner's edit. */
export const DraftRevision = Schema.Struct({
  seq: Schema.Number,
  body: Schema.String,
  subject: Schema.NullOr(Schema.String),
  at: Schema.Number,
  by: Schema.Literals(['robot', 'owner']),
})
export type DraftRevision = typeof DraftRevision.Type

/**
 * A tool-call Ask of a send tool as the message it would send (v1.17, dp-si4p): who gets it, the subject (null when the tool has none, an
 * e-mail reply takes its thread's), the body in Markdown and the Workspace files sent with it. `revisions` is empty until it is first changed;
 * then it holds every version, the first one included.
 */
export const DraftView = Schema.Struct({
  medium: Schema.Literals(['email', 'chat']),
  recipients: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
  subject: Schema.NullOr(Schema.String),
  body: Schema.String,
  attachments: Schema.Array(Schema.String),
  revisions: Schema.Array(DraftRevision),
})
export type DraftView = typeof DraftView.Type

/** The owner's edit of a draft before Send (v1.17, dp-qbt7): compare-and-swap on the revision the card shows. */
export const DraftEdit = Schema.Struct({ revision: Schema.Number, body: Schema.String, subject: Schema.optional(Schema.String) })
export type DraftEdit = typeof DraftEdit.Type

export const ToolCallAsk = Schema.Struct({
  robot: Schema.String,
  tool: Schema.String,
  arguments: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
  reason: Schema.String,
  /** The owner's optional text with the answer (the reason of a rejection); null while open or when none was given. */
  note: Schema.NullOr(Schema.String),
  /**
   * The grant items "Always allow this" raises to allow (v1.17, dp-u9z9): the items at ask that made the call wait. Null when the button is not
   * offered: an Auto review denial (dp-kcds), a call that lifts the sandbox, or an Ask stored without its items.
   */
  alwaysAllow: Schema.NullOr(Schema.Array(GrantItemRef)),
  /** A send tool's call as the message it would send (v1.17, dp-si4p); null for any other tool and for an Ask stored before v1.17 (dp-f0pp). */
  draft: Schema.NullOr(DraftView),
})
export type ToolCallAsk = typeof ToolCallAsk.Type

/**
 * A question Ask (v1.15, gb-b4wz): one natural question with real options, put to the owner by the ask tool. `answer` is null while
 * it is open: an option the owner chose, their own words, or a dismissal (by them, or because they moved on without answering).
 */
export const QuestionOption = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  description: Schema.NullOr(Schema.String),
  style: Schema.Literals(['default', 'primary', 'danger']),
})
export type QuestionOption = typeof QuestionOption.Type

export const QuestionAnswer = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('option'), value: Schema.String, label: Schema.String }),
  /** A multi-select question (v1.17, dp-xz6h): every option chosen, in the order the question lists them, and the owner's own words when allowed. */
  Schema.Struct({ kind: Schema.Literal('selected'), selected: Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })), text: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('custom'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('dismissed'), reason: Schema.Literals(['owner', 'moved-on']) }),
])
export type QuestionAnswer = typeof QuestionAnswer.Type

export const QuestionAsk = Schema.Struct({
  prompt: Schema.String,
  help: Schema.NullOr(Schema.String),
  options: Schema.Array(QuestionOption),
  allowCustom: Schema.Boolean,
  /** The owner may choose several options (v1.17, dp-xz6h); false on a question stored before it. */
  multiSelect: Schema.Boolean,
  dismissOnMoveOn: Schema.Boolean,
  urgent: Schema.Boolean,
  answer: Schema.NullOr(QuestionAnswer),
})
export type QuestionAsk = typeof QuestionAsk.Type

/**
 * A credential Ask (v1.15, gb-3192): a Robot asks for a login or a secret. The form is pre-filled with what the Robot gave; saving it creates
 * the entry under the owner, grants it to the Robot and wakes it with the entry's name. The password goes to the Home, never to the Robot.
 */
export const CredentialAsk = Schema.Struct({
  credential: Schema.Literals(['login', 'secret']),
  service: Schema.String,
  why: Schema.String,
  websites: Schema.Array(Schema.String),
  scope: Schema.NullOr(Schema.String),
  /** The name of the entry the owner saved, once saved; declined: true once declined. */
  entry: Schema.NullOr(Schema.String),
  declined: Schema.Boolean,
})
export type CredentialAsk = typeof CredentialAsk.Type

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
  /** Review Ask: the items and, once answered, the decision. */
  review: Schema.optional(ReviewView),
  /** Thread Ask: the Thread, its topic, and the scope the owner edits before approving. */
  thread: Schema.optional(ThreadAsk),
  /** Help Ask: the Robot's request and, once answered, the answer. */
  help: Schema.optional(HelpAsk),
  /** Tool-call Ask: the stored call and, once answered, the owner's note. */
  toolCall: Schema.optional(ToolCallAsk),
  /** Question Ask: the question, its options and, once answered, the answer. */
  question: Schema.optional(QuestionAsk),
  /** Credential Ask: what the Robot asked for and, once answered, the entry saved or the refusal. */
  credential: Schema.optional(CredentialAsk),
  /** Setup only (v1.16, ob-kvw3): the Robot also proposes the setting "do not run while any of my Hosts is offline". */
  requiresHosts: Schema.optional(Schema.Boolean),
})
export type ProposalView = typeof ProposalView.Type

export const ProposalAnswer = Schema.Struct({
  revision: Schema.Number,
  approve: Schema.Boolean,
  /** Review Ask only: the ids the owner approved; the rest are rejected. Left out, approve means every item. */
  approved: Schema.optional(Schema.Array(Schema.String)),
  /** Thread invitation only: the scope the owner approved ("in this Thread you may use: …"), stored with the answer. */
  scope: Schema.optional(Schema.String),
  /** Tool-call Ask only: the owner's optional text, given to the Robot with the answer (why a call was rejected). */
  note: Schema.optional(Schema.String),
  /** Question Ask only: the value of the option chosen, or the owner's own words in `text`; approve false dismisses. */
  value: Schema.optional(Schema.String),
  /** Multi-select question only (v1.17, dp-xz6h): the values of every option chosen; `text` may ride along when the question allows it. */
  values: Schema.optional(Schema.Array(Schema.String)),
  text: Schema.optional(Schema.String),
})

/** "Always allow this" on a tool-call Ask (v1.17, dp-u9z9): the revision the owner saw. */
export const AlwaysAllowAnswer = Schema.Struct({ revision: Schema.Number })

/** Saving a credential Ask: the entry the owner filled in (v1.15, gb-923q). The password is sent once, to the Home. */
export const CredentialSave = Schema.Struct({
  revision: Schema.Number,
  name: Schema.String,
  username: Schema.String,
  password: Schema.String,
  websites: Schema.Array(Schema.String),
  notes: Schema.String,
  allowRead: Schema.Boolean,
  shared: Schema.Boolean,
})
export type CredentialSave = typeof CredentialSave.Type

/** The owner's text answer to a help Ask. */
export const HelpAnswer = Schema.Struct({ text: Schema.String.check(Schema.isMinLength(1)) })
export type HelpAnswer = typeof HelpAnswer.Type

// ---------------------------------------------------------------- Threads (v1.9)

export const ThreadState = Schema.Literals(['invited', 'open', 'closed', 'declined'])
export type ThreadState = typeof ThreadState.Type

/**
 * What happened to a Thread, as its card in the Conversation says: it opened, an owner declined it, a chief closed it,
 * it closed after 7 days without a message, the invitation expired after 7 days unanswered, or the other chief is gone.
 */
export const ThreadEvent = Schema.Literals(['opened', 'declined', 'closed', 'idle', 'expired', 'gone'])
export type ThreadEvent = typeof ThreadEvent.Type

/** One Thread as a chief and its owner see it: the chief's own scope, the other chief, the state and the count. */
export const ThreadView = Schema.Struct({
  id: Schema.String,
  topic: Schema.String,
  state: ThreadState,
  /** This chief. */
  self: Schema.Struct({ robotId: Schema.String, label: Schema.String, avatarColor: Schema.String }),
  /** The other chief. */
  other: Schema.Struct({ robotId: Schema.String, label: Schema.String, ownerName: Schema.String }),
  /** What this chief may use and disclose in the Thread: proposed until the owner accepts, then as accepted. */
  scope: Schema.String,
  accepted: Schema.Literals(['pending', 'accepted', 'declined']),
  messageCount: Schema.Number,
  createdAt: Schema.Number,
  openedAt: Schema.NullOr(Schema.Number),
  closedAt: Schema.NullOr(Schema.Number),
  lastActivityAt: Schema.Number,
  /** How a closed Thread ended. */
  closedBy: Schema.NullOr(Schema.Literals(['self', 'other', 'idle', 'expired', 'gone', 'declined'])),
  summary: Schema.NullOr(Schema.String),
})
export type ThreadView = typeof ThreadView.Type

/** A Thread in the admin view: who talks about what, and the state. */
export const AdminThread = Schema.Struct({
  id: Schema.String,
  topic: Schema.String,
  state: ThreadState,
  participants: Schema.Array(Schema.Struct({ ownerName: Schema.String, chiefName: Schema.String, robotId: Schema.String })),
  messageCount: Schema.Number,
  createdAt: Schema.Number,
  lastActivityAt: Schema.Number,
  closedAt: Schema.NullOr(Schema.Number),
})
export type AdminThread = typeof AdminThread.Type

// ---------------------------------------------------------------- Conversation

export const Attachment = Schema.Struct({
  name: Schema.String,
  /** Workspace path, e.g. attachments/2026-10-06/report.pdf */
  path: Schema.String,
  size: Schema.Number,
  contentType: Schema.String,
})
export type Attachment = typeof Attachment.Type

const MemberSender = Schema.Struct({ kind: Schema.Literal('member'), memberId: Schema.String, name: Schema.String })
const RobotSender = Schema.Struct({ kind: Schema.Literal('robot'), robotId: Schema.String, name: Schema.String, avatarColor: Schema.String, avatarSeed: Schema.String })
const PlatformSender = Schema.Struct({ kind: Schema.Literal('platform') })

/** Who sent a message into a Robot's Conversation. */
export const Sender = Schema.Union([
  MemberSender,
  RobotSender,
  /** A Task whose moment came, or that a person ran now (mc-s1aa). */
  Schema.Struct({ kind: Schema.Literal('task'), taskId: Schema.String, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('channel'), channel: Schema.String, from: Schema.String }),
  PlatformSender,
])
export type Sender = typeof Sender.Type

/** Who made or changed a Task: a person, a Robot, or the platform. */
export const Actor = Schema.Union([MemberSender, RobotSender, PlatformSender])
export type Actor = typeof Actor.Type

/** One Task as a Member or a Robot sees it (mc-t1aa); `overdue` is computed when it is read. */
export const TaskView = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  instructions: Schema.String,
  createdBy: Actor,
  assignee: TaskAssignee,
  parentId: Schema.NullOr(Schema.String),
  timing: TaskTiming,
  remind: Remind,
  state: TaskState,
  external: Schema.NullOr(TaskExternal),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  /** The last 20 attempts, newest first. */
  attempts: Schema.Array(Attempt),
  /** How many Tasks have this one as their parent. */
  children: Schema.Number,
  overdue: Schema.Boolean,
})
export type TaskView = typeof TaskView.Type

/**
 * Mission Control (mc-m1aa): a page of the Fleet (working first, then waiting for you, then by last activity) and a
 * page of the Tasks the Member sees; `fleetNext` and `tasksNext` are the pages to ask for next, null on the last.
 */
export const MissionView = Schema.Struct({
  fleet: Schema.Array(RobotSummary),
  fleetNext: Schema.NullOr(Schema.Number),
  tasks: Schema.Array(TaskView),
  tasksNext: Schema.NullOr(Schema.Number),
  counts: Schema.Struct({ robots: Schema.Number, working: Schema.Number, waiting: Schema.Number, openTasks: Schema.Number }),
})
export type MissionView = typeof MissionView.Type

/** One page of Tasks, open ones first; `next` is the page to ask for next (1-based), null on the last. */
export const TaskPage = Schema.Struct({ tasks: Schema.Array(TaskView), next: Schema.NullOr(Schema.Number) })
export type TaskPage = typeof TaskPage.Type

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
  Schema.Struct({
    kind: Schema.Literal('message'), ...itemFields, sender: Sender, text: Schema.String, attachments: Schema.Array(Attachment), reaction: Schema.NullOr(Schema.String),
    /** The client id the Member's app sent it with: the app's pending copy of it is this item (ap-3si6). */
    clientId: Schema.optional(Schema.String),
    /** A message of a Thread between two chiefs (ch-iy16): which one. */
    thread: Schema.optional(Schema.Struct({ id: Schema.String, topic: Schema.String })),
    /** A Robot's question to this Robot, which answers it with robot_reply (v1.15, gb-l1x1). */
    question: Schema.optional(Schema.Literal(true)),
  }),
  /** A Thread card (ch-iy16): what happened to the Thread, with its state now. */
  Schema.Struct({ kind: Schema.Literal('thread'), ...itemFields, event: ThreadEvent, thread: ThreadView }),
  /**
   * What the Robot said to its owner: one say (v1.15, gb-s81e). `attachments` are Workspace files (path) and stored screenshots
   * (path `screen:<name>`); `fallback`: the Turn said nothing and its last assistant text was shown instead (gb-7jqy).
   */
  Schema.Struct({ kind: Schema.Literal('reply'), ...itemFields, text: Schema.String, attachments: Schema.optional(Schema.Array(Attachment)), fallback: Schema.optional(Schema.Boolean) }),
  /** A Task card (mc-c1aa); `by` names who changed it when it was not this Robot. `taskId` is null on a card stored before v1.13 that named none. */
  Schema.Struct({ kind: Schema.Literal('task'), ...itemFields, action: TaskAction, taskId: Schema.NullOr(Schema.String), title: Schema.String, by: Schema.optional(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('proposal'), ...itemFields, proposal: ProposalView }),
  Schema.Struct({ kind: Schema.Literal('notice'), ...itemFields, text: Schema.String }),
  /** Tools the Robot used in one step, shown collapsed (robot-gr94). */
  Schema.Struct({ kind: Schema.Literal('activity'), ...itemFields, tools: Schema.Array(Schema.String), calls: Schema.optional(Schema.Array(ToolCallView)) }),
  /** The model's thinking, shown at Detailed and Verbose (pl-etps). */
  Schema.Struct({ kind: Schema.Literal('thinking'), ...itemFields, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('working'), ...itemFields }),
  /** One delegation to a Subagent (ao-15ui): its label, model, state and the first line of its report. */
  Schema.Struct({
    kind: Schema.Literal('delegation'), ...itemFields, subagentId: Schema.String, label: Schema.String, mode: Schema.Literals(['spawn', 'fork']),
    model: Schema.NullOr(ModelChoice), status: Schema.Literals(['running', 'done', 'interrupted', 'failed', 'archived']), result: Schema.NullOr(Schema.String),
  }),
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

/** One page of a Conversation as the chat shows it, newest item first (cd-gjhb). */
export const ConversationPage = Schema.Struct({
  robotId: Schema.String,
  working: Schema.Boolean,
  items: Schema.Array(ChatItem),
  /** The page to ask for next (1-based); null on the last page. */
  nextPage: Schema.NullOr(Schema.Number),
})
export type ConversationPage = typeof ConversationPage.Type

/** A page of a text search over a Conversation, newest first (cd-ggem). */
export const ConversationSearchResult = Schema.Struct({
  items: Schema.Array(Schema.Struct({
    /** The id of the chat item. */
    id: Schema.String,
    /** Who said it: a person's or Robot's name, a Task, a Channel, or the Robot itself. */
    sender: Schema.String,
    at: Schema.Number,
    snippet: Schema.String,
  })),
  /** The page to ask for next (1-based); null on the last page. */
  nextPage: Schema.NullOr(Schema.Number),
})
export type ConversationSearchResult = typeof ConversationSearchResult.Type

/** One raw event of the Trajectory, with secrets masked; data is JSON text. */
export const TrajectoryEvent = Schema.Struct({
  seq: Schema.Number,
  type: Schema.String,
  time: Schema.Number,
  turn: Schema.NullOr(Schema.Number),
  data: Schema.String,
})
export type TrajectoryEvent = typeof TrajectoryEvent.Type

/** A few events of the Trajectory around one point, secrets masked and capped in size (cd-9te1). */
export const TrajectoryExcerpt = Schema.Struct({
  robotId: Schema.String,
  /** The event the excerpt is centred on. */
  seq: Schema.Number,
  events: Schema.Array(TrajectoryEvent),
  /** Events were left out to stay within the size cap. */
  truncated: Schema.Boolean,
})
export type TrajectoryExcerpt = typeof TrajectoryExcerpt.Type

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

/** Where a cost comes from (v1.14, ao-zbld): the model (the Robot, its reviewer, its Subagents), the browser, the Box, paid services. */
export const UsageSource = Schema.Literals(['robot', 'review', 'subagent', 'browser', 'box', 'services'])
export type UsageSource = typeof UsageSource.Type

/** A month's cost by source, in USD, with the total (ao-zbld, ao-nkkb). */
export const CostBreakdown = Schema.Struct({
  model: Schema.Struct({ robot: Schema.Number, review: Schema.Number, subagent: Schema.Number }),
  browser: Schema.Number,
  box: Schema.Number,
  services: Schema.Number,
  total: Schema.Number,
})
export type CostBreakdown = typeof CostBreakdown.Type

/** The breakdown of cost rows; a source without rows costs 0. */
export function costBreakdown(rows: ReadonlyArray<{ readonly source: UsageSource; readonly costUsd: number }>): CostBreakdown {
  const of = (source: UsageSource) => rows.filter((row) => row.source === source).reduce((sum, row) => sum + row.costUsd, 0)
  const model = { robot: of('robot'), review: of('review'), subagent: of('subagent') }
  const [browser, box, services] = [of('browser'), of('box'), of('services')]
  return { model, browser, box, services, total: model.robot + model.review + model.subagent + browser + box + services }
}

export const UsageView = Schema.Struct({
  month: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  costUsd: Schema.Number,
  /** The monthly spend limit in effect (ux-en86). */
  limit: EffectiveSpendLimit,
  /** Browser time this month per backend name (rb-y50l); its cost is included in costUsd. The name is a string: rows of removed backends stay as history (ob-0c3o). */
  browser: Schema.optional(Schema.Array(Schema.Struct({ backend: Schema.String, minutes: Schema.Number, costUsd: Schema.Number }))),
  /** Paid services this month (Exa); their cost is included in costUsd (rb-pb26). */
  services: Schema.optional(Schema.Array(Schema.Struct({ service: Schema.String, calls: Schema.Number, costUsd: Schema.Number }))),
  /** This month's cost by source; its total is costUsd (ao-zbld). */
  breakdown: CostBreakdown,
  /** The Box's running minutes this month (ao-54j2). */
  boxMinutes: Schema.optional(Schema.Number),
})
export type UsageView = typeof UsageView.Type

/** A Member's own month across their Robots (ao-ef5t), against the Member's spend limit. */
export const MemberCosts = Schema.Struct({
  month: Schema.String,
  breakdown: CostBreakdown,
  /** The Member's spend limit: the Home's per-Member limit. */
  limit: HomeSpendLimit,
  byRobot: Schema.Array(Schema.Struct({ robotId: Schema.String, name: Schema.String, breakdown: CostBreakdown })),
})
export type MemberCosts = typeof MemberCosts.Type

/** One row of the cost table: a Robot's or a Member's month. */
export interface UsageRow extends UsageView {
  readonly robotId: string | null
  readonly memberId: string
  readonly name: string
}

/** A Robot's Box as its panel shows it (ao-9q18). */
export const BoxView = Schema.Struct({
  state: Schema.Literals(['off', 'booting', 'running', 'stopping']),
  since: Schema.NullOr(Schema.Number),
  lastCommandAt: Schema.NullOr(Schema.Number),
  /** The jobs that run now, each with Stop (v1.15 ticket 07, gb-66kh); absent when none runs. */
  jobs: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, command: Schema.String, startedAt: Schema.Number }))),
})
export type BoxView = typeof BoxView.Type

export const RobotPanel = Schema.Struct({
  summary: RobotSummary,
  settings: RobotSettings,
  /** The Tasks assigned to this Robot that the viewer may see, open ones first (mc-n6ff). */
  tasks: Schema.Array(TaskView),
  screen: Schema.NullOr(ScreenView),
  usage: UsageView,
  canEdit: Schema.Boolean,
  /** The Robot asked for a takeover of its browser (robot-doqx). */
  takeover: Schema.NullOr(Schema.Struct({ reason: Schema.String, claimedBy: Schema.NullOr(Schema.String) })),
  /** Mr. Robot's open and closed Threads, newest first (ch-6fcp). */
  threads: Schema.optional(Schema.Array(ThreadView)),
  /** Open requests for help, oldest first (sk-fmvh). */
  help: Schema.optional(Schema.Array(HelpRequestView)),
  /** Its Box, when it holds the box grant (ao-9q18). */
  box: Schema.optional(BoxView),
})
export type RobotPanel = typeof RobotPanel.Type

// ---------------------------------------------------------------- Providers (robot-dic7, robot-lzu3, robot-7v9s)

export const ProviderName = Schema.Literals(['deepseek', 'openrouter', 'workers-ai', 'openai', 'anthropic', 'opencode-go'])
export type ProviderName = typeof ProviderName.Type

/** One usage window of a subscription: percent used and when it resets (pa-lmbl, pa-sps4). */
export const UsageWindow = Schema.Struct({ name: Schema.String, percent: Schema.Number, resetsAt: Schema.NullOr(Schema.String) })
export type UsageWindow = typeof UsageWindow.Type

/** An account's usage: windows when the Provider reports them, null when it has no usage endpoint (pa-afb9). */
export const AccountUsage = Schema.Struct({ windows: Schema.NullOr(Schema.Array(UsageWindow)), checkedAt: Schema.Number, error: Schema.NullOr(Schema.String) })
export type AccountUsage = typeof AccountUsage.Type

/** ok; limited until a reset; broken (cancelled, unpaid, revoked) and tried again later (pa-gqff, pa-bc78). */
export const AccountStatus = Schema.Literals(['ok', 'limited', 'broken'])
export type AccountStatus = typeof AccountStatus.Type

/** One account of a Provider (v1.10): a key or a signed-in subscription, shared with the Home on its own. */
export const ProviderView = Schema.Struct({
  id: Schema.String,
  provider: ProviderName,
  label: Schema.String,
  kind: Schema.Literals(['api-key', 'oauth']),
  shared: Schema.Boolean,
  connectedAt: Schema.Number,
  ownerId: Schema.String,
  ownerName: Schema.String,
  status: AccountStatus,
  note: Schema.NullOr(Schema.String),
  /** When a limited account is tried again, or a broken one checked again. */
  until: Schema.NullOr(Schema.Number),
  /** Robots whose model chain holds this account; filled for the account's owner (pa-f59m). */
  usedBy: Schema.optional(Schema.Array(Schema.Struct({ robotId: Schema.String, robotName: Schema.String, ownerName: Schema.String }))),
  /** The address the subscription's token was issued for; for the owner's own OAuth accounts when the Provider reports it. */
  signedInAs: Schema.optional(Schema.String),
})
export type ProviderView = typeof ProviderView.Type

export const ProvidersView = Schema.Struct({
  /** The caller's own credentials. */
  mine: Schema.Array(ProviderView),
  /** Credentials other Members share with the Home. */
  shared: Schema.Array(ProviderView),
  models: Schema.Array(ModelOption),
  defaultModel: ModelChoice,
  /** The Home admin's Workers AI switch (ux-101w); off: no Workers AI model is offered (ux-xsnr). */
  workersAiEnabled: Schema.Boolean,
})
export type ProvidersView = typeof ProvidersView.Type


/** A sign-in started with a provider: open url (and type userCode when the provider shows one). */
export const OAuthStart = Schema.Struct({ url: Schema.String, userCode: Schema.optional(Schema.String) })
export type OAuthStart = typeof OAuthStart.Type

export const ApiKeyInput = Schema.Struct({ key: Schema.String, shared: Schema.Boolean, label: Schema.optional(Schema.String) })
export const AccountPatch = Schema.Struct({ label: Schema.optional(Schema.String), shared: Schema.optional(Schema.Boolean) })
export const OAuthFinish = Schema.Struct({ pasted: Schema.optional(Schema.String), shared: Schema.Boolean })
export const ShareInput = Schema.Struct({ shared: Schema.Boolean })
export const HomeSettingsPatch = Schema.Struct({
  defaultModel: Schema.optional(ModelChoice),
  workersAiEnabled: Schema.optional(Schema.Boolean),
  defaultBrowserBackend: Schema.optional(BrowserBackend),
  robotSpendLimit: Schema.optional(HomeSpendLimit),
  memberSpendLimit: Schema.optional(HomeSpendLimit),
  /** The Auto review route of every Robot that has none of its own; null: each Robot's own model (ao-6m9i). */
  defaultReviewer: Schema.optional(Schema.NullOr(ModelChoice)),
  models: Schema.optional(Schema.Array(Schema.Struct({
    provider: Schema.String,
    model: Schema.String,
    label: Schema.String,
    contextWindow: Schema.Number,
    price: Schema.optional(Schema.Struct({ input: Schema.Number, output: Schema.Number, cachedInput: Schema.optional(Schema.Number) })),
  }))),
})
export type HomeSettingsPatch = typeof HomeSettingsPatch.Type

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

/** One row of the skill_library tool (cd-wfn2, cd-56kk). */
export const SkillLibraryRow = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** Whether the asking Robot holds the skill (granted, or brought by a connector it holds). */
  held: Schema.Boolean,
  /** "git", "robot" or "home" for a library skill; "connector:<kind>" for one a connector brings. */
  source: Schema.String,
  /** Mr. Robot only: names of the Robots that hold the skill. */
  holders: Schema.optional(Schema.Array(Schema.String)),
})
export type SkillLibraryRow = typeof SkillLibraryRow.Type

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
  /** Whether the Home's Robots may run on Workers AI (ux-101w); on by default. */
  workersAiEnabled: Schema.Boolean,
  defaultBrowserBackend: BrowserBackend,
  /** The limit of each Robot that follows the Home's (ux-dbx4). */
  robotSpendLimit: HomeSpendLimit,
  /** The limit of all Robots of one Member together. */
  memberSpendLimit: HomeSpendLimit,
  /** The Auto review route of Robots without their own; null: each Robot's own model (ao-6m9i). */
  defaultReviewer: Schema.NullOr(ModelChoice),
  models: Schema.Array(ModelOption),
})
export type HomeSettingsView = typeof HomeSettingsView.Type

/** Switching Workers AI off moved the Home default model off it (ux-jseo). */
export const DefaultModelMoved = Schema.Struct({ from: ModelChoice, to: ModelChoice })
export type DefaultModelMoved = typeof DefaultModelMoved.Type

/** The answer to a Home settings save: the settings now, and the default model's move when the save made one. */
export const HomeSettingsSaved = Schema.Struct({
  ...HomeSettingsView.fields,
  defaultModelMoved: Schema.optional(DefaultModelMoved),
})
export type HomeSettingsSaved = typeof HomeSettingsSaved.Type

export const AdminView = Schema.Struct({
  fleet: Schema.Array(FleetRow),
  /** Robots whose Routines have not yet become Tasks (v1.13 ticket 05): reached again at the Home's next start. */
  robotsToMigrate: Schema.Number,
  members: Schema.Array(Schema.Struct({ ...MemberView.fields, usage: UsageView })),
  skills: Schema.Array(SkillView),
  skillRepository: Schema.NullOr(Schema.Struct({ repo: Schema.String, ref: Schema.String, path: Schema.String })),
  providers: Schema.Array(Schema.Struct({ id: Schema.String, provider: Schema.String, label: Schema.String, ownerName: Schema.String, shared: Schema.Boolean })),
  /** Each Provider's live model list: how many models, when fetched, and the last error. */
  modelLists: Schema.optional(Schema.Array(Schema.Struct({ provider: Schema.String, count: Schema.Number, fetchedAt: Schema.NullOr(Schema.Number), error: Schema.NullOr(Schema.String) }))),
  settings: HomeSettingsView,
  browserBackends: Schema.optional(Schema.Array(BrowserBackendOption)),
  /** Whether the Home has an Exa API key (rb-x8i3); the key is never sent. */
  exaConfigured: Schema.optional(Schema.Boolean),
  /** Every Host of the Home (hs-w8vi). */
  hosts: Schema.optional(Schema.Array(HostView)),
  /** Every Thread of the Home (ch-5ngu). */
  threads: Schema.optional(Schema.Array(AdminThread)),
})
export type AdminView = typeof AdminView.Type

/** An admin secret setting changed: whether one is stored now (Exa). */
export const ConfiguredResult = Schema.Struct({ ok: Schema.Boolean, configured: Schema.Boolean })
export type ConfiguredResult = typeof ConfiguredResult.Type

export const ModelListRefresh = Schema.Array(Schema.Struct({ provider: Schema.String, count: Schema.Number, error: Schema.NullOr(Schema.String) }))
export type ModelListRefresh = typeof ModelListRefresh.Type

// ---------------------------------------------------------------- Plugins and connections (v1.5)

/** One field of a plugin's form, described from its Schemastery schema (cn-s1pd); secret fields never carry a value. */
export const PluginField = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  description: Schema.NullOr(Schema.String),
  kind: Schema.Literals(['text', 'secret', 'number', 'boolean', 'choice', 'choices']),
  options: Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })),
  required: Schema.Boolean,
})
export type PluginField = typeof PluginField.Type

/** Connector kinds: Discord has two, a bot ('discord') and the person's own account ('discord-user'). */
export const ConnectorKind = Schema.Literals(['google', 'slack', 'discord', 'discord-user'])
export type ConnectorKind = typeof ConnectorKind.Type

/**
 * How a person adds a connection of a connector: an OAuth consent, or pasted values. A paste form may
 * carry a warning the person reads before connecting (Discord as you, ux-gdg3).
 */
export const ConnectMethod = Schema.Union([
  Schema.Struct({ method: Schema.Literal('oauth'), services: Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })) }),
  Schema.Struct({ method: Schema.Literal('paste'), fields: Schema.Array(PluginField), instructions: Schema.String, warning: Schema.optional(Schema.String) }),
])
export type ConnectMethod = typeof ConnectMethod.Type

/**
 * One way to connect an account of a connector plugin (ux-s8rx): its kind, who the connection acts as
 * ("As you", "As a bot"), how to connect, and whether it acts as the person: those are never shared
 * with the Home (ux-bk91).
 */
export const ConnectorWay = Schema.Struct({ kind: ConnectorKind, way: Schema.String, connect: ConnectMethod, actsAsPerson: Schema.Boolean })
export type ConnectorWay = typeof ConnectorWay.Type

/** A plugin as the Plugins page, its detail page and the settings rows show it (cn-dbm9, cn-s1pd). */
export const PluginView = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  icon: Schema.String,
  group: Schema.Literals(['capability', 'connector']),
  enabled: Schema.Boolean,
  /** The Home's settings for the plugin: its form and the values saved (secret fields only say whether one is stored). */
  fields: Schema.Array(PluginField),
  values: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)])),
  secretsSet: Schema.Array(Schema.String),
  /** A sentence when the admin still has to set the plugin up (Google OAuth client, Discord bot). */
  setupNeeded: Schema.NullOr(Schema.String),
  /** Step-by-step setup in Markdown, shown on the plugin page (cn-fpyt, cn-csae). */
  guide: Schema.NullOr(Schema.String),
  /** Connectors only: the ways a person connects an account, each with its own Connect (Discord: as a bot, as you); empty for a capability. */
  connectors: Schema.Array(ConnectorWay),
})
export type PluginView = typeof PluginView.Type

export const ConnectionStatus = Schema.Literals(['connected', 'needs-reconsent', 'rejected'])
export type ConnectionStatus = typeof ConnectionStatus.Type

/** A connected account (cn-qs78, cn-bsge); secrets stay in its owner's vault and are never sent. */
export const ConnectionView = Schema.Struct({
  id: Schema.String,
  kind: ConnectorKind,
  label: Schema.String,
  /** The account it acts as: an e-mail address, a workspace, a bot name. */
  account: Schema.String,
  ownerId: Schema.String,
  ownerName: Schema.String,
  shared: Schema.Boolean,
  mine: Schema.Boolean,
  isDefault: Schema.Boolean,
  /** Google: the services granted at consent (gmail, gmail-send, calendar, drive, contacts). */
  services: Schema.Array(Schema.String),
  status: ConnectionStatus,
  statusNote: Schema.NullOr(Schema.String),
  /** A link the person may still need at the service (Discord: invite the bot to a server). */
  setupLink: Schema.NullOr(Schema.String),
  setupLabel: Schema.NullOr(Schema.String),
  /** What its owner wrote about how Robots should use it (v1.15, gb-wzl9); absent in a view stored before. */
  instructions: Schema.optional(Schema.String),
  createdAt: Schema.Number,
})
export type ConnectionView = typeof ConnectionView.Type

export const PluginSwitch = Schema.Struct({ enabled: Schema.Boolean })
export const PluginSettingsInput = Schema.Struct({ values: Schema.Record(Schema.String, Schema.Unknown) })
/** A connection by pasted values (Slack session, Discord bot token); the values are secrets. */
export const ConnectionPaste = Schema.Struct({ label: Schema.optional(Schema.String), shared: Schema.Boolean, values: Schema.Record(Schema.String, Schema.String) })
export const ConnectionPatch = Schema.Struct({ label: Schema.optional(Schema.String), shared: Schema.optional(Schema.Boolean), isDefault: Schema.optional(Schema.Boolean), instructions: Schema.optional(Schema.String) })

/**
 * Connecting as you through Mr. Robot's browser (v1.12 ticket 11, ux-8pek, ux-wgok): where the
 * attempt for one connector kind is. The session itself never appears here (ux-j7m1).
 */
export const SessionCapture = Schema.Union([
  Schema.Struct({ state: Schema.Literal('none') }),
  Schema.Struct({ state: Schema.Literal('waiting'), kind: ConnectorKind, deadline: Schema.Number }),
  Schema.Struct({ state: Schema.Literal('connected'), kind: ConnectorKind, account: Schema.String }),
  Schema.Struct({ state: Schema.Literal('timedOut'), kind: ConnectorKind }),
  Schema.Struct({ state: Schema.Literal('failed'), kind: ConnectorKind, message: Schema.String }),
])
export type SessionCapture = typeof SessionCapture.Type

/** The Robot whose browser opened on the sign-in page: the page shows its Takeover. */
export const SessionCaptureStarted = Schema.Struct({ robotId: Schema.String, robotName: Schema.String })
export type SessionCaptureStarted = typeof SessionCaptureStarted.Type

/**
 * A connection of the Member's that acts as them and was shared with the Home, unshared by the v1.12
 * update (ux-cop2): shown on the Connections section until the Member dismisses it.
 */
export const ConnectionNote = Schema.Struct({
  id: Schema.String,
  kind: ConnectorKind,
  label: Schema.String,
  account: Schema.String,
  /** Robots of other Members that held a grant on it and lost it (ux-dz8p). */
  robots: Schema.Array(Schema.Struct({ name: Schema.String, ownerName: Schema.String })),
  createdAt: Schema.Number,
})
export type ConnectionNote = typeof ConnectionNote.Type

// ---------------------------------------------------------------- What a Robot's settings can choose from

/** A Connection as a Robot's settings offer it, with the title of its plugin for the item label (ux-5g3w): "Google", "Discord bot". */
export const CatalogConnection = Schema.Struct({
  ...ConnectionView.fields,
  pluginTitle: Schema.String,
})
export type CatalogConnection = typeof CatalogConnection.Type

export const SettingsCatalog = Schema.Struct({
  toolGroups: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  skills: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  robots: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  secrets: Schema.Array(Schema.Struct({ name: Schema.String, scope: Schema.Literals(['member', 'home']), username: Schema.optional(Schema.String), websites: Schema.optional(Schema.Array(Schema.String)) })),
  models: Schema.Array(ModelOption),
  /** Models of Providers this Member has not connected; shown so the list explains itself. */
  unavailableModels: Schema.optional(Schema.Array(ModelOption)),
  /** The Home admin's Workers AI switch (ux-101w); off: chains skip their Workers AI entries (ux-zh1l). */
  workersAiEnabled: Schema.Boolean,
  /** Browser backends and whether this Home can use them (rb-wgtd). */
  browserBackends: Schema.optional(Schema.Array(BrowserBackendOption)),
  defaultBrowserBackend: Schema.optional(BrowserBackend),
  /** Hosts the owner reaches, for per-host grants (hs-5ktw). */
  hosts: Schema.optional(Schema.Array(HostView)),
  /** Provider accounts the owner's Robots may put in a model chain: their own and the Home's shared ones (pa-mho0). */
  accounts: Schema.optional(Schema.Array(ProviderView)),
  /** Connections the owner can grant: their own and the Home's shared ones (cn-xezx). */
  connections: Schema.optional(Schema.Array(CatalogConnection)),
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
  /** Chosen by the client for each message; a repeated send with the same id is accepted once (ap-ceqx). */
  clientId: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
  attachments: Schema.optional(Schema.Array(Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    size: Schema.Number,
    contentType: Schema.String,
  }))),
  /** Wait for a Turn of its own instead of reaching a running Turn (Ctrl+Enter, ao-q2z4). */
  followup: Schema.optional(Schema.Boolean),
})
export type SendMessage = typeof SendMessage.Type

/** Rewind to an event, or to before a Turn (its message included). */
export const RewindRequest = Schema.Struct({ atSeq: Schema.optional(Schema.Number), beforeTurn: Schema.optional(Schema.Number) })

export * from './capabilities.ts'
