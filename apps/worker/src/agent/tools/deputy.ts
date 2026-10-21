import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  ConnectionView, ConversationPage, ConversationSearchResult, GrantSet, ModelChoice, ProposalView, RobotSettings,
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
  /** Whose Robot it is; a Robot shared with the Space by someone else can be read but not changed. */
  readonly owner: string
  readonly mine: boolean
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
  settings(robotId: string): Promise<{ settings: RobotSettings; models: Array<{ provider: string; model: string; label: string }>; accounts: Array<{ account: string; owner: string; provider: string; label: string; status: string }> }>
  fileWrite(robotId: string, path: string, content: string): Promise<{ path: string; size: number }>
  fileDelete(robotId: string, path: string): Promise<{ deleted: string }>
  settingsSet(robotId: string, patch: unknown): Promise<RobotSettings>
  connections(): Promise<ConnectionView[]>
  connectionInstructionsSet(connectionId: string, instructions: string): Promise<{ id: string; label: string; instructions: string }>
}

/** Longest text of one chat item the deputy gets back; the Conversation view itself is whole. */
export const ITEM_TEXT_CHARS = 2_000
/** Longest slice of a file robot_file_read returns at once. */
export const FILE_READ_CHARS = 30_000
const FILE_LIST_LIMIT = 300

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text)

