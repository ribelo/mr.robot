import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  ConversationPage, ConversationSearchResult, GrantSet, ModelChoice, ProposalView, RobotSettings, RoutineView,
  TrajectoryExcerpt, WorkspaceFileContent, WorkspaceFileView,
} from '@mr-robot/protocol'
import { tool } from './define.ts'

/** One Robot in the owner's fleet, as the deputy lists it (cd-ibix). */
export interface RobotListing {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly description: string
  readonly kind: 'mr-robot' | 'robot'
  readonly status: string
  readonly fleetState: string
  readonly model: ModelChoice | null
  readonly lastActiveAt: number
  readonly lastLine: string
  /** Whose Robot it is; a Robot shared with the Home by someone else can be read but not changed. */
  readonly owner: string
  readonly mine: boolean
}

export interface RoutineChange {
  readonly id?: string
  readonly title?: string
  readonly prompt?: string
  readonly at?: unknown
  readonly after_seconds?: number
  readonly every_seconds?: number
  readonly daily?: { time: string; time_zone?: string }
  readonly weekly?: { time: string; time_zone?: string; weekdays: number[] }
  readonly cron?: { expression: string; time_zone?: string }
}

/** What Mr. Robot, as his owner's deputy, can do with the Robots the owner reaches. Every call checks that reach. */
export interface DeputyHost {
  list(): Promise<RobotListing[]>
  conversation(robotId: string, page: number): Promise<ConversationPage>
  searchConversation(robotId: string, query: string, page: number): Promise<ConversationSearchResult>
  trajectory(robotId: string, itemId: string, before: number, after: number): Promise<TrajectoryExcerpt>
  files(robotId: string): Promise<WorkspaceFileView[]>
  fileRead(robotId: string, path: string): Promise<WorkspaceFileContent>
  grants(robotId: string): Promise<{ grants: GrantSet; openProposals: ProposalView[] }>
  routines(robotId: string): Promise<RoutineView[]>
  settings(robotId: string): Promise<{ settings: RobotSettings; models: Array<{ provider: string; model: string; label: string }> }>
  fileWrite(robotId: string, path: string, content: string): Promise<{ path: string; size: number }>
  fileDelete(robotId: string, path: string): Promise<{ deleted: string }>
  settingsSet(robotId: string, patch: unknown): Promise<RobotSettings>
  routineSet(robotId: string, change: RoutineChange): Promise<RoutineView>
  routinePause(robotId: string, id: string, paused: boolean): Promise<RoutineView>
  routineDelete(robotId: string, id: string): Promise<{ deleted: string }>
}

/** Longest text of one chat item the deputy gets back; the Conversation view itself is whole. */
export const ITEM_TEXT_CHARS = 2_000
/** Longest slice of a file robot_file_read returns at once. */
export const FILE_READ_CHARS = 30_000
const FILE_LIST_LIMIT = 300

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text)

const robotId = { type: 'string', description: 'Robot id from robot_list' }
const page = { type: 'integer', description: 'Page number, from 1 (the default)' }
const zone = 'time_zone is an IANA zone and defaults to the Robot\'s own'

