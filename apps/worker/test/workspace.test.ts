import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Attachment, Conversation, ProposalView } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

/** An active Robot of Anna's with the given tool groups. */
async function activeRobot(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

/** Tool results the model has seen, from its latest request. */
function toolResults(id: string): string[] {
  return ((requests.get(id) ?? []).at(-1)?.messages ?? [])
    .filter((message) => message.role === 'tool')
    .map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
}

describe('the Workspace (robot-scwl, robot-om9f)', () => {
  it('is seeded with the Muse persona files and mounts the Member files read-only', async () => {
    const id = await activeRobot(['files'])
    await turn(id, 'list your files', [{ calls: [{ name: 'glob', args: { pattern: '**' } }] }, { text: 'done' }])
    const listing = toolResults(id).at(-1)!
    for (const file of ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md', 'USER.md', 'PROACTIVE_PREFERENCES.md']) {
      expect(listing).toContain(file)
    }
    const prompt = (requests.get(id) ?? []).at(-1)!.messages.find((message) => message.role === 'system')
    expect(JSON.stringify(prompt)).toContain('You\'re not a chatbot')
  })

  it('refuses edits to USER.md and turns them into a proposal the owner approves (robot-mj7v, robot-jpzp)', async () => {
    const id = await activeRobot(['files'])
    await turn(id, 'remember I like tea', [
      { calls: [{ name: 'edit', args: { file_path: 'USER.md', old_string: '**Notes:**', new_string: '**Notes:** likes tea' } }] },
      { calls: [{ name: 'propose_member_file_edit', args: { file: 'USER.md', content: '# USER.md\n- likes tea\n', purpose: 'You like tea' } }] },
      { text: 'Proposed.' },
    ])
    expect(toolResults(id)[0]).toContain('read-only')
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    const question = conversation.items.find((item) => item.kind === 'question')
    if (question?.kind !== 'question') throw new Error('no proposal')
    expect(question.proposal).toMatchObject({ kind: 'member-file', file: { name: 'USER.md' } })
    scripts.set(id, [{ text: 'Thanks.' }])
    await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${question.proposal.id}`, { body: { revision: question.proposal.revision, approve: true } })
    await settle(id)
    expect((await api<{ content: string }>(ANNA, '/api/me/files/USER.md')).body.content).toBe('# USER.md\n- likes tea\n')
  })

  it('keeps file tools inside the Robot\'s own prefix (robot-8pqy)', async () => {
    const other = await activeRobot(['files'])
    const id = await activeRobot(['files'])
    await turn(id, 'escape', [
      { calls: [{ name: 'read', args: { file_path: `../${other}/SOUL.md` } }] },
      { calls: [{ name: 'write', args: { file_path: '../../evil.md', content: 'x' } }] },
      { calls: [{ name: 'write', args: { file_path: 'notes/../notes/ok.md', content: 'fine' } }] },
      { text: 'done' },
    ])
    const [read, escape, ok] = toolResults(id)
    expect(read).toContain('outside your Workspace')
    expect(escape).toContain('outside your Workspace')
    expect(ok).toContain('notes/ok.md')
    expect(await env.FILES.head(`robots/${id}/notes/ok.md`)).not.toBeNull()
    expect((await env.FILES.list({ prefix: 'evil' })).objects).toHaveLength(0)
  })

  it('stores a chat attachment in the Workspace where the Robot can read it (robot-jlzk)', async () => {
    const id = await activeRobot(['files'])
    const { SELF } = await import('cloudflare:test')
    const upload = await SELF.fetch(`https://mr-robot.test/api/robots/${id}/files?name=invoice.txt`, {
      method: 'PUT', headers: { 'x-dev-identity': ANNA, 'content-type': 'text/plain' }, body: 'Invoice 42: 99 PLN',
    })
    const attachment = (await upload.json()) as Attachment
    expect(attachment.path).toMatch(/^attachments\/\d{4}-\d{2}-\d{2}\/.+invoice\.txt$/)
    scripts.set(id, [{ calls: [{ name: 'read', args: { file_path: attachment.path } }] }, { text: 'It is invoice 42.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'what is this?', attachments: [attachment] } })
    await settle(id)
    expect(toolResults(id)[0]).toContain('1: Invoice 42: 99 PLN')
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.at(-3)).toMatchObject({ kind: 'message', text: 'what is this?', attachments: [{ name: 'invoice.txt' }] })
    expect(conversation.items.at(-2)).toMatchObject({ kind: 'activity', tools: ['read'] })
  })

  it('tells the owner when it changes SOUL.md (robot-h1nm)', async () => {
    const id = await activeRobot(['files'])
    await turn(id, 'be terse', [{ calls: [{ name: 'write', args: { file_path: 'SOUL.md', content: '# SOUL.md\nTerse.' } }] }, { text: 'I am terse now.' }])
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.some((item) => item.kind === 'notice' && item.text.endsWith('changed SOUL.md.'))).toBe(true)
  })
})

describe('compaction (robot-zzif, robot-sw54)', () => {
  it('triggers at the Robot\'s context budget and follows its compaction instruction', async () => {
    const id = await activeRobot([])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { contextBudget: 8000, compactionInstruction: 'Keep every apartment price.' } })
    // A long first answer fills most of the 8000-token budget.
    await turn(id, 'first', [{ text: 'Apartment on Mokotowska, 1 200 000 PLN. '.repeat(700), inputTokens: 7900 }])
    scripts.set(id, [{ text: '## Primary Request and Intent\n- prices' }, { text: 'after compaction' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'second' } })
    await settle(id)
    const compaction = (requests.get(id) ?? []).find((request) => request.purpose === 'compaction')
    expect(compaction).toBeDefined()
    expect(JSON.stringify(compaction!.messages)).toContain('Keep every apartment price.')
    // The checkpoint has room to be written (at 8k the headroom alone is 400 tokens).
    expect(compaction!.maxTokens).toBeGreaterThanOrEqual(4000)
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items).toContainEqual(expect.objectContaining({ kind: 'notice', text: 'Earlier conversation condensed to fit the context budget.' }))
    expect(items.some((item) => item.kind === 'message' && item.text.includes('checkpoint'))).toBe(false)
    expect((await robots(ANNA)).length).toBeGreaterThan(0)
  })
})