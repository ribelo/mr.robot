import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, ProposalView, Trajectory } from '@mr-robot/protocol'
import { api, boundToolNames, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function activeRobot(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools, skills: [], recipients: [], secrets: [] } } })
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
    const id = await activeRobot(['files'])
    const program = [
      "await tools.write({ on: 'files', file_path: 'notes/a.md', content: 'alpha' })",
      "const text = await tools.read({ on: 'files', file_path: 'notes/a.md' })",
      "const listing = await tools.glob({ on: 'files', pattern: 'notes/**' })",
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

  it('is the only mode: the settings refuse codeMode, and the model is offered run_code alone (v1.22, td-2z82)', async () => {
    const id = await activeRobot(['files'])
    for (const codeMode of [false, true]) {
      const refused = await api<string>(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode } })
      expect(refused.status).toBe(400)
    }
    expect((await api<Record<string, unknown>>(ANNA, `/api/robots/${id}/panel`)).body).not.toHaveProperty('settings.codeMode')
    await say(id, 'hi', [{ text: 'hi' }])
    expect(toolNames(id)).toEqual(['run_code'])
    expect(await boundToolNames(id)).toContain('read')
  })

  it('runs a program in setup too (v1.22, td-2z82)', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    const program = [
      "await tools.write({ on: 'files', file_path: 'SOUL.md', content: '# Soul\\nI watch prices.' })",
      "return await tools.read({ on: 'files', file_path: 'SOUL.md' })",
    ].join('\n')
    await say(body.id, 'you watch prices', [{ calls: [{ name: 'run_code', args: { code: program, description: 'write and read the soul' } }] }, { text: 'Noted.' }])
    expect(toolNames(body.id)).toEqual(['run_code'])
    const { events } = (await api<Trajectory>(ANNA, `/api/robots/${body.id}/trajectory`)).body
    expect(events.filter((event) => event.type === 'tool/ptc-dispatch').map((event) => JSON.parse(event.data).name)).toEqual(['write', 'read'])
    expect(events.find((event) => event.type === 'tool/result')!.data).toContain('I watch prices.')
    expect((await api<{ status: string }[]>(ANNA, '/api/robots')).body).toEqual(expect.arrayContaining([expect.objectContaining({ id: body.id, status: 'setup' })]))
  })
})

describe('Grants (robot-f9ln, robot-0ms7)', () => {
  it('keeps an ungranted tool out of the catalog and out of the executor', async () => {
    const id = await activeRobot([])
    await say(id, 'try files', [
      { calls: [{ name: 'run_code', args: { code: "return await tools.read({ on: 'files', file_path: 'SOUL.md' })", description: 'read soul' } }] },
      { text: 'I cannot.' },
    ])
    const system = JSON.stringify(lastRequest(id).messages.filter((message) => message.role === 'system'))
    expect(system).not.toContain('file_path')
    const { events } = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body
    const result = events.find((event) => event.type === 'tool/result')!
    expect(result.data).toContain('tools.read is not a function')
    expect(result.data).not.toContain("You're not a chatbot")

    // Conversation-level tools only (ask, draft_revise and say need no Grant); robot_reply works only with a handle another Robot sent.
    expect(await boundToolNames(id)).toEqual(['ask', 'conversation_search', 'draft_revise', 'memory_search', 'my_capabilities', 'propose_grants', 'propose_member_file_edit', 'propose_review', 'react', 'request_credential', 'robot_reply', 'say', 'set_identity', 'skill', 'skill_library'])
  })

  it('has no shell, terminal or container tool at all', async () => {
    const id = await activeRobot(['files', 'web', 'tasks', 'notify'])
    for (const name of await boundToolNames(id)) expect(name).not.toMatch(/bash|shell|terminal|exec|container|subagent/)
  })

  it('applies exactly the stored Grant proposal when the owner answers (robot-vy9z)', async () => {
    const id = await activeRobot([])
    await say(id, 'please watch prices', [
      { calls: [{ name: 'propose_grants', args: { purpose: 'Read listing pages', tools: ['web', 'files'] } }] },
      { text: 'I asked for access.' },
    ])
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    const question = conversation.items.find((item) => item.kind === 'proposal')
    if (question?.kind !== 'proposal') throw new Error('no grant question')
    scripts.set(id, [{ text: 'Thanks.' }])
    await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${question.proposal.id}`, { body: { revision: question.proposal.revision, approve: true } })
    await settle(id)
    const settings = await testRobot(id).settings()
    expect(settings.grants.tools).toEqual({ files: 'allow', web: 'allow' })
    expect(await boundToolNames(id)).toEqual(expect.arrayContaining(['read', 'web_fetch']))
    expect(await boundToolNames(id)).not.toContain('web_search')
  })
})

describe('advanced settings (robot-vqtw)', () => {
  it('take effect on the next Turn: model, effort, budget, Grants', async () => {
    const id = await activeRobot([])
    await say(id, 'one', [{ text: 'one' }])
    expect(lastRequest(id).model).toBe('stub')
    expect(toolNames(id)).toEqual(['run_code'])
    await api(ANNA, `/api/robots/${id}/settings`, {
      method: 'PATCH',
      body: { model: { provider: 'stub', model: 'stub-large', effort: 'high' }, contextBudget: 64000, grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } },
    })
    await say(id, 'two', [{ text: 'two' }])
    expect(lastRequest(id).model).toBe('stub-large')
    expect(toolNames(id)).toEqual(['run_code'])
    expect(await boundToolNames(id)).toContain('read')
  })
})