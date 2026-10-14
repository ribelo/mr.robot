/**
 * Grantable tool groups. A Grant names a group at a level; only the tools of groups at
 * allow or ask are registered in the Robot's composition (robot-f9ln, sk-746n). There is no shell, terminal
 * or container group (robot-0ms7).
 */
import { emptyGrants, overlayGrants, type GrantSet } from '@mr-robot/protocol'

export const TOOL_GROUPS = {
  files: 'Read, write, edit, glob and grep files in its own Workspace.',
  web: 'Fetch pages by address (web_fetch, free; searching the web is the exa group).',
  browser: 'Use a headless browser: open, observe, act, screenshot; ask the owner for a takeover.',
  routines: 'Create, list, update, pause and delete Routines: its own, and for Mr. Robot those of other Robots too.',
  messaging: 'List and message the Robots it has recipient Grants for.',
  secrets: 'Use the logins granted to it: list them, fill one into its website (the password stays hidden), read values marked "allow reading".',
  skills: 'Load the skills granted to it and propose new skills to the library.',
  notify: 'Send its owner a push notification.',
  robots: 'Create Robots and configure the Robots its owner can reach (Mr. Robot only).',
  deputy: "Read the Conversations, files, Grants, Routines and settings of the Robots its owner can reach, and change their files and settings (Mr. Robot only).",
  exa: 'Exa research: web search, page crawling and code context, paid per call from the Home\'s Exa key.',
  'exa-agent': 'Exa agent runs: long research jobs that can cost dollars each. Grant separately.',
} as const

export type ToolGroup = keyof typeof TOOL_GROUPS
export const TOOL_GROUP_NAMES = Object.keys(TOOL_GROUPS) as ToolGroup[]

/** Groups only Mr. Robot holds: never offered to an ordinary Robot's settings. */
export const MR_ROBOT_ONLY_GROUPS: readonly string[] = ['robots', 'deputy']

export function isToolGroup(name: string): name is ToolGroup {
  return Object.hasOwn(TOOL_GROUPS, name)
}

/**
 * Groups a new Robot holds at ask after setup when its owner did not approve them (sk-3sij): useful
 * at once, but every call waits for the owner. Everything else not approved stays at deny.
 */
export const SETUP_ASK_GROUPS: readonly ToolGroup[] = ['files', 'web', 'exa']

/** What setup approval stores: the approved items at their proposed levels over the ask defaults. */
export function setupGrants(approved: GrantSet): GrantSet {
  return overlayGrants({ ...emptyGrants, tools: Object.fromEntries(SETUP_ASK_GROUPS.map((group) => [group, 'ask' as const])) }, approved)
}

