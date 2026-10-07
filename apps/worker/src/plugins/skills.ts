/** Granted Home skills and the Robot's own local skills, plus writing and proposing skills. */
import z from '@deepseek-ai/schemastery'
import { skillProposalTools, skillsPlugin, type SkillHost, type SkillSource } from '../agent/skills.ts'
import { capability } from './define.ts'

export const Skills = capability<{ host: SkillHost; source: SkillSource }>({
  name: 'skills',
  Config: z.object({ host: z.any().required(), source: z.any().required() }) as never,
  tools: ({ host }) => skillProposalTools(host),
  seams: (ctx, { source }) => skillsPlugin(source)(ctx),
})
