import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { GRANT_LEVELS, type GrantField, type GrantSet } from '@mr-robot/protocol'
import { tool } from './define.ts'
import { grantParameters, proposedGrants } from './proposals.ts'

export interface DirectoryEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly availability: string
}

export interface MessagingHost {
  directory(): Promise<DirectoryEntry[]>
  sendRobotMessage(to: string, text: string, idempotencyKey: string): Promise<{ requestId: string; status: string }>
  replyRobotMessage(handle: string, text: string): Promise<{ status: string }>
}

/** Messaging granted recipients (robot-bsvs, robot-mv15). Sender and chain are bound by the platform. */
export function messagingTools(host: MessagingHost): ToolDefinition[] {
  return [
    tool<Record<string, never>>({
      name: 'robot_directory',
      description: 'List the Robots you may message: name, what they do, and whether they are available.',
      parameters: { properties: {} },
      concurrencySafe: true,
      execute: async () => {
        const entries = await host.directory()
        return entries.length === 0
          ? { robots: [], hint: 'You have no recipients. Ask your owner with propose_grants (recipients).' }
          : { robots: entries }
      },
    }),
    tool<{ to: string; request: string; idempotency_key: string }>({
      name: 'robot_send',
      description: 'Ask another Robot to do work. Give it a self-contained request. Its reply arrives later as a labelled message in your Conversation. Use a fresh idempotency_key per distinct request; resending the same key does not send twice.',
      parameters: {
        properties: {
          to: { type: 'string', description: 'Robot id from robot_directory' },
          request: { type: 'string', description: 'The self-contained work request' },
          idempotency_key: { type: 'string', description: 'A fresh key per distinct request; resending a key does not send twice' },
        },
        required: ['to', 'request', 'idempotency_key'],
      },
      execute: async ({ to, request, idempotency_key }) => host.sendRobotMessage(to, request, idempotency_key),
    }),
  ]
}

/** Every Robot can answer a request it received: the reply handle is the permission. */
export function replyTools(host: MessagingHost): ToolDefinition[] {
  return [
    tool<{ handle: string; reply: string }>({
      name: 'robot_reply',
      description: 'Answer a request another Robot sent you, using the reply handle from its message. Each handle answers once.',
      parameters: { properties: { handle: { type: 'string', description: 'Reply handle from the message you answer' }, reply: { type: 'string', description: 'Your answer' } }, required: ['handle', 'reply'] },
      execute: async ({ handle, reply }) => host.replyRobotMessage(handle, reply),
    }),
  ]
}

export interface RobotsHost {
  createRobot(brief: string): Promise<{ id: string; status: string }>
  proposeGrantsFor(robotId: string, purpose: string, grants: GrantSet): Promise<{ proposalId: string; status: string }>
  configureRobot(id: string, change: { name?: string; title?: string; description?: string; avatarColor?: string }): Promise<{ id: string; identity: unknown }>
  threadChiefs(): Promise<Array<{ id: string; ownerName: string; name: string; availability: string }>>
  threadOpen(chiefId: string, topic: string, scope: string): Promise<{ threadId: string; status: string }>
  threadSend(threadId: string, text: string, idempotencyKey: string): Promise<unknown>
  threadClose(threadId: string, summary: string): Promise<unknown>
  threadList(): Promise<unknown>
}

