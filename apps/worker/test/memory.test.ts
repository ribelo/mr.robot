import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotSummary } from '@mr-robot/protocol'
import { renderBaseline, type MemoryFile } from '../src/agent/memory.ts'
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

async function robotWith(tools: string[] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [], hosts: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const chatRequests = (id: string) => (requests.get(id) ?? []).filter((request) => request.purpose !== 'compaction')
const system = (request: { messages: Array<{ role: string }> }) => JSON.stringify(request.messages.filter((message) => message.role === 'system'))
const userText = (request: { messages: Array<{ role: string }> }) => JSON.stringify(request.messages.filter((message) => message.role === 'user'))

describe('memory as a plugin (v1.3 ticket 02)', () => {
  it('enters the context as one baseline message with every scope; an edit becomes a note, not a new system prompt (pl-w3n0, pl-9n7w, pl-o3ck, pl-fkg7, pl-yqno)', async () => {
    await api(ANNA, '/api/admin/home-memory', { method: 'PUT', body: { content: '# HOME.md\nElectricity: Tauron, account 123.' } })
    await api(ANNA, '/api/me/files/USER.md', { method: 'PUT', body: { content: '# USER.md\nCall me Anna.' } })
    const id = await robotWith()
    await turn(id, 'hi', [{ text: 'Hello Anna.' }])
    const first = chatRequests(id).at(-1)!
    expect(userText(first)).toContain('Electricity: Tauron, account 123.')
    expect(userText(first)).toContain('Call me Anna.')
    expect(userText(first)).toContain('path=\\"MEMORY.md\\"')
    expect(system(first)).not.toContain('Call me Anna.')

    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\nAnna pays bills on the 10th.' } })
    await turn(id, 'again', [{ text: 'Noted.' }])
    const second = chatRequests(id).at(-1)!
    expect(system(second)).toBe(system(first))
    const lastUser = JSON.stringify(second.messages.filter((message) => message.role === 'user').at(-1))
    expect(lastUser).toContain('changed: MEMORY.md by your owner')
    expect(lastUser).toContain('Anna pays bills on the 10th.')
    // The baseline is not repeated: one baseline in the context.
    expect(userText(second).split('Your memory and persona files as of now').length - 1).toBe(1)
    // The memory messages stay out of the chat.
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(JSON.stringify(items)).not.toContain('Your memory and persona files')
  })

  it('brings the full, fresh baseline back after compaction (pl-552r)', async () => {
    const id = await robotWith()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { contextBudget: 8000 } })
    await turn(id, 'first', [{ text: 'Apartment on Mokotowska, 1 200 000 PLN. '.repeat(700), inputTokens: 7900 }])
    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\nFresh after compaction.' } })
    await turn(id, 'second', [{ text: '## Primary Request and Intent\n- prices' }, { text: 'after compaction' }])
    expect((requests.get(id) ?? []).some((request) => request.purpose === 'compaction')).toBe(true)
    const after = chatRequests(id).at(-1)!
    expect(userText(after)).toContain('Your memory and persona files as of now')
    expect(userText(after)).toContain('Fresh after compaction.')
  })

  it("makes another Robot's USER.md edit an ask and Mr. Robot's direct, and tells the other Robots", async () => {
    const other = await robotWith()
    await turn(other, 'learn', [{ calls: [{ name: 'propose_member_file_edit', args: { file: 'USER.md', content: '# USER.md\nLikes tea.', purpose: 'tea' } }] }, { text: 'Proposed.' }])
    const ask = (await api<Conversation>(ANNA, `/api/robots/${other}/conversation`)).body.items.find((item) => item.kind === 'question')
    expect(ask?.kind === 'question' && ask.proposal.kind).toBe('member-file')
    expect((await api<{ content: string }>(ANNA, '/api/me/files/USER.md')).body.content).not.toContain('Likes tea.')
    expect(JSON.stringify(requests.get(other)!.at(-1)!.tools)).not.toContain('memory_write_shared')

    const mr = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await api(ANNA, `/api/robots/${mr}/settings`, { method: 'PATCH', body: { codeMode: false } })
    await turn(mr, 'remember', [{ calls: [{ name: 'memory_write_shared', args: { file: 'USER.md', content: '# USER.md\nLikes coffee.' } }] }, { text: 'Saved.' }])
    expect((await api<{ content: string }>(ANNA, '/api/me/files/USER.md')).body.content).toContain('Likes coffee.')
    await turn(other, 'next', [{ text: 'ok' }])
    expect(JSON.stringify(chatRequests(other).at(-1)!.messages.filter((message) => message.role === 'user').at(-1))).toContain('changed: USER.md by Mr. Robot')
  })

  it('drops the broadest files first and truncates the most specific last (pl-jsdm)', () => {
    const files: MemoryFile[] = [
      { scope: 'robot', path: 'memory/2026-10-07.md', content: 'today '.repeat(100) },
      { scope: 'home', path: 'HOME.md', content: 'home '.repeat(400) },
      { scope: 'member', path: 'USER.md', content: 'user '.repeat(100) },
      { scope: 'robot', path: 'MEMORY.md', content: 'memory '.repeat(100) },
    ]
    const full = renderBaseline(files, 100_000)
    const at = (path: string) => full.indexOf(`path="${path}"`)
    expect(at('HOME.md')).toBeLessThan(at('USER.md'))
    expect(at('USER.md')).toBeLessThan(at('MEMORY.md'))
    expect(at('MEMORY.md')).toBeLessThan(at('memory/2026-10-07.md'))
    const tight = renderBaseline(files, 2000)
    expect(new TextEncoder().encode(tight).length).toBeLessThanOrEqual(2000)
    expect(tight).not.toContain('home home')
    expect(tight).toContain('today today')
    expect(tight).toContain('Memory budget: HOME.md')
    const tighter = renderBaseline(files, 900)
    expect(new TextEncoder().encode(tighter).length).toBeLessThanOrEqual(900)
    expect(tighter).toContain('[truncated]')
  })
})
