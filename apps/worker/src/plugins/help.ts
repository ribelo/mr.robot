/** Mounted on every ordinary Robot once it is active, with no Grant: ask the owner for help. Never on Mr. Robot. */
import z from '@deepseek-ai/schemastery'
import { helpTools } from '../agent/tools/help.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof helpTools>[0]

export const Help = capability<{ host: Host }>({
  name: 'help',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => helpTools(host),
})
