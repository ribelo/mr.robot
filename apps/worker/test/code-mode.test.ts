import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, ProposalView, Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function activeRobot(tools: string[], codeMode: boolean): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const lastRequest = (id: string) => requests.get(id)!.at(-1)!
const toolNames = (id: string) => (lastRequest(id).tools ?? []).map((tool) => tool.name).sort()

describe('code mode (robot-5ewr, robot-ax7s)', () => {
  it('runs three tool calls as one executed program', async () => {
    const id = await activeRobot(['files'], true)
    const program = [
      "await tools.write_file({ path: 'notes/a.md', content: 'alpha' })",
      "const text = await tools.read_file({ path: 'notes/a.md' })",
      "const listing = await tools.glob({ pattern: 'notes/**' })",
      'return { text, listing }',
    ].join('\n')
    await say(id, 'do three things', [{ calls: [{ name: 'run_code', args: { code: program, description: 'write, read, list' } }] }, { text: 'Done.' }])
    expect(toolNames(id)).toEqual(['run_code'])
    const { events } = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body
    const calls = events.filter((event) => event.type === 'tool/call').map((event) => JSON.parse(event.data).name)
    expect(calls).toEqual(['run_code'])
    const result = events.find((event) => event.type === 'tool/result')!
    expect(result.data).toContain('alpha')
    expect(result.data).toContain('notes/a.md')
  })

  it('switches to direct tool calls per Robot', async () => {
    const id = await activeRobot(['files'], false)
    await say(id, 'hi', [{ text: 'hi' }])
    expect(toolNames(id)).toContain('read_file')
    expect(toolNames(id)).not.toContain('run_code')
  })
})

describe('Grants (robot-f9ln, robot-0ms7)', () => {
  it('keeps an ungranted tool out of the catalog and out of the executor', async () => {
    const id = await activeRobot([], true)
    await say(id, 'try files', [
      { calls: [{ name: 'run_code', args: { code: "return await tools.read_file({ path: 'SOUL.md' })", description: 'read soul' } }] },
      { text: 'I cannot.' },
    ])
    const system = JSON.stringify(lastRequest(id).messages.filter((message) => message.role === 'system'))
    expect(system).not.toContain('read_file')
    const { events } = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body
    const result = events.find((event) => event.type === 'tool/result')!
    expect(result.data).toContain('tools.read_file is not a function')
    expect(result.data).not.toContain("You're not a chatbot")

    const direct = await activeRobot([], false)
    await say(direct, 'hi', [{ text: 'hi' }])
    expect(toolNames(direct)).toEqual(['propose_grants', 'propose_member_file_edit', 'react'])
  })

  it('has no shell, terminal or container tool at all', async () => {
    const id = await activeRobot(['files', 'web', 'routines', 'notify'], false)
    await say(id, 'hi', [{ text: 'hi' }])
    for (const name of toolNames(id)) expect(name).not.toMatch(/bash|shell|terminal|exec|container|subagent/)
  })

  it('applies exactly the stored Grant proposal when the owner answers (robot-vy9z)', async () => {
    const id = await activeRobot([], false)
    await say(id, 'please watch prices', [
      { calls: [{ name: 'propose_grants', args: { purpose: 'Read listing pages', tools: ['web', 'files'] } }] },
      { text: 'I asked for access.' },
    ])
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    const question = conversation.items.find((item) => item.kind === 'question')
    if (question?.kind !== 'question') throw new Error('no grant question')
    scripts.set(id, [{ text: 'Thanks.' }])
    await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${question.proposal.id}`, { body: { revision: question.proposal.revision, approve: true } })
    await settle(id)
    const settings = await testRobot(id).settings()
    expect([...settings.grants.tools].sort()).toEqual(['files', 'web'])
    expect(toolNames(id)).toEqual(expect.arrayContaining(['read_file', 'web_fetch', 'web_search']))
  })
})

describe('advanced settings (robot-vqtw)', () => {
  it('take effect on the next Turn: model, effort, budget, code mode, Grants', async () => {
    const id = await activeRobot([], true)
    await say(id, 'one', [{ text: 'one' }])
    expect(lastRequest(id).model).toBe('stub')
    expect(toolNames(id)).toEqual(['run_code'])
    await api(ANNA, `/api/robots/${id}/settings`, {
      method: 'PATCH',
      body: { model: { provider: 'stub', model: 'stub-large', effort: 'high' }, codeMode: false, contextBudget: 64000, grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } },
    })
    await say(id, 'two', [{ text: 'two' }])
    expect(lastRequest(id).model).toBe('stub-large')
    expect(toolNames(id)).toContain('read_file')
    expect(toolNames(id)).not.toContain('run_code')
  })
})