/**
 * Grantable tool groups. A Grant names a group; only granted groups' tools are
 * registered in the Robot's composition (robot-f9ln). There is no shell, terminal
 * or container group (robot-0ms7).
 */
export const TOOL_GROUPS = {
  files: 'Read, write, edit, glob and grep files in its own Workspace.',
  web: 'Fetch web pages and search the web.',
  browser: 'Use a headless browser: open, observe, act, screenshot; ask the owner for a takeover.',
  routines: 'Create, update and delete its own Routines.',
  messaging: 'List and message the Robots it has recipient Grants for.',
  secrets: 'Use the logins granted to it: list them, fill one into its website (the password stays hidden), read values marked "allow reading".',
  skills: 'Load the skills granted to it and propose new skills to the library.',
  notify: 'Send its owner a push notification.',
  robots: 'Create Robots and configure the Robots its owner can reach (Mr. Robot only).',
  exa: 'Exa research: web search, page crawling and code context, paid per call from the Home\'s Exa key.',
  'exa-agent': 'Exa agent runs: long research jobs that can cost dollars each. Grant separately.',
} as const

export type ToolGroup = keyof typeof TOOL_GROUPS
export const TOOL_GROUP_NAMES = Object.keys(TOOL_GROUPS) as ToolGroup[]

export function isToolGroup(name: string): name is ToolGroup {
  return Object.hasOwn(TOOL_GROUPS, name)
}

/** What Mr. Robot holds from the start; his recipient Grants follow reachability. */
export const MR_ROBOT_TOOLS: readonly ToolGroup[] = ['files', 'web', 'routines', 'messaging', 'notify', 'robots']
