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
  /** The skills of the Host its Workspace is on (v1.21, cw-s2rt): the OS user's home roots and the repository's; none without a Workspace. */
  host(): Promise<{ readonly host: string; readonly entries: ReadonlyArray<{ name: string; description: string; scope: 'home' | 'repository' }> }>
  hostContent(name: string): Promise<string | null>
  /** Tell the catalog to read the Host's skills again (their catalog changed). */
  onHostChange(listener: () => void): void
}

/** One skill as the catalog ranks it: lower rank wins a name (DSH's registry), platform -1, library and Host home 0, local and Host repository 1. */
interface Ranked {
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly rank: number
  /** Where it is from, for the shadow note. */
  readonly from: string
  readonly base: string
}

/**
 * The whole catalog with its shadow notes (v1.21, cw-s2rt): the winner of a name says which skills of the same name it hides, so that the
 * owner can rename his. A repository's skill never shadows a platform skill: the platform's practice is the platform's.
 */
async function rankedCatalog(source: SkillSource): Promise<Ranked[]> {
  const host = await source.host()
  const all: Ranked[] = [
    ...source.platform().map((skill) => ({ name: skill.name, description: skill.description, provider: 'platform', rank: -1, from: 'platform', base: 'the platform skills (read-only, docs/skills/)' })),
    ...(await source.granted()).map((skill) => ({ name: skill.name, description: skill.description, provider: 'space-library', rank: 0, from: 'Space library', base: 'the Space skill library (read-only)' })),
    ...host.entries.filter((skill) => skill.scope === 'home').map((skill) => ({ name: skill.name, description: skill.description, provider: 'host', rank: 0, from: `${host.host} home`, base: `${host.host}: the OS user's skills` })),
    ...(await source.local()).map((skill) => ({ name: skill.name, description: skill.description, provider: 'local', rank: 1, from: 'local', base: `your Files, skills/${skill.name}/` })),
    ...host.entries.filter((skill) => skill.scope === 'repository').map((skill) => ({ name: skill.name, description: skill.description, provider: 'host', rank: 1, from: `${host.host} repository`, base: `${host.host}: the repository's .agents/skills` })),
  ]
  const byName = new Map<string, Ranked[]>()
  for (const skill of all) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill])
  return all.map((skill) => {
    const same = byName.get(skill.name) ?? []
    // The registry keeps the first of the lowest rank; the others are shadowed by it.
    const winner = [...same].sort((a, b) => a.rank - b.rank)[0]
    if (winner !== skill || same.length === 1) return skill
    const hidden = same.filter((other) => other !== skill).map((other) => `also: ${other.from} skill of the same name, shadowed`)
    return { ...skill, description: `${skill.description} (${hidden.join('; ')})` }
  })
}

export function skillsPlugin(source: SkillSource): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(SkillRegistry, {})
    const candidate = (name: string, description: string, provider: string, base: string, rank = provider === 'local' ? 1 : 0): SkillCandidate => ({
      name, description, invocation: { modelInvocable: true, userInvocable: false }, source: 'custom', provider, rank, locator: name,
      resourceBase: { kind: 'opaque', description: base },
    })
    // One catalog for every provider, so that a winner can name what it shadows (cw-s2rt). Platform skills win a name (gb-n6by).
    const listed = (provider: string) => async () => (await rankedCatalog(source)).filter((skill) => skill.provider === provider).map((skill) => candidate(skill.name, skill.description, provider, skill.base, skill.rank))
    ctx.skills.registerProvider(() => ({
      name: 'platform',
      list: listed('platform'),
      get: async (found) => {
        const skill = source.platform().find((entry) => entry.name === String(found.locator))
        return skill === undefined ? undefined : { ...found, content: skill.text }
      },
    }))
    ctx.skills.registerProvider(() => ({
      name: 'space-library',
      list: listed('space-library'),
      get: async (found) => {
        const content = await source.content(String(found.locator))
        return content === null ? undefined : { ...found, content }
      },
    }))
    ctx.skills.registerProvider(() => ({
      name: 'local',
      list: listed('local'),
      get: async (found) => {
        const content = await source.localContent(String(found.locator))
        return content === null ? undefined : { ...found, content }
      },
    }))
    // The skills of the Workspace's Host (v1.21, cw-s2rt): home ones rank with the library, repository ones with the local skills.
    ctx.skills.registerProvider((control) => {
      source.onHostChange(() => control.invalidate())
      return {
        name: 'host',
        list: listed('host'),
        get: async (found) => {
          const content = await source.hostContent(String(found.locator))
          return content === null ? undefined : { ...found, content }
        },
      }
    })
    await ctx.plugin(ToolSkill, {})
  }
}

export interface SkillHost {
  /** Write a local skill; refused for a global skill's name unless this Robot may edit the library. */
  writeSkill(name: string, content: string): Promise<{ path: string; scope: 'local' | 'global' }>
  /** Propose one of the Robot's local skills for the Space library (an ask). */
  promoteSkill(name: string, visibility: 'space' | 'private'): Promise<{ proposalId: string }>
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
    tool<{ name: string; visibility?: 'space' | 'private' }>({
      name: 'propose_skill',
      description: 'Propose one of your local skills for the Space library, so other Robots can be granted it. Your owner approves it first. visibility "private" keeps it to your owner\'s Robots.',
      parameters: { properties: { name: { type: 'string', description: 'Skill name' }, visibility: { type: 'string', enum: ['space', 'private'], description: 'home (default) shares it in the Space library; private keeps it to your owner\'s Robots' } }, required: ['name'] },
      execute: async ({ name, visibility }) => ({ ...(await host.promoteSkill(name, visibility ?? 'space')), status: 'waiting for your owner' }),
    }),
  ]
}
