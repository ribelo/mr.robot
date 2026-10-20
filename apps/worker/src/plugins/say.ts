/** The voice (v1.15 ticket 01): mounted on every Robot, setup included, with no Grant. */
import z from '@deepseek-ai/schemastery'
import { sayTools, type SayHost } from '../agent/tools/say.ts'
import { capability } from './define.ts'

export const Say = capability<{ host: SayHost }>({
  name: 'say',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => sayTools(host),
})
