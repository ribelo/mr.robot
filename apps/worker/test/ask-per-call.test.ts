import { reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, ProposalView, Trajectory } from '@mr-robot/protocol'
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

/** An active Robot holding files at ask (sk-hx8j). */
async function askingRobot(codeMode: boolean): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode, grants: { tools: { files: 'ask' } } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

async function asks(id: string): Promise<ProposalView[]> {
  const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
  return conversation.items.flatMap((item) => (item.kind === 'proposal' && item.proposal.kind === 'tool-call' ? [item.proposal] : []))
}

async function answer(id: string, ask: ProposalView, approve: boolean, note?: string) {
  return api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, approve, ...(note === undefined ? {} : { note }) } })
}

/** A Workspace file's text, or null when there is none. */
async function file(id: string, path: string): Promise<string | null> {
  const response = await SELF.fetch(`https://mr-robot.test/api/robots/${id}/raw?path=${encodeURIComponent(path)}`, { headers: { 'x-dev-identity': ANNA } })
  return response.status === 404 ? (await response.body?.cancel(), null) : response.text()
}

const lastRequestText = (id: string) => JSON.stringify(requests.get(id)!.at(-1)!.messages)
const write = (content: string) => ({ name: 'write', args: { on: 'workspace', file_path: 'notes/a.md', content, reason: 'Keep the shopping list' } })

describe('ask per call (sk-hx8j, sk-ed7r, sk-c1vz, sk-fx6q)', () => {
  it('stores an Ask for an ask-level call, does not run the tool, and waits for the owner', async () => {
    const id = await askingRobot(false)
    await say(id, 'save the list', [{ calls: [write('milk')] }, { text: 'Waiting for your answer.' }])
    const schema = requests.get(id)!.at(-1)!.tools?.find((tool) => tool.name === 'write')
    expect(schema?.parameters).toMatchObject({ required: expect.arrayContaining(['reason']) })
    const [ask] = await asks(id)
    expect(ask).toMatchObject({ kind: 'tool-call', status: 'open', toolCall: { tool: 'write', reason: 'Keep the shopping list', note: null } })
    expect(ask!.toolCall!.arguments).toEqual([{ name: 'on', value: 'workspace' }, { name: 'file_path', value: 'notes/a.md' }, { name: 'content', value: 'milk' }, { name: 'reason', value: 'Keep the shopping list' }])
    expect(lastRequestText(id)).toContain('waiting for your owner')
    expect(await file(id, 'notes/a.md')).toBeNull()
    expect((await robots(ANNA)).find((robot) => robot.id === id)?.fleetState).toBe('waiting for you')
  })

  it('runs the stored call once on approval and wakes the Robot with its result; a second approval is refused', async () => {
    const id = await askingRobot(false)
    await say(id, 'save the list', [{ calls: [write('milk')] }, { text: 'Waiting.' }])
    const [ask] = await asks(id)
    // The woken Robot tries the tool again: nothing was remembered, so that call asks again (sk-fx6q).
    scripts.set(id, [{ calls: [write('milk, eggs')] }, { text: 'Saved; one more change waits for you.' }])
    expect((await answer(id, ask!, true)).status).toBe(200)
    await settle(id)
    expect(await file(id, 'notes/a.md')).toBe('milk')
    const woken = JSON.stringify(requests.get(id)!.at(-2)!.messages)
    expect(woken).toContain(`[Your owner approved write (${ask!.id})]`)
    expect((await answer(id, ask!, true)).status).toBe(409)
    const open = (await asks(id)).filter((item) => item.status === 'open')
    expect(open).toHaveLength(1)
    expect(open[0]!.toolCall!.arguments).toContainEqual({ name: 'content', value: 'milk, eggs' })
  })

  it('wakes the Robot with the owner\'s reason on rejection and never runs the call', async () => {
    const id = await askingRobot(false)
    await say(id, 'save the list', [{ calls: [write('milk')] }, { text: 'Waiting.' }])
    const [ask] = await asks(id)
    scripts.set(id, [{ text: 'Understood.' }])
    expect((await answer(id, ask!, false, 'Not now')).status).toBe(200)
    await settle(id)
    expect(lastRequestText(id)).toContain(`[Your owner rejected write (${ask!.id}): Not now]`)
    expect(await file(id, 'notes/a.md')).toBeNull()
    expect((await asks(id))[0]).toMatchObject({ status: 'rejected', toolCall: { note: 'Not now' } })
  })

  it('gives a code-mode program the waiting result; approval runs the call without running the program again', async () => {
    const id = await askingRobot(true)
    const program = "const saved = await tools.write({ on: 'workspace', file_path: 'notes/a.md', content: 'milk', reason: 'Keep the shopping list' })\nreturn saved"
    await say(id, 'save the list', [{ calls: [{ name: 'run_code', args: { code: program, description: 'save' } }] }, { text: 'Waiting.' }])
    const result = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body.events.find((event) => event.type === 'tool/result')!
    expect(result.data).toContain('waiting for your owner')
    const [ask] = await asks(id)
    expect(ask?.toolCall?.tool).toBe('write')
    expect(await file(id, 'notes/a.md')).toBeNull()
    scripts.set(id, [{ text: 'Saved.' }])
    await answer(id, ask!, true)
    await settle(id)
    expect(await file(id, 'notes/a.md')).toBe('milk')
    expect(lastRequestText(id)).toContain(`[Your owner approved write (${ask!.id})]`)
    const calls = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body.events.filter((event) => event.type === 'tool/call').map((event) => JSON.parse(event.data).name)
    expect(calls).toEqual(['run_code'])
  })

  it('lets the Turn of a Task end waiting and resumes the work on the answer', async () => {
    const id = await askingRobot(false)
    scripts.set(id, [{ calls: [write('report')] }, { text: 'Waiting for my owner.' }])
    await testRobot(id).wake({ kind: 'task', sender: { kind: 'task', taskId: 'rt-1', name: 'Night' }, text: 'Write the report.' })
    await settle(id)
    expect((await robots(ANNA)).find((robot) => robot.id === id)?.fleetState).toBe('waiting for you')
    const [ask] = await asks(id)
    scripts.set(id, [{ text: 'Report written.' }])
    await answer(id, ask!, true)
    await settle(id)
    expect(await file(id, 'notes/a.md')).toBe('report')
    expect(lastRequestText(id)).toContain(`[Your owner approved write (${ask!.id})]`)
    expect((await robots(ANNA)).find((robot) => robot.id === id)?.fleetState).not.toBe('waiting for you')
  })
})