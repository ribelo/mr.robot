/** Always mounted on an active Robot: ask the owner for Grants. Pure TypeScript. */
import z from '@deepseek-ai/schemastery'
import { grantProposalTools } from '../agent/tools/proposals.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof grantProposalTools>[0]

export const GrantProposals = capability<{ host: Host }>({
  name: 'grant-proposals',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => grantProposalTools(host),
})
