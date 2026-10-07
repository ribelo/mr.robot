/** Push notifications to the owner. */
import z from '@deepseek-ai/schemastery'
import { notifyTools } from '../agent/tools/notify.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof notifyTools>[0]

export const Notify = capability<{ host: Host }>({
  name: 'notify',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => notifyTools(host),
})
