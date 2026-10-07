/** Mr. Robot only: create and configure Robots, ask the owner to grant them things. */
import z from '@deepseek-ai/schemastery'
import { robotsTools } from '../agent/tools/messaging.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof robotsTools>[0]

export const Robots = capability<{ host: Host }>({
  name: 'robots',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => robotsTools(host),
})
