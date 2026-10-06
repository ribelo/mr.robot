/**
 * Granted skills only (robot-icrv): the DSH skill registry with one provider over the Home
 * library, listing the Robot's skill Grants that its owner may see, plus tool-skill for loading.
 */
import type { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillCandidate } from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SkillView } from '@mr-robot/protocol'
import type { RobotHost } from './host.ts'
import { tool } from './tools/define.ts'

export interface SkillSource {
  granted(): Promise<SkillView[]>
  content(name: string): Promise<string | null>
}

export function skillsPlugin(source: SkillSource): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(SkillRegistry, {})
    ctx.skills.registerProvider(() => ({
      name: 'home-library',
      list: async () => (await source.granted()).map((skill): SkillCandidate => ({
        name: skill.name,
        description: skill.description,
        invocation: { modelInvocable: true, userInvocable: false },
        source: 'custom',
        provider: 'home-library',
        rank: 0,
        locator: skill.name,
        resourceBase: { kind: 'opaque', description: 'the Home skill library' },
      })),
      get: async (candidate) => {
        const content = await source.content(String(candidate.locator))
        return content === null ? undefined : { ...candidate, content }
      },
    }))
    await ctx.plugin(ToolSkill, {})
  }
}

/** A Robot writes a skill and proposes it to the library (robot-lszy). */
export function skillProposalTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<{ name: string; description: string; content: string; visibility?: 'home' | 'private' }>({
      name: 'propose_skill',
      description: 'Propose a reusable skill you wrote to the Home library. content is the full SKILL.md (Markdown with name and description frontmatter). Your owner approves it before it is published. visibility "private" keeps it to your owner.',
      parameters: {
        properties: {
          name: { type: 'string', description: 'lowercase-with-dashes' },
          description: { type: 'string' },
          content: { type: 'string' },
          visibility: { type: 'string', enum: ['home', 'private'] },
        },
        required: ['name', 'description', 'content'],
      },
      execute: async ({ name, description, content, visibility }) => {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('a skill name is lowercase letters, digits and dashes')
        const proposal = host.propose('skill', `Publish the skill "${name}"`, { skill: { name, description }, content, visibility: visibility ?? 'home' })
        return { proposalId: proposal.id, status: 'waiting for your owner' }
      },
    }),
  ]
}
