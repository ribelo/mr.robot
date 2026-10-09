import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ConversationSearchResult } from '@mr-robot/protocol'
import { tool } from './define.ts'

export interface ConversationHost {
  searchConversation(query: string, page: number): Promise<ConversationSearchResult>
}

/** Tools every Robot has: they act on its own Conversation, not on the world. */
export function conversationTools(host: ConversationHost | undefined): ToolDefinition[] {
  return [
    tool<{ emoji: string }>({
      name: 'react',
      description: 'React to the owner\'s latest message with an emoji (usually "👍") instead of replying. Use it for short instructions you took on; then end the Turn without text.',
      parameters: { properties: { emoji: { type: 'string', description: 'One emoji, usually 👍' } }, required: ['emoji'] },
      execute: async ({ emoji }) => ({ status: 'reacted', message: `Reacted with ${emoji}. End the Turn without a reply unless one is needed.` }),
    }),
    ...(host === undefined ? [] : [
      tool<{ query: string; page?: number }>({
        name: 'conversation_search',
        description: 'Search the words of your own Conversation, however long ago they were said. Every word of the query must appear in the message or reply. Returns the matching items newest first, ten a page: id, sender, time and a snippet. Ask for page nextPage to read on.',
        parameters: {
          properties: {
            query: { type: 'string', description: 'Words to find' },
            page: { type: 'integer', description: 'Page number, from 1 (the default)' },
          },
          required: ['query'],
        },
        concurrencySafe: true,
        execute: async ({ query, page }) => {
          const result = await host.searchConversation(query, page ?? 1)
          return { items: result.items.map((item) => ({ ...item, at: new Date(item.at).toISOString() })), nextPage: result.nextPage }
        },
      }),
    ]),
  ]
}
