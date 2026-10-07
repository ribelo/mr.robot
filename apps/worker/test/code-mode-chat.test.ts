import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

describe('the chat in code mode (the default)', () => {
  it('shows Routine cards, reactions and Grant questions made inside a program', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: true, grants: { tools: ['routines'], skills: [], recipients: [], secrets: [] } } })
    await testRobot(body.id).activateForTest()
    const program = [
      "await tools.react({ emoji: '👍' })",
      "await tools.schedule_create({ title: 'Invoice check', prompt: 'Check invoices.', daily: { time: '09:00:00', time_zone: 'Europe/Warsaw' } })",
      "return await tools.propose_grants({ purpose: 'Read the web for prices', tools: ['web'] })",
    ].join('\n')
    scripts.set(body.id, [{ calls: [{ name: 'run_code', args: { code: program, description: 'Set things up' } }] }, { text: 'Done.' }])
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'set it up' } })
    await settle(body.id)
    const items = (await api<Conversation>(ANNA, `/api/robots/${body.id}/conversation`)).body.items
    expect(items.find((item) => item.kind === 'message')).toMatchObject({ reaction: '👍' })
    expect(items.find((item) => item.kind === 'routine')).toMatchObject({ action: 'created', name: 'Invoice check' })
    expect(items.find((item) => item.kind === 'question')).toMatchObject({ proposal: { kind: 'grants', purpose: 'Read the web for prices' } })
    // One collapsed line for the program and the tools it called (react is shown as the 👍 instead).
    expect(items.find((item) => item.kind === 'activity')).toMatchObject({ tools: ['code', 'schedule_create', 'propose_grants'] })
  })

  it('runs a program sent as one function expression (gpt-oss writes "async()=>{...}")', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: true, grants: { tools: [], skills: [], recipients: [], secrets: [] } } })
    await testRobot(body.id).activateForTest()
    scripts.set(body.id, [{ calls: [{ name: 'run_code', args: { code: "async()=>{return 'ran'}", description: 'x' } }] }, { text: 'Done.' }])
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'go' } })
    await settle(body.id)
    const sent = JSON.stringify((requests.get(body.id) ?? []).at(-1)!.messages.at(-1))
    expect(sent).toContain('ran')
  })
})
