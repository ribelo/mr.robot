/** Always mounted: reactions and answering another Robot's request. */
import z from '@deepseek-ai/schemastery'
import { conversationTools } from '../agent/tools/conversation.ts'
import { replyTools } from '../agent/tools/messaging.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof replyTools>[0]

export const Conversation = capability<{ host: Host | undefined }>({
  name: 'conversation',
  Config: z.object({ host: z.any() }) as never,
  tools: ({ host }) => [...conversationTools(), ...(host === undefined ? [] : replyTools(host))],
})
