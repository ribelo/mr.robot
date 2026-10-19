/**
 * Subagents (v1.14 ticket 06): a Robot hands work to a fresh context (subagent) or to one that inherits its
 * own (subagent_fork), steers it (send_message), stops it (interrupt_agent) and lists them (list_agents).
 * The names and parameters follow DSH's tool-subagent and subagent-control, so a later DSH version can take over.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface SubagentStart {
  readonly mode: 'spawn' | 'fork'
  readonly label: string
  readonly task: string
  readonly provider?: string
  readonly model?: string
  readonly effort?: string
}

export interface SubagentHost {
  /** The routes the owner allowed, as "provider/model". */
  allowedModels(): readonly string[]
  start(input: SubagentStart): Promise<{ readonly kind: 'activation'; readonly subagentId: string }>
  message(id: string, text: string): Promise<{ readonly messageId: string }>
  interrupt(id: string): Promise<{ readonly accepted: boolean }>
  list(): Promise<string>
}

const EFFORTS = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

export function subagentTools(host: SubagentHost): ToolDefinition[] {
  const allowed = host.allowedModels()
  const route = {
    provider: { type: 'string', description: `Provider of the Subagent's model; give it with model. Allowed: ${allowed.join(', ')}` },
    model: { type: 'string', description: 'Model id from the allowed list; omitted: the first allowed model' },
    reasoning_effort: { type: 'string', enum: EFFORTS, description: 'Thinking effort of the Subagent' },
  }
  const start = (mode: 'spawn' | 'fork') => async (args: { description: string; prompt: string; provider?: string; model?: string; reasoning_effort?: string }) =>
    host.start({ mode, label: args.description, task: args.prompt, ...(args.provider === undefined ? {} : { provider: args.provider }), ...(args.model === undefined ? {} : { model: args.model }), ...(args.reasoning_effort === undefined ? {} : { effort: args.reasoning_effort }) })
  type StartArgs = { description: string; prompt: string; provider?: string; model?: string; reasoning_effort?: string }
  return [
    tool<StartArgs>({
      name: 'subagent',
      description: 'Hand a self-contained task to a Subagent with a fresh context. It works in your Workspace and browser and reports when done; the report wakes you. Your Turn may end meanwhile.',
      parameters: { properties: { description: { type: 'string', description: 'A short (3-5 word) label for the task' }, prompt: { type: 'string', description: 'The complete task: the Subagent sees nothing else of this Conversation' }, ...route }, required: ['description', 'prompt'] },
      concurrencySafe: true,
      execute: start('spawn'),
    }),
    tool<StartArgs>({
      name: 'subagent_fork',
      description: 'Hand a task to a Subagent that starts with your whole context so far. It reports when done; the report wakes you.',
      parameters: { properties: { description: { type: 'string', description: 'A short (3-5 word) label for the task' }, prompt: { type: 'string', description: 'What to do, building on this Conversation' }, ...route }, required: ['description', 'prompt'] },
      concurrencySafe: true,
      execute: start('fork'),
    }),
    tool<{ agent_id: string; message: string }>({
      name: 'send_message',
      description: 'Send a message to one of your running Subagents: it reads it at its next step.',
      parameters: { properties: { agent_id: { type: 'string', description: 'The Subagent id subagent returned' }, message: { type: 'string', description: 'What to tell it' } }, required: ['agent_id', 'message'] },
      execute: async ({ agent_id, message }) => host.message(agent_id, message),
    }),
    tool<{ agent_id: string }>({
      name: 'interrupt_agent',
      description: 'Stop one of your Subagents. Its report says it was interrupted.',
      parameters: { properties: { agent_id: { type: 'string', description: 'The Subagent id' } }, required: ['agent_id'] },
      execute: async ({ agent_id }) => host.interrupt(agent_id),
    }),
    tool<Record<string, never>>({
      name: 'list_agents',
      description: 'List your Subagents: id, state and label.',
      parameters: { properties: {} },
      concurrencySafe: true,
      execute: async () => host.list(),
    }),
  ]
}

/** Every delegation and Subagent control tool: a Subagent has none of them (depth one, ao-8s1d). */
export const SUBAGENT_TOOL_NAMES = ['subagent', 'subagent_fork', 'send_message', 'interrupt_agent', 'list_agents']
