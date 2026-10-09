/** Always mounted on an active Robot: ask the owner for Grants and reviews, and see the skill library. Pure TypeScript. */
import z from '@deepseek-ai/schemastery'
import { skillLibraryTools, type SkillLibraryHost } from '../agent/skills.ts'
import { grantProposalTools, reviewTools } from '../agent/tools/proposals.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof grantProposalTools>[0] & SkillLibraryHost

export const GrantProposals = capability<{ host: Host }>({
  name: 'grant-proposals',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => [...grantProposalTools(host), ...reviewTools(host), ...skillLibraryTools(host)],
})
