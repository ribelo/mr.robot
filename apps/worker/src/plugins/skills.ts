/** Granted Home skills and the Robot's own local skills, plus writing and proposing skills. */
import z from '@deepseek-ai/schemastery'
import { skillProposalTools, skillsPlugin, type SkillHost, type SkillSource } from '../agent/skills.ts'
import { capability } from './define.ts'

/** The skill tool and what it loads: the platform skills for every Robot, the Home's and the local ones for a Robot with the group (v1.15 ticket 12). */
export const SkillCatalog = capability<{ source: SkillSource }>({
  name: 'skill-catalog',
  Config: z.object({ source: z.any().required() }) as never,
  seams: (ctx, { source }) => skillsPlugin(source)(ctx),
})

/** Writing and proposing skills. */
export const Skills = capability<{ host: SkillHost }>({
  name: 'skills',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => skillProposalTools(host),
})
