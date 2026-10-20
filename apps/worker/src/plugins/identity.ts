/** Mounted on every Robot: set_identity (v1.15 ticket 11). During setup it sets the name too; after setup it does not. */
import z from '@deepseek-ai/schemastery'
import { identityTools } from '../agent/tools/proposals.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof identityTools>[0]

export const IdentityTools = capability<{ host: Host }>({
  name: 'identity',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => identityTools(host),
})