/** Mr. Robot's coordination tools (robot-hk2s): new Robots still get their Grants from the owner. */
export function robotsTools(host: RobotsHost): ToolDefinition[] {
  return [
    tool<{ brief: string }>({
      name: 'robot_create',
      description: 'Create a new Robot for your owner. It starts its own setup Conversation from your brief and proposes its Grants to your owner there.',
      parameters: { properties: { brief: { type: 'string', description: 'What the Robot is for, in a few sentences' } }, required: ['brief'] },
      execute: async ({ brief }) => host.createRobot(brief),
    }),
    tool<{ robot_id: string; purpose: string; logins?: unknown } & Partial<Record<Exclude<GrantField, 'secrets'>, unknown>>>({
      name: 'robot_propose_grants',
      description: "Ask your owner to set levels on one of their Robots' Grants: tool groups, skills, logins, recipient Robots, hosts, connections. Each item gets a level: allow, ask (each call waits for the owner's answer) or deny (removes it); allow when you name no level. Items you do not name keep their level. It appears as a question in that Robot's chat; nothing changes until your owner approves. You cannot grant anything yourself; robot_grants shows the current levels.",
      parameters: {
        properties: {
          robot_id: { type: 'string', description: 'Robot id from robot_directory' }, purpose: { type: 'string', description: 'Why that Robot needs it, in one sentence' },
          ...grantParameters(GRANT_LEVELS, 'logins'),
        },
        required: ['robot_id', 'purpose'],
      },
      execute: async ({ robot_id, purpose, logins, ...items }) => host.proposeGrantsFor(robot_id, purpose, proposedGrants({ ...items, secrets: logins }, GRANT_LEVELS)),
    }),
    tool<{ robot_id: string; name?: string; title?: string; description?: string; avatarColor?: string }>({
      name: 'robot_configure',
      description: "Change the identity of one of your owner's Robots: name, title, description and avatar colour (#rrggbb). Its Conversation shows a line naming you. Grants are never changed this way.",
      parameters: { properties: { robot_id: { type: 'string', description: 'Robot id from robot_directory' }, name: { type: 'string', description: 'New name' }, title: { type: 'string', description: 'New title, a few words on its role' }, description: { type: 'string', description: 'New description of what the Robot does' }, avatarColor: { type: 'string', description: 'New avatar colour as #rrggbb' } }, required: ['robot_id'] },
      execute: async ({ robot_id, ...change }) => host.configureRobot(robot_id, change),
    }),
    tool<Record<string, never>>({
      name: 'thread_chiefs',
      description: "List the other chiefs (Mr. Robots) of your Home you may invite to a Thread: whose Mr. Robot it is, its name and whether it is available. Robots other than Mr. Robot never talk across Members.",
      parameters: { properties: {} },
      concurrencySafe: true,
      execute: async () => {
        const chiefs = await host.threadChiefs()
        return chiefs.length === 0 ? { chiefs: [], hint: 'Nobody else in your Home has an active Mr. Robot.' } : { chiefs }
      },
    }),
    tool<{ chief_id: string; topic: string; scope: string }>({
      name: 'thread_open',
      description: "Invite another chief to a Thread: a conversation on one topic between two Mr. Robots. Both owners get an Ask with the topic and an editable scope and the Thread opens only when both accept; nothing leaves before that. Give the scope you propose for your own owner: what you may use and disclose in this Thread. Nothing a Thread agrees on binds anyone: put the outcome to your owner as an Ask.",
      parameters: {
        properties: {
          chief_id: { type: 'string', description: 'Robot id of the other chief, from thread_chiefs' },
          topic: { type: 'string', description: 'What the Thread is about, in one line' },
          scope: { type: 'string', description: 'The scope you propose for your owner: what you may use and disclose in this Thread (for example "my calendar for next week, my dietary preferences")' },
        },
        required: ['chief_id', 'topic', 'scope'],
      },
      emptyAllowed: ['scope'],
      execute: async ({ chief_id, topic, scope }) => host.threadOpen(chief_id, topic, scope),
    }),
    tool<{ thread_id: string; text: string; idempotency_key: string }>({
      name: 'thread_send',
      description: "Send a message to the other chief in an open Thread. Its reply arrives later as a labelled message in your Conversation. Use and disclose only your owner's scope for that Thread. After 20 messages you must report to your owner and they must agree to go on. Use a fresh idempotency_key per distinct message; resending the same key does not send twice.",
      parameters: {
        properties: {
          thread_id: { type: 'string', description: 'Thread id from thread_list or the Thread opened message' },
          text: { type: 'string', description: 'The message to the other chief' },
          idempotency_key: { type: 'string', description: 'A fresh key per distinct message; resending a key does not send twice' },
        },
        required: ['thread_id', 'text', 'idempotency_key'],
      },
      execute: async ({ thread_id, text, idempotency_key }) => host.threadSend(thread_id, text, idempotency_key),
    }),
    tool<{ thread_id: string; summary: string }>({
      name: 'thread_close',
      description: 'Close an open Thread with a summary of what was said and settled. Both chiefs receive the summary. Put any outcome to your owner as an Ask first or after; closing agrees nothing.',
      parameters: {
        properties: {
          thread_id: { type: 'string', description: 'Thread id from thread_list' },
          summary: { type: 'string', description: 'What the Thread covered and where it ended, in a few sentences' },
        },
        required: ['thread_id', 'summary'],
      },
      execute: async ({ thread_id, summary }) => host.threadClose(thread_id, summary),
    }),
    tool<Record<string, never>>({
      name: 'thread_list',
      description: 'List your Threads, open and closed: id, topic, the other chief, state, the scope your owner gave you for it, the message count and how many messages remain before you must report to your owner.',
      parameters: { properties: {} },
      concurrencySafe: true,
      execute: async () => host.threadList(),
    }),
  ]
}
