import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

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
        return entries.length === 0 ? 'You have no recipients. Ask your owner with propose_grants (recipients).' : entries
      },
    }),
    tool<{ to: string; request: string; idempotency_key: string }>({
      name: 'robot_send',
      description: 'Ask another Robot to do work. Give it a self-contained request. Its reply arrives later as a labelled message in your Conversation. Use a fresh idempotency_key per distinct request; resending the same key does not send twice.',
      parameters: {
        properties: {
          to: { type: 'string', description: 'Robot id from robot_directory' },
          request: { type: 'string' },
          idempotency_key: { type: 'string' },
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
      parameters: { properties: { handle: { type: 'string' }, reply: { type: 'string' } }, required: ['handle', 'reply'] },
      execute: async ({ handle, reply }) => host.replyRobotMessage(handle, reply),
    }),
  ]
}

export interface RobotsHost {
  createRobot(brief: string): Promise<{ id: string; status: string }>
  proposeGrantsFor(robotId: string, purpose: string, grants: { tools: string[]; skills: string[]; recipients: string[]; secrets: string[] }): Promise<{ proposalId: string; status: string }>
  configureRobot(id: string, change: { name?: string; title?: string; description?: string }): Promise<{ id: string; identity: unknown }>
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
    tool<{ robot_id: string; purpose: string; tools?: string[]; skills?: string[]; logins?: string[]; recipients?: string[] }>({
      name: 'robot_propose_grants',
      description: "Ask your owner to grant one of their Robots tool groups, skills, logins or recipient Robots. It appears as a question in that Robot's chat; nothing is granted until your owner approves. You cannot grant anything yourself.",
      parameters: {
        properties: {
          robot_id: { type: 'string' }, purpose: { type: 'string', description: 'Why that Robot needs it, in one sentence' },
          tools: { type: 'array', items: { type: 'string' } }, skills: { type: 'array', items: { type: 'string' } },
          logins: { type: 'array', items: { type: 'string' } }, recipients: { type: 'array', items: { type: 'string' } },
        },
        required: ['robot_id', 'purpose'],
      },
      execute: async ({ robot_id, purpose, tools, skills, logins, recipients }) => host.proposeGrantsFor(robot_id, purpose, { tools: tools ?? [], skills: skills ?? [], recipients: recipients ?? [], secrets: logins ?? [] }),
    }),
    tool<{ robot_id: string; name?: string; title?: string; description?: string }>({
      name: 'robot_configure',
      description: "Rename or re-describe one of your owner's Robots. Grants are never changed this way.",
      parameters: { properties: { robot_id: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } }, required: ['robot_id'] },
      execute: async ({ robot_id, ...change }) => host.configureRobot(robot_id, change),
    }),
  ]
}
