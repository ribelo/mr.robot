/** Messaging the Robots this Robot has recipient Grants for. */
import z from '@deepseek-ai/schemastery'
import { messagingTools } from '../agent/tools/messaging.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof messagingTools>[0]

export const Messaging = capability<{ host: Host }>({
  name: 'messaging',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => messagingTools(host),
})
