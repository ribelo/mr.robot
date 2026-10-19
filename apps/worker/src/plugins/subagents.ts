/** Subagents (v1.14 ticket 06): delegation to fresh or forked contexts, at most three at once. */
import z from '@deepseek-ai/schemastery'
import { subagentTools, type SubagentHost } from '../agent/tools/subagents.ts'
import { capability } from './define.ts'

export const MAX_SUBAGENTS = 3

export const Subagents = capability<{ host: SubagentHost }>({
  name: 'subagents',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => subagentTools(host),
  prompt: ({ host }) => [
    '## Subagents',
    `- Hand expensive work (reading many pages, a long search) to a Subagent with subagent (a fresh context: write the whole task) or subagent_fork (it starts with your context). At most ${MAX_SUBAGENTS} run at once. Models you may give them: ${host.allowedModels().join(', ')}.`,
    '- A Subagent works in your Workspace, your browser (its own tab) and your computer when you have one. It cannot delegate, message Robots, use Threads, edit shared files or ask your owner: a call that needs your owner fails, and it reports that to you; ask your owner yourself.',
    '- Your Turn may end while Subagents run. Each report wakes you; check it before you rely on it. Steer a running Subagent with send_message, stop it with interrupt_agent.',
  ].join('\n'),
})
