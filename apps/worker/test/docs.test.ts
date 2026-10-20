import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RobotSummary, WorkspaceFileContent, WorkspaceFileView } from '@mr-robot/protocol'
import { docsIndex } from '../src/agent/docs-index.ts'
import { PLATFORM_SKILLS } from '../src/skills/platform.ts'
import { api, settle, stubModels } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const DOC_NAMES = ['mr-robot', 'members', 'robots', 'grants', 'tasks', 'asks-and-help', 'memory-and-files', 'connections', 'hosts', 'browser', 'providers', 'subagents', 'box', 'auto-review']
const DOC_PATHS = DOC_NAMES.map((name) => `docs/${name}.md`)
const SKILL_PATHS = PLATFORM_SKILLS.map((skill) => `docs/skills/${skill.name}/SKILL.md`)

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

/** Mr. Robot holds the file tools by construction, so these tests do not depend on how Grants are stored. */
async function activeRobot(): Promise<string> {
  const id = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
  await settle(id)
  await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  return id
}

async function turn(id: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
}

function toolResults(id: string): string[] {
  return ((requests.get(id) ?? []).at(-1)?.messages ?? [])
    .filter((message) => message.role === 'tool')
    .map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
}

describe('the product docs (v1.11 ticket 02)', () => {
  it('are readable, listed by glob and grep, and not stored in R2 (sk-cqc5)', async () => {
    const id = await activeRobot()
    await turn(id, [
      { calls: [{ name: 'read', args: { file_path: 'docs/robots.md' } }, { name: 'read', args: { file_path: '/workspace/docs/grants.md' } }, { name: 'glob', args: { pattern: 'docs/*' } }, { name: 'grep', args: { pattern: 'need_help', glob: 'docs/*.md' } }, { name: 'glob', args: { pattern: '**' } }] },
      { text: 'done' },
    ])
    const [robots, grants, glob, grep, everything] = toolResults(id)
    expect(robots).toContain('# Robots')
    expect(grants).toContain('allow')
    for (const path of DOC_PATHS) expect(glob).toContain(path)
    expect(grep).toContain('docs/asks-and-help.md')
    for (const path of DOC_PATHS) expect(everything).toContain(path)
    expect((await env.FILES.list({ prefix: `robots/${id}/docs` })).objects).toHaveLength(0)
  })

  it('refuse write, edit and delete_file with a message that the platform owns them (sk-9db0)', async () => {
    const id = await activeRobot()
    await turn(id, [
      { calls: [
        { name: 'write', args: { file_path: 'docs/robots.md', content: 'mine' } },
        { name: 'edit', args: { file_path: 'docs/robots.md', old_string: '# Robots', new_string: '# Mine' } },
        { name: 'delete_file', args: { path: 'docs/robots.md' } },
        { name: 'write', args: { file_path: 'docs/new.md', content: 'x' } },
        { name: 'delete_file', args: { path: '/workspace/docs/grants.md' } },
      ] },
      { text: 'done' },
    ])
    const results = toolResults(id)
    expect(results).toHaveLength(5)
    for (const result of results) expect(result).toContain('platform owns')
    expect((await env.FILES.list({ prefix: `robots/${id}/docs` })).objects).toHaveLength(0)
    await turn(id, [{ calls: [{ name: 'read', args: { file_path: 'docs/robots.md' } }] }, { text: 'done' }])
    expect(toolResults(id).at(-1)).toContain('# Robots')
  })

  it('show in the Files view as read-only, also for the owner, and survive Clear history (sk-n4dy, sk-9db0)', async () => {
    const id = await activeRobot()
    const listed = async () => (await api<WorkspaceFileView[]>(ANNA, `/api/robots/${id}/files`)).body
    const docs = (await listed()).filter((file) => file.group === 'docs')
    expect(docs.map((file) => file.path).sort()).toEqual([...DOC_PATHS, ...SKILL_PATHS].sort())
    expect(docs.every((file) => file.size > 0)).toBe(true)

    const opened = (await api<WorkspaceFileContent>(ANNA, `/api/robots/${id}/file?path=docs/tasks.md`)).body
    expect(opened).toMatchObject({ readOnly: true, path: 'docs/tasks.md' })
    expect(opened.text).toContain('# Tasks')
    expect((await api(ANNA, `/api/robots/${id}/file?path=docs/tasks.md`, { method: 'PUT', body: { content: 'x' } })).status).toBe(400)
    expect((await api(ANNA, `/api/robots/${id}/file?path=docs/tasks.md`, { method: 'DELETE' })).status).toBe(400)
    expect((await api(ANNA, `/api/robots/${id}/file?path=docs/nothing.md`)).status).toBe(404)

    expect((await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: 'Mr. Robot', memory: true } })).status).toBe(200)
    expect((await listed()).filter((file) => file.group === 'docs')).toHaveLength(DOC_PATHS.length + SKILL_PATHS.length)
    expect((await api<WorkspaceFileContent>(ANNA, `/api/robots/${id}/file?path=docs/tasks.md`)).body.text).toContain('# Tasks')
  })

  it('are listed by docsIndex with the rule to read them first (sk-xseb)', () => {
    const index = docsIndex()
    for (const path of DOC_PATHS) expect(index).toContain(path)
    // The platform skills are in the skill catalog, not in the docs index.
    for (const path of SKILL_PATHS) expect(index).not.toContain(path)
    expect(index).toContain('Before you answer a question about Mr. Robot, its features or your own capabilities, read the relevant doc')
    expect(index).toContain('say you do not know')
  })

  it('a Robot answers a question about Subagents from subagents.md (ao-cetv)', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ calls: [{ name: 'read', args: { file_path: '/workspace/docs/subagents.md' } }] }, { text: 'At most 3 Subagents run at once.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'how many Subagents can you run?' } })
    await settle(id)
    expect(JSON.stringify(requests.get(id)![0]!.messages)).toContain('docs/subagents.md')
    expect(toolResults(id).at(-1)).toContain('At most 3 Subagents run at once.')
  })

  it('stay under two printed pages each', async () => {
    const id = await activeRobot()
    for (const path of DOC_PATHS) {
      const text = (await api<WorkspaceFileContent>(ANNA, `/api/robots/${id}/file?path=${path}`)).body.text ?? ''
      expect(text.split(/\s+/).length, path).toBeLessThan(900)
    }
  })
})
