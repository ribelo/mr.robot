/** Mr. Robot only: the owner's eyes and non-dangerous hands on the Robots the owner reaches. */
import z from '@deepseek-ai/schemastery'
import { deputyTools } from '../agent/tools/deputy.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof deputyTools>[0]

export const Deputy = capability<{ host: Host }>({
  name: 'deputy',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => deputyTools(host),
})
