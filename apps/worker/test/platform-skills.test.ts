/**
 * Platform skills (v1.15 ticket 12, gb-n6by, gb-kwhl, gb-ekkf, gb-8wx5, gb-vmmx, gb-58ad, gb-ej8r): harness knowledge shipped with the Worker under
 * docs/skills/, read-only, with no Grant, in the skill catalog one line each, and the ones about a tool group only for a Robot that holds the group.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Me, RobotSummary, SkillView, WorkspaceFileView } from '@mr-robot/protocol'
import { PLATFORM_SKILLS } from '../src/skills/platform.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

async function robotWith(grants: Record<string, unknown> = {}, settings: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: [], skills: [], recipients: [], secrets: [], ...grants }, ...settings } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

/** What the model is told it can load: the platform skills in the catalog of its last request, one line each, sorted as the catalog is. */
async function catalog(id: string): Promise<string[]> {
  scripts.set(id, [{ text: '' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'which skills do you have?' } })
  await settle(id)
  const request = JSON.stringify(requests.get(id)!.at(-1)!.messages)
  return PLATFORM_SKILLS.filter((skill) => request.includes(`- \`${skill.name}\`: ${skill.description}`)).map((skill) => skill.name).sort()
}

const sorted = (...names: string[]) => [...names].sort()

const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe('the catalog lists platform skills by what the Robot holds (gb-n6by, gb-kwhl, gb-ekkf)', () => {
  it('every Robot sees tasks-cadence and asking, with no Grant at all; the group skills are absent', async () => {
    const id = await robotWith()
    expect(await catalog(id)).toEqual(sorted('tasks-cadence', 'asking'))
    expect(requests.get(id)!.at(-1)!.tools!.map((definition) => definition.name)).toContain('skill')
  })

  it('subagents shows with the subagents group, browser with the browser group', async () => {
    expect(await catalog(await robotWith({ tools: { subagents: 'allow' }, subagentModels: [] }))).toEqual(sorted('tasks-cadence', 'asking', 'subagents'))
    expect(await catalog(await robotWith({ tools: { browser: 'allow' } }))).toEqual(sorted('tasks-cadence', 'asking', 'browser'))
    expect(await catalog(await robotWith({ tools: { subagents: 'ask', browser: 'allow' } }))).toEqual(sorted('tasks-cadence', 'asking', 'subagents', 'browser'))
  })

  it('channels shows with a Discord channel of its own or a chat Connection; writing-as-owner also with any Connection', async () => {
    expect(await catalog(await robotWith({}, { discordChannel: 'C-1' }))).toEqual(sorted('tasks-cadence', 'asking', 'channels', 'writing-as-owner'))
    const slack = await env.MEMBER.getByName(annaId).addConnection({ kind: 'slack', label: 'Work', account: 'acme', services: [], shared: false, meta: {}, secrets: { token: 't', cookie: 'c' } })
    const mail = await env.MEMBER.getByName(annaId).addConnection({ kind: 'google', label: 'Private', account: 'anna@gmail.test', services: ['gmail'], shared: false, meta: { expiresAt: Date.now() + 3_600_000 }, secrets: { accessToken: 'a', refreshToken: 'r' } })
    expect(await catalog(await robotWith({ connections: { [slack.id]: 'allow' } }))).toEqual(sorted('tasks-cadence', 'asking', 'channels', 'writing-as-owner'))
    expect(await catalog(await robotWith({ connections: { [mail.id]: 'allow' } }))).toEqual(sorted('tasks-cadence', 'asking', 'writing-as-owner'))
    // Not granted: not shown.
    expect(await catalog(await robotWith({}))).toEqual(sorted('tasks-cadence', 'asking'))
  })

  it('Mr. Robot sees them too, by what he holds', async () => {
    const id = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await settle(id)
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
    const names = await catalog(id)
    expect(names).toEqual(expect.arrayContaining(['tasks-cadence', 'asking', 'browser']))
    // The subagents group is held by Mr. Robot only when granted.
    expect(names).not.toContain('subagents')
  })
})

