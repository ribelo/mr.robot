import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RobotHost } from '../host.ts'
import { tool } from './define.ts'

interface HelpInput { doing: string; tried: string; need: string; urgent?: boolean }

/**
 * Asking for help (sk-kf74): one structured call stores a help Ask for the owner. Every ordinary active Robot has
 * it without a Grant; Mr. Robot has no chief to ask. The Robot ends its Turn; the answer wakes it (sk-jpyv).
 */
export function helpTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<HelpInput>({
      name: 'need_help',
      description: "Ask for help when you are stuck and cannot go on alone. Say what you are doing, what you tried and what you need. Your owner sees the request at once and answers in text; set urgent only when waiting would do harm. Write all three parts in your owner's language. After the call, end your Turn with one short line: you are woken with the answer, so do not wait or poll.",
      parameters: {
        properties: {
          doing: { type: 'string', description: 'What you are working on' },
          tried: { type: 'string', description: 'What you already tried and what came of it' },
          need: { type: 'string', description: 'What you need to go on: a decision, a fact, access, a file' },
          urgent: { type: 'boolean', description: 'true only when waiting would do harm; false when left out' },
        },
        required: ['doing', 'tried', 'need'],
      },
      execute: async ({ doing, tried, need, urgent }) => {
        for (const [name, value] of Object.entries({ doing, tried, need })) {
          if (value.trim() === '') throw new Error(`need_help: parameter "${name}" is required and must not be empty.`)
        }
        const request = host.propose('help', need, { help: { doing, tried, need, urgent: urgent === true, created: host.now() } })
        return { requestId: request.id, status: 'waiting for help; end your Turn with one short line; you will be woken with the answer' }
      },
    }),
  ]
}
