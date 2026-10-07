/**
 * Skills (robot-icrv, v1.1 ticket 09): global skills from the Home library, granted and read-only;
 * local skills in the Robot's own Workspace (skills/<name>/SKILL.md), which it writes freely and
 * may propose for the library. Both reach the model through the DSH skill registry and tool-skill.
 */
import type { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillCandidate } from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SkillView } from '@mr-robot/protocol'
import { tool } from './tools/define.ts'

export interface SkillSource {
  granted(): Promise<SkillView[]>
  content(name: string): Promise<string | null>
  /** The Robot's own skills in its Workspace. */
  local(): Promise<Array<{ name: string; description: string }>>
  localContent(name: string): Promise<string | null>
}

export function skillsPlugin(source: SkillSource): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(SkillRegistry, {})
    const candidate = (name: string, description: string, provider: string, base: string): SkillCandidate => ({
      name, description, invocation: { modelInvocable: true, userInvocable: false }, source: 'custom', provider, rank: provider === 'local' ? 1 : 0, locator: name,
      resourceBase: { kind: 'opaque', description: base },
    })
    ctx.skills.registerProvider(() => ({
      name: 'home-library',
      list: async () => (await source.granted()).map((skill) => candidate(skill.name, skill.description, 'home-library', 'the Home skill library (read-only)')),
      get: async (found) => {
        const content = await source.content(String(found.locator))
        return content === null ? undefined : { ...found, content }
      },
    }))
    ctx.skills.registerProvider(() => ({
      name: 'local',
      list: async () => (await source.local()).map((skill) => candidate(skill.name, skill.description, 'local', `your Workspace, skills/${skill.name}/`)),
      get: async (found) => {
        const content = await source.localContent(String(found.locator))
        return content === null ? undefined : { ...found, content }
      },
    }))
    await ctx.plugin(ToolSkill, {})
  }
}

export interface SkillHost {
  /** Write a local skill; refused for a global skill's name unless this Robot may edit the library. */
  writeSkill(name: string, content: string): Promise<{ path: string; scope: 'local' | 'global' }>
  /** Propose one of the Robot's local skills for the Home library (an ask). */
  promoteSkill(name: string, visibility: 'home' | 'private'): Promise<{ proposalId: string }>
}

/** The name and description in a SKILL.md's frontmatter. */
export function skillFrontmatter(content: string): { name?: string; description: string } {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? ''
  const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(head)?.[1]?.trim().replace(/^["']|["']$/g, '')
  const name = field('name')
  return { ...(name === undefined ? {} : { name }), description: field('description') ?? '' }
}

/** A Robot writes its own skills and proposes them to the library (rb-kkqu, rb-lqwr). */
export function skillProposalTools(host: SkillHost): ToolDefinition[] {
  return [
    tool<{ name: string; content: string }>({
      name: 'skill_write',
      description: 'Create or replace one of your own local skills (skills/<name>/SKILL.md in your Workspace). content is the full SKILL.md: Markdown with "name" and "description" frontmatter. Skills from the Home library are read-only; write a local skill with another name instead.',
      parameters: { properties: { name: { type: 'string', description: 'lowercase-with-dashes' }, content: { type: 'string' } }, required: ['name', 'content'] },
      execute: async ({ name, content }) => {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('a skill name is lowercase letters, digits and dashes')
        return host.writeSkill(name, content)
      },
    }),
    tool<{ name: string; visibility?: 'home' | 'private' }>({
      name: 'propose_skill',
      description: 'Propose one of your local skills for the Home library, so other Robots can be granted it. Your owner approves it first. visibility "private" keeps it to your owner\'s Robots.',
      parameters: { properties: { name: { type: 'string' }, visibility: { type: 'string', enum: ['home', 'private'] } }, required: ['name'] },
      execute: async ({ name, visibility }) => ({ ...(await host.promoteSkill(name, visibility ?? 'home')), status: 'waiting for your owner' }),
    }),
  ]
}