const robotId = { type: 'string', description: 'Robot id from robot_list' }
/** A page deeper than this reads too much at once (v1.20.1, v1.19-review #8): search with query instead. */
const MAX_PAGE = 50
const page = { type: 'integer', description: `Page number, from 1 (the default) to ${MAX_PAGE}; search with query for older items` }

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
        const view = await host.conversation(robot_id, Math.max(1, Math.min(MAX_PAGE, Math.floor(number ?? 1))))
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
      description: "List the files in another Robot's Workspace: Persona files (SOUL.md, AGENTS.md, MEMORY.md), daily notes, local skills, artefacts. Read one with robot_file_read.",
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
      description: "See what another Robot may do: the level of each of its Grants (tool groups, skills, recipients, logins as secrets, hosts, connections) as allow, ask (each call waits for the owner) or deny (an item not listed is deny too), and its open proposals. You cannot change Grants; ask your owner with robot_propose_grants.",
      parameters: { properties: { robot_id: robotId }, required: ['robot_id'] },
      concurrencySafe: true,
      execute: async ({ robot_id }) => host.grants(robot_id),
    }),
    tool<{ robot_id: string }>({
      name: 'robot_settings',
      description: "See another Robot's settings: model and thinking, code mode, context budget, compaction instruction, Discord channel, browser backend, notifications, spend limit, and the models it could be switched to.",
      parameters: { properties: { robot_id: robotId }, required: ['robot_id'] },
      concurrencySafe: true,
      execute: async ({ robot_id }) => host.settings(robot_id),
    }),
    tool<Record<string, never>>({
      name: 'connection_list',
      description: "List the Connections your owner can use (Google, Slack, Discord accounts): id, kind, label, account, whether it is your owner's own or shared by someone else, and the instructions Robots granted the Connection read in their prompt.",
      parameters: { properties: {} },
      concurrencySafe: true,
      execute: async () => ({ connections: (await host.connections()).map(({ id, kind, label, account, mine, ownerName, shared, status, instructions }) => ({ id, kind, label, account, mine, ...(mine ? {} : { owner: ownerName }), shared, status, instructions: instructions ?? '' })) }),
    }),
    tool<{ connection_id: string; instructions: string }>({
      name: 'connection_instructions_set',
      description: "Set the instructions for one of your owner's own Connections, when your owner tells you how it should be used (for example 'answer in threads on Slack'). Every Robot granted the Connection reads them in its prompt from its next Turn. The text replaces the old one; empty text clears it. Write it in short imperative sentences, in English.",
      parameters: { properties: { connection_id: { type: 'string', description: 'Connection id from connection_list' }, instructions: { type: 'string', description: 'The whole new instructions; empty clears them' } }, required: ['connection_id', 'instructions'] },
      emptyAllowed: ['instructions'],
      execute: async ({ connection_id, instructions }) => host.connectionInstructionsSet(connection_id, instructions),
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
      description: "Change another Robot's settings. Allowed: chain (its ordered model chain: entries {account, owner, provider, model, effort}; account ids and owners from robot_settings or your owner's Providers; the Robot moves to the next entry only when an account hits a limit or breaks), model {provider, model} (changes the active chain entry), thinking (off, low, medium, high, xhigh, max), codeMode, contextBudget, compactionInstruction, discordChannel (null removes it), discordProactive, browserBackend (null: the Space default), notifications {enabled, channels}, wakeOnScreenNotifications, cacheWarming, idleCompaction, idleCompactionFloorTokens, autoReview, requiresHosts (the Robot runs no Task while a Host it holds a facet on is offline), reviewer {provider, model, effort} (null: the Space default), subagentModels [{provider, model}] (the models its Subagents may run on; the subagents grant itself stays with your owner), workspace {host, root} (where it works: a Host id from robot_settings and a directory there, inside a git repository; the Robot must hold the files facet on that Host; null removes it). Grants, spendLimit and sharing cannot be changed this way and are refused: Grants are proposals your owner answers (robot_propose_grants). Each change shows as a line in that Robot's Conversation naming you; it takes effect on its next Turn.",
      parameters: {
        properties: {
          robot_id: robotId,
          model: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } }, required: ['provider', 'model'], description: 'New model, one of those robot_settings lists' },
          chain: { type: 'array', items: { type: 'object', properties: { account: { type: 'string', description: 'Provider account id' }, owner: { type: 'string', description: 'Member id owning the account' }, provider: { type: 'string', description: 'Provider of the account' }, model: { type: 'string', description: 'Model id' }, effort: { type: 'string', enum: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], description: 'Thinking effort' } }, required: ['account', 'owner', 'provider', 'model', 'effort'] }, description: 'The whole model chain, first entry preferred' },
          thinking: { type: 'string', enum: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], description: 'Thinking effort' },
          codeMode: { type: 'boolean', description: 'Call tools through code mode programs' },
          contextBudget: { type: 'integer', description: 'Tokens, at least 8000' },
          compactionInstruction: { type: 'string', description: 'What to keep when the Conversation is compacted' },
          discordChannel: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Discord channel id; null removes it' },
          discordProactive: { type: 'boolean', description: "Also send the Robot's own messages to its Discord channel" },
          browserBackend: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'browser-run, host:<id>' },
          notifications: { type: 'object', properties: { enabled: { type: 'boolean' }, channels: { type: 'array', items: { type: 'string' } } }, description: 'Notifications on or off, and the channels they go to' },
          wakeOnScreenNotifications: { type: 'boolean', description: 'Keep the browser open and wake the Robot when a page shows a notification' },
          cacheWarming: { type: 'boolean', description: "Refresh the model's prompt cache while the Robot is idle, so the next message is cheap" },
          idleCompaction: { type: 'boolean', description: 'Compact once while idle, shortly before the prompt cache expires' },
          idleCompactionFloorTokens: { type: 'integer', description: 'A context below this many tokens is not compacted while idle' },
          requiresHosts: { type: 'boolean', description: 'Do not run Tasks while any Host the Robot holds a facet on is offline: a recurring Task fails with the Host named, a scheduled Task waits for the Host. Messages still wake the Robot' },
          autoReview: { type: 'boolean', description: 'A reviewer model checks each allowed tool call before it runs; a denied call becomes an Ask to your owner' },
          subagentModels: { type: 'array', items: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } }, required: ['provider', 'model'] }, description: 'The models its Subagents may run on' },
          reviewer: { oneOf: [{ type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string', enum: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] } }, required: ['provider', 'model', 'effort'] }, { type: 'null' }], description: "The reviewer's model; null: the Space default" },
          dreaming: { oneOf: [{ type: 'boolean' }, { type: 'null' }], description: 'Dreaming at 03:00 (v1.20); null: the Space default' },
          workspace: { oneOf: [{ type: 'object', properties: { host: { type: 'string', description: 'The Host id' }, root: { type: 'string', description: 'A directory on that Host, inside a git repository' } }, required: ['host', 'root'] }, { type: 'null' }], description: 'Where the Robot works: a Host and a directory there; null removes it' },
          dreamModel: { oneOf: [{ type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string', enum: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] } }, required: ['provider', 'model', 'effort'] }, { type: 'null' }], description: "The dream's model; null: the Space default, then the Robot's own" },
        },
        required: ['robot_id'],
      },
      execute: async ({ robot_id, ...patch }) => host.settingsSet(robot_id, patch),
    }),
  ]
}
