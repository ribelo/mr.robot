import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotPanel, RobotSummary } from '@mr-robot/protocol'
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

const mrRobotId = async () => (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe("Mr. Robot's rights (v1.1 ticket 10)", () => {
  it('uses any tool and any login its owner has without grants (rb-b0rs)', async () => {
    await api(ANNA, '/api/secrets/shop', { method: 'PUT', body: { username: 'anna', password: 'right-password', websites: ['shop.test'], shared: false } })
    const id = await mrRobotId()
    await settle(id)
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.grants.secrets).toEqual([])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
    scripts.set(id, [
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/login' } }] },
      { calls: [{ name: 'login_fill', args: { name: 'shop' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'click', index: 2 } }] },
      { text: 'Signed in.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'sign in to the shop' } })
    await settle(id)
    const [opened, filled, signedIn] = toolResults(id)
    expect(opened).toContain('Shop: sign in')
    expect(filled).toContain('Filled')
    expect(signedIn).toContain('Hello, signed-in customer')
  })

  it("only asks for another Robot's grants; nothing is granted until the owner approves (rb-598m)", async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const other = (await api<{ id: string }>(ANNA, '/api/robots', { body: {} })).body.id
    await settle(other)
    await testRobot(other).activateForTest()
    const id = await mrRobotId()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
    scripts.set(id, [{ calls: [{ name: 'robot_propose_grants', args: { robot_id: other, purpose: 'it needs to search the web', tools: ['web'] } }] }, { text: 'Asked.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'give the new robot web access' } })
    await settle(id)
    expect(toolResults(id)[0]).toContain('nothing is granted until they approve')
    expect((await api<RobotPanel>(ANNA, `/api/robots/${other}/panel`)).body.settings.grants.tools).not.toContain('web')
    const ask = (await api<Conversation>(ANNA, `/api/robots/${other}/conversation`)).body.items.find((item) => item.kind === 'question' && item.proposal.status === 'open')
    expect(ask?.kind === 'question' ? ask.proposal.purpose : '').toBe('Mr. Robot asks: it needs to search the web')
  })

  it('starts with the default compaction instruction (rb-yagl)', async () => {
    const id = await mrRobotId()
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.compactionInstruction).toMatch(/^Keep, in this order: \(1\) every open commitment/)
  })
})
