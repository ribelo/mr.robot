/** Always mounted on an active Robot: ask the owner for Grants and propose edits to the owner's files. Pure TypeScript. */
import z from '@deepseek-ai/schemastery'
import { memberFileTools } from '../agent/tools/files.ts'
import { grantProposalTools } from '../agent/tools/proposals.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof grantProposalTools>[0] & Parameters<typeof memberFileTools>[0]

export const GrantProposals = capability<{ host: Host }>({
  name: 'grant-proposals',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => [...grantProposalTools(host), ...memberFileTools(host)],
})
