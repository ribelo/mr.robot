/** Mounted only while a Robot is being set up: define itself and propose its Grants once. */
import z from '@deepseek-ai/schemastery'
import { setupTools } from '../agent/tools/proposals.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof setupTools>[0]

export const Setup = capability<{ host: Host }>({
  name: 'setup',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => setupTools(host),
})
