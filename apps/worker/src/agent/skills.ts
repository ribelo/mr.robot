/**
 * Skills (robot-icrv, v1.1 ticket 09): global skills from the Space library, granted and read-only;
 * local skills in the Robot's own Workspace (skills/<name>/SKILL.md), which it writes freely and
 * may propose for the library. Both reach the model through the DSH skill registry and tool-skill.
 */
import type { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillCandidate } from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SkillLibraryRow, SkillView } from '@mr-robot/protocol'
import type { PlatformSkill } from '../skills/platform.ts'
import { tool } from './tools/define.ts'

export interface SkillSource {
  granted(): Promise<SkillView[]>
  content(name: string): Promise<string | null>
  /** The Robot's own skills in its Workspace. */
  local(): Promise<Array<{ name: string; description: string }>>
  localContent(name: string): Promise<string | null>
  /** The platform skills this Robot is shown now (v1.15 ticket 12): they need no Grant. */
  platform(): readonly PlatformSkill[]
}

export function skillsPlugin(source: SkillSource): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(SkillRegistry, {})
    const candidate = (name: string, description: string, provider: string, base: string, rank = provider === 'local' ? 1 : 0): SkillCandidate => ({
      name, description, invocation: { modelInvocable: true, userInvocable: false }, source: 'custom', provider, rank, locator: name,
      resourceBase: { kind: 'opaque', description: base },
    })
    // Platform skills first: the skill tool resolves one before a library or a local skill of the same name (gb-n6by).
    ctx.skills.registerProvider(() => ({
      name: 'platform',
      list: async () => source.platform().map((skill) => candidate(skill.name, skill.description, 'platform', 'the platform skills (read-only, docs/skills/)', -1)),
      get: async (found) => {
        const skill = source.platform().find((entry) => entry.name === String(found.locator))
        return skill === undefined ? undefined : { ...found, content: skill.text }
      },
    }))
    ctx.skills.registerProvider(() => ({
      name: 'space-library',
      list: async () => (await source.granted()).map((skill) => candidate(skill.name, skill.description, 'space-library', 'the Space skill library (read-only)')),
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
  /** Propose one of the Robot's local skills for the Space library (an ask). */
  promoteSkill(name: string, visibility: 'home' | 'private'): Promise<{ proposalId: string }>
}

export interface SkillLibraryHost {
  /** Every skill in the Space library this Robot's owner can see, with whether this Robot holds it (cd-wfn2). */
  skillLibrary(): Promise<SkillLibraryRow[]>
}

/**
 * The Space skill library as this Robot sees it (cd-wfn2, cd-56kk). Every Robot has it, skills grant
 * or not: a Robot without skills needs it most, to propose exactly the ones it needs.
 */
export function skillLibraryTools(host: SkillLibraryHost): ToolDefinition[] {
  return [
    tool<Record<string, never>>({
      name: 'skill_library',
      description: 'List every skill in the Space library: name, description, held (whether you hold it) and source (where it comes from; a connector skill names the connector that brings it). Mr. Robot also gets holders, the Robots that hold each skill. Use it to propose exactly the skills you need.',
      parameters: { properties: {} },
      concurrencySafe: true,
      // Rows are copied: an RPC result is not plain JSON to the tool output check.
      execute: async () => (await host.skillLibrary()).map((row) => ({ ...row })),
    }),
  ]
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
      description: 'Create or replace one of your own local skills (skills/<name>/SKILL.md in your Workspace). content is the full SKILL.md: Markdown with "name" and "description" frontmatter. Skills from the Space library are read-only; write a local skill with another name instead.',
      parameters: { properties: { name: { type: 'string', description: 'lowercase-with-dashes' }, content: { type: 'string', description: 'The full SKILL.md: Markdown with name and description frontmatter' } }, required: ['name', 'content'] },
      execute: async ({ name, content }) => {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('a skill name is lowercase letters, digits and dashes')
        return host.writeSkill(name, content)
      },
    }),
    tool<{ name: string; visibility?: 'home' | 'private' }>({
      name: 'propose_skill',
      description: 'Propose one of your local skills for the Space library, so other Robots can be granted it. Your owner approves it first. visibility "private" keeps it to your owner\'s Robots.',
      parameters: { properties: { name: { type: 'string', description: 'Skill name' }, visibility: { type: 'string', enum: ['home', 'private'], description: 'home (default) shares it in the Space library; private keeps it to your owner\'s Robots' } }, required: ['name'] },
      execute: async ({ name, visibility }) => ({ ...(await host.promoteSkill(name, visibility ?? 'home')), status: 'waiting for your owner' }),
    }),
  ]
}
