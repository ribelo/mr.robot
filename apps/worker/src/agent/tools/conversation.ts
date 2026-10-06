import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

/** Tools every Robot has: they act on its own Conversation, not on the world. */
export function conversationTools(): ToolDefinition[] {
  return [
    tool<{ emoji: string }>({
      name: 'react',
      description: 'React to the owner\'s latest message with an emoji (usually "👍") instead of replying. Use it for short instructions you took on; then end the Turn without text.',
      parameters: { properties: { emoji: { type: 'string', description: 'One emoji, usually 👍' } }, required: ['emoji'] },
      execute: async ({ emoji }) => `Reacted with ${emoji}. End the Turn without a reply unless one is needed.`,
    }),
  ]
}