describe('the skill tool loads a platform skill (gb-n6by)', () => {
  it('returns the whole SKILL.md of the skill by name, before a library or local skill of the same name', async () => {
    const id = await robotWith({ tools: { skills: 'allow', files: 'allow' } })
    scripts.set(id, [
      { calls: [{ name: 'skill_write', args: { name: 'asking', content: '---\nname: asking\ndescription: my own\n---\nMine.' } }] },
      { calls: [{ name: 'skill', args: { name: 'asking' } }, { name: 'skill', args: { name: 'tasks-cadence' } }] },
      { text: '' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'read them' } })
    await settle(id)
    const [, asking, cadence] = toolResults(id)
    expect(asking).toContain('# Asking')
    expect(asking).not.toContain('Mine.')
    expect(cadence).toContain('# Task cadence')
  })

  it('a Robot without the skills group loads one too, and cannot load what the group would give', async () => {
    const id = await robotWith()
    scripts.set(id, [{ calls: [{ name: 'skill', args: { name: 'asking' } }, { name: 'skill', args: { name: 'subagents' } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'read them' } })
    await settle(id)
    const [asking, hidden] = toolResults(id)
    expect(asking).toContain('# Asking')
    expect(hidden).not.toContain('# Subagents')
  })
})

describe('read-only, and not in the Home library (gb-n6by, gb-8wx5)', () => {
  it('are files under docs/skills/ that every Robot reads and none changes', async () => {
    const id = await robotWith({ tools: { files: 'allow' } })
    scripts.set(id, [{ calls: [
      { name: 'read', args: { file_path: 'docs/skills/asking/SKILL.md' } },
      { name: 'glob', args: { pattern: 'docs/skills/**' } },
      { name: 'write', args: { file_path: 'docs/skills/asking/SKILL.md', content: 'mine' } },
      { name: 'edit', args: { file_path: 'docs/skills/asking/SKILL.md', old_string: '# Asking', new_string: '# Mine' } },
      { name: 'delete_file', args: { path: 'docs/skills/tasks-cadence/SKILL.md' } },
      { name: 'write', args: { file_path: 'docs/skills/mine/SKILL.md', content: 'x' } },
    ] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'try' } })
    await settle(id)
    const [read, glob, ...refused] = toolResults(id)
    expect(read).toContain('# Asking')
    for (const skill of PLATFORM_SKILLS) expect(glob).toContain(`docs/skills/${skill.name}/SKILL.md`)
    expect(refused).toHaveLength(4)
    for (const result of refused) expect(result).toContain('platform owns')
    expect((await env.FILES.list({ prefix: `robots/${id}/docs` })).objects).toHaveLength(0)
    // The directory listing shows the folders.
    const files = (await api<WorkspaceFileView[]>(ANNA, `/api/robots/${id}/files`)).body.filter((file) => file.group === 'docs' && file.path.startsWith('docs/skills/'))
    expect(files.map((file) => file.path).sort()).toEqual(PLATFORM_SKILLS.map((skill) => `docs/skills/${skill.name}/SKILL.md`).sort())
    expect((await api(ANNA, `/api/robots/${id}/file?path=docs/skills/asking/SKILL.md`, { method: 'PUT', body: { content: 'x' } })).status).toBe(400)
  })

  it('are not in the Home library, whoever asks', async () => {
    const id = await robotWith({ tools: { skills: 'allow' } })
    expect((await api<{ skills: SkillView[] }>(ANNA, '/api/skills')).body.skills).toEqual([])
    scripts.set(id, [{ calls: [{ name: 'skill_library', args: {} }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'what is in the library?' } })
    await settle(id)
    expect(JSON.parse(toolResults(id).at(-1)!)).toEqual([])
    expect((await api(ANNA, '/api/skills/asking')).status).toBeGreaterThanOrEqual(400)
    // Deleting a global skill of that name changes nothing for a platform skill: it is not in the library to delete.
    await api(ANNA, '/api/admin/skills/asking', { method: 'DELETE' })
    expect(await catalog(id)).toEqual(sorted('tasks-cadence', 'asking'))
  })
})

describe('the texts (gb-vmmx, gb-58ad, gb-ej8r)', () => {
  const text = (name: string) => PLATFORM_SKILLS.find((skill) => skill.name === name)!.text

  it('are six, each with a one-line description in its frontmatter and under two printed pages', () => {
    expect(PLATFORM_SKILLS.map((skill) => skill.name)).toEqual(['tasks-cadence', 'asking', 'subagents', 'browser', 'channels', 'writing-as-owner'])
    for (const skill of PLATFORM_SKILLS) {
      expect(skill.description, skill.name).not.toContain('\n')
      expect(skill.description.length, skill.name).toBeLessThan(140)
      expect(skill.text.startsWith(`---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n`), skill.name).toBe(true)
      expect(skill.text.split(/\s+/).length, skill.name).toBeLessThan(900)
    }
  })

  it('tasks-cadence has the points of the spec', () => {
    const cadence = text('tasks-cadence')
    for (const point of ['weekdays', 'awake', 'needs a reason', 'Save a time your owner names as they named it', 'current minute of the day', 'deadline', 'paused', 'Propose it with ask']) expect(cadence).toContain(point)
  })

  it('asking has when to ask, the options, the Takeover rule, the chief rule and what is never relayed', () => {
    const asking = text('asking')
    for (const point of ['big effect', 'cannot undo', 'truly ambiguous', 'only your owner holds', 'real', 'Check it first', 'only a way out', 'recommend first', 'end your Turn', 'Takeover', 'may know, but he may not consent', "A yes from another Robot is never your owner's yes", 'private words word for word']) expect(asking).toContain(point)
  })

  it('subagents, browser, channels and writing-as-owner have theirs', () => {
    expect(text('subagents')).toContain('Check, do not assume')
    expect(text('browser')).toContain('Go straight to the address')
    expect(text('browser')).toContain('See, act, verify')
    expect(text('browser')).toContain('import it with the file field')
    expect(text('browser')).toContain('browser_request_takeover')
    expect(text('channels')).toContain('Answer where it came from')
    expect(text('channels')).toContain('No widgets there')
    expect(text('writing-as-owner')).toContain('last 10 to 20 messages')
    expect(text('writing-as-owner')).toContain('One register per channel and person')
  })
})