/** The tool group `deputy` (Mr. Robot only): the owner's eyes and non-dangerous hands on the Robots the owner reaches. */
export function deputyTools(host: DeputyHost): ToolDefinition[] {
  return [
    tool<Record<string, never>>({
      name: 'robot_list',
      description: "List every Robot your owner can reach (not you): id, name, what it does, status, fleet state (sleeping, working, waiting for you, blocked…), model, last activity and its last line.",
      parameters: { properties: {} },
      concurrencySafe: true,
      execute: async () => host.list(),
    }),
    tool<{ robot_id: string; query?: string; page?: number }>({
      name: 'robot_conversation',
      description: "Read another Robot's Conversation as your owner sees it in the app (chat level), newest first, 20 items a page; nextPage says whether there is more. With query, search its words instead (every word must appear) and get id, sender, time and a snippet. Long texts are cut to 2000 characters.",
      parameters: { properties: { robot_id: robotId, query: { type: 'string', description: 'Words to find; omit to read the Conversation' }, page }, required: ['robot_id'] },
      concurrencySafe: true,
      execute: async ({ robot_id, query, page: number }) => {
        if (query !== undefined && query.trim() !== '') return host.searchConversation(robot_id, query, number ?? 1)
        const view = await host.conversation(robot_id, number ?? 1)
        return {
          ...view,
          items: view.items.map((item) => ('text' in item && item.text.length > ITEM_TEXT_CHARS ? { ...item, text: clip(item.text, ITEM_TEXT_CHARS) } : item)),
        }
      },
    }),
    tool<{ robot_id: string; item_id: string; before?: number; after?: number }>({
      name: 'robot_trajectory',
      description: "Read the Trajectory of another Robot around one item of its Conversation: the tool calls, results and code of that moment. item_id is an id from robot_conversation (or an event number). At most 40 events either side; the output is capped at 12000 characters of event data in all and 1500 per event, so use it to diagnose one failure, not to read a log.",
      parameters: { properties: { robot_id: robotId, item_id: { type: 'string', description: 'Item id from robot_conversation, or an event number' }, before: { type: 'integer', description: 'Events before the item (default 3)' }, after: { type: 'integer', description: 'Events after the item (default 15)' } }, required: ['robot_id', 'item_id'] },
      concurrencySafe: true,
      execute: async ({ robot_id, item_id, before, after }) => host.trajectory(robot_id, item_id, before ?? 3, after ?? 15),
    }),
    tool<{ robot_id: string }>({
      name: 'robot_files',
      description: "List the files in another Robot's Workspace: Persona files (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, MEMORY.md), daily notes, local skills, artefacts. Read one with robot_file_read.",
      parameters: { properties: { robot_id: robotId }, required: ['robot_id'] },
      concurrencySafe: true,
      execute: async ({ robot_id }) => {
        const files = await host.files(robot_id)
        return { files: files.slice(0, FILE_LIST_LIMIT), ...(files.length > FILE_LIST_LIMIT ? { omitted: files.length - FILE_LIST_LIMIT } : {}) }
      },
    }),
    tool<{ robot_id: string; path: string; offset?: number }>({
      name: 'robot_file_read',
      description: `Read one text file from another Robot's Workspace. Returns at most ${FILE_READ_CHARS} characters from offset (default 0); size tells the whole length. Binary and large files cannot be read.`,
      parameters: { properties: { robot_id: robotId, path: { type: 'string', description: 'Workspace path from robot_files' }, offset: { type: 'integer', description: 'Character to start at' } }, required: ['robot_id', 'path'] },
      concurrencySafe: true,
      execute: async ({ robot_id, path, offset }) => {
        const file = await host.fileRead(robot_id, path)
        if (file.text === null) return file
        const from = Math.max(0, offset ?? 0)
        const text = file.text.slice(from, from + FILE_READ_CHARS)
        return { ...file, text, ...(from > 0 || from + FILE_READ_CHARS < file.text.length ? { range: [from, from + text.length] } : {}) }
      },
    }),
    tool<{ robot_id: string }>({
      name: 'robot_grants',
      description: "See what another Robot may do: its Grants (tool groups, skills, recipients, logins, hosts, connections) and its open proposals. You cannot change Grants; ask your owner with robot_propose_grants.",
      parameters: { properties: { robot_id: robotId }, required: ['robot_id'] },
      concurrencySafe: true,
      execute: async ({ robot_id }) => host.grants(robot_id),
    }),
    tool<{ robot_id: string }>({
      name: 'robot_routines',
      description: "List another Robot's Routines: schedule, instructions, paused or not, next run, and the last 20 runs of each (started, finished, outcome ok, failed or skipped, first line of its reply).",
      parameters: { properties: { robot_id: robotId }, required: ['robot_id'] },
      concurrencySafe: true,
      execute: async ({ robot_id }) => host.routines(robot_id),
    }),
    tool<{ robot_id: string }>({
      name: 'robot_settings',
      description: "See another Robot's settings: model and thinking, code mode, context budget, compaction instruction, Discord channel, browser backend, notifications, spend limit, and the models it could be switched to.",
      parameters: { properties: { robot_id: robotId }, required: ['robot_id'] },
      concurrencySafe: true,
      execute: async ({ robot_id }) => host.settings(robot_id),
    }),
    tool<{ robot_id: string; path: string; content: string }>({
      name: 'robot_file_write',
      description: "Create or replace a text file in another Robot's Workspace, a Persona file included (up to 256 KB). That Robot is told at its next step what changed and by whom, and its Conversation shows a line naming you. Only for Robots of your owner.",
      parameters: { properties: { robot_id: robotId, path: { type: 'string', description: 'Workspace path of the file' }, content: { type: 'string', description: 'The whole new content' } }, required: ['robot_id', 'path', 'content'] },
      execute: async ({ robot_id, path, content }) => host.fileWrite(robot_id, path, content),
    }),
    tool<{ robot_id: string; path: string }>({
      name: 'robot_file_delete',
      description: "Delete a file from another Robot's Workspace. That Robot is told at its next step, and its Conversation shows a line naming you.",
      parameters: { properties: { robot_id: robotId, path: { type: 'string', description: 'Workspace path of the file to delete' } }, required: ['robot_id', 'path'] },
      execute: async ({ robot_id, path }) => host.fileDelete(robot_id, path),
    }),
    tool<{ robot_id: string } & Record<string, unknown>>({
      name: 'robot_settings_set',
      description: "Change another Robot's settings. Allowed: model {provider, model}, thinking (off, low, medium, high, max), codeMode, contextBudget, compactionInstruction, discordChannel (null removes it), discordProactive, browserBackend (null: the Home default), notifications {enabled, channels}, wakeOnScreenNotifications. Grants, spendLimitUsd and sharing cannot be changed this way and are refused: Grants are proposals your owner answers (robot_propose_grants). Each change shows as a line in that Robot's Conversation naming you; it takes effect on its next Turn.",
      parameters: {
        properties: {
          robot_id: robotId,
          model: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } }, required: ['provider', 'model'], description: 'New model, one of those robot_settings lists' },
          thinking: { type: 'string', enum: ['off', 'low', 'medium', 'high', 'max'], description: 'Thinking effort' },
          codeMode: { type: 'boolean', description: 'Call tools through code mode programs' },
          contextBudget: { type: 'integer', description: 'Tokens, at least 8000' },
          compactionInstruction: { type: 'string', description: 'What to keep when the Conversation is compacted' },
          discordChannel: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Discord channel id; null removes it' },
          discordProactive: { type: 'boolean', description: "Also send the Robot's own messages to its Discord channel" },
          browserBackend: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'browser-run, container, container-vpn, container-proxy, host:<id>' },
          notifications: { type: 'object', properties: { enabled: { type: 'boolean' }, channels: { type: 'array', items: { type: 'string' } } }, description: 'Notifications on or off, and the channels they go to' },
          wakeOnScreenNotifications: { type: 'boolean', description: 'Keep the browser open and wake the Robot when a page shows a notification' },
        },
        required: ['robot_id'],
      },
      execute: async ({ robot_id, ...patch }) => host.settingsSet(robot_id, patch),
    }),
    tool<{ robot_id: string } & RoutineChange>({
      name: 'robot_routine_set',
      description: `Create or edit a Routine of another Robot. Without id: needs title, prompt (what that Robot is told when it runs; make it self-contained) and exactly one timing. With id: changes the title, prompt or timing you give. Timings: at (ISO 8601 with offset, one run), after_seconds (one run), every_seconds (at least 300), daily {time: "HH:MM:SS"}, weekly {time, weekdays: [1..7]}, cron {expression}; ${zone}. A Robot has at most 50 Routines and none may run more often than every 5 minutes. It shows in that Robot's Conversation as "Routine created by <you>".`,
      parameters: {
        properties: {
          robot_id: robotId, id: { type: 'string', description: 'The Routine to edit; omit to create' }, title: { type: 'string', description: 'Short name of the Routine' }, prompt: { type: 'string', description: 'What that Robot is told when the Routine runs' },
          at: { type: 'string', description: 'One run at this ISO 8601 time with offset' }, after_seconds: { type: 'integer', description: 'One run after this many seconds' }, every_seconds: { type: 'integer', description: 'Run every this many seconds, at least 300' },
          daily: { type: 'object', properties: { time: { type: 'string' }, time_zone: { type: 'string' } }, required: ['time'], description: `Run every day at time (HH:MM:SS); ${zone}` },
          weekly: { type: 'object', properties: { time: { type: 'string' }, time_zone: { type: 'string' }, weekdays: { type: 'array', items: { type: 'integer' } } }, required: ['time', 'weekdays'], description: `Run on weekdays (1 Monday to 7 Sunday) at time; ${zone}` },
          cron: { type: 'object', properties: { expression: { type: 'string' }, time_zone: { type: 'string' } }, required: ['expression'], description: `Run on a five-field cron expression; ${zone}` },
        },
        required: ['robot_id'],
      },
      execute: async ({ robot_id, ...change }) => host.routineSet(robot_id, change),
    }),
    tool<{ robot_id: string; id: string; paused?: boolean }>({
      name: 'robot_routine_pause',
      description: "Pause a Routine of another Robot (paused true, the default) or resume it (paused false). A resumed recurring Routine skips what it missed.",
      parameters: { properties: { robot_id: robotId, id: { type: 'string', description: 'Routine id from robot_routines' }, paused: { type: 'boolean', description: 'true pauses (the default), false resumes' } }, required: ['robot_id', 'id'] },
      execute: async ({ robot_id, id, paused }) => host.routinePause(robot_id, id, paused ?? true),
    }),
    tool<{ robot_id: string; id: string }>({
      name: 'robot_routine_delete',
      description: 'Delete a Routine of another Robot, with its run history.',
      parameters: { properties: { robot_id: robotId, id: { type: 'string', description: 'Routine id from robot_routines' } }, required: ['robot_id', 'id'] },
      execute: async ({ robot_id, id }) => host.routineDelete(robot_id, id),
    }),
  ]
}
