import { abortAllDurableObjects, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { browserLog } from './stub-browser.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  browserLog.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

async function shopper(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['browser'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  browserLog.length = 0
  return body.id
}

async function say(id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body

describe('the browser (robot-l9te, robot-t0vc)', () => {
  it('opens, observes, acts and takes screenshots through its tools', async () => {
    const id = await shopper()
    await say(id, 'log in to the shop', [
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/login' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'type', index: 1, text: 'right-password' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'click', index: 2 } }] },
      { calls: [{ name: 'browser_act', args: { action: 'click', index: 9 } }] },
      { calls: [{ name: 'browser_screenshot', args: {} }] },
      { text: 'Logged in.' },
    ])
    const [opened, typed, clicked, stale, shot] = toolResults(id)
    expect(opened).toContain('[1] password "Password"')
    expect(opened).toContain('[2] button "Sign in" {CLICK}')
    expect(typed).toContain('value="••••"')
    expect(clicked).toContain('Hello, signed-in customer')
    expect(stale).toContain('call browser_observe')
    expect(shot).toMatch(/screens\/.+\.png/)
  })

  it('keeps the login across a crash and a new browser session, and closes the browser after each Turn', async () => {
    const id = await shopper()
    await say(id, 'log in', [
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/login' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'type', index: 1, text: 'right-password' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'click', index: 2 } }] },
      { text: 'Done.' },
    ])
    expect(browserLog.at(-1)).toBe('close')
    await abortAllDurableObjects()
    await say(id, 'check the cart', [{ calls: [{ name: 'browser_open', args: { url: 'https://shop.test/' } }] }, { text: 'Still signed in.' }])
    expect(toolResults(id).at(-1)).toContain('Hello, signed-in customer')
    expect(browserLog.filter((entry) => entry === 'open')).toHaveLength(2)
    expect(browserLog.filter((entry) => entry === 'close')).toHaveLength(2)
  })

  it('never clicks the final payment step (robot-ueh0)', async () => {
    const id = await shopper()
    await say(id, 'buy it', [
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/checkout' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'click', index: 1 } }] },
      { calls: [{ name: 'browser_act', args: { action: 'click', index: 2 } }] },
      { text: 'Ready for you to pay.' },
    ])
    const [, other, pay] = toolResults(id)
    expect(other).toContain('Cart: 1 item')
    expect(pay).toContain('looks like the payment or final order step')
    expect(browserLog.filter((entry) => entry === 'act:click')).toHaveLength(1)
  })

  it('updates the screen thumbnail after each screenshot (robot-ksvy)', async () => {
    const id = await shopper()
    expect((await panel(id)).screen).toBeNull()
    await say(id, 'show me', [{ calls: [{ name: 'browser_open', args: { url: 'https://shop.test/' } }] }, { calls: [{ name: 'browser_screenshot', args: {} }] }, { text: 'Here.' }])
    const first = (await panel(id)).screen!
    await say(id, 'again', [{ calls: [{ name: 'browser_open', args: { url: 'https://shop.test/' } }] }, { calls: [{ name: 'browser_screenshot', args: {} }] }, { text: 'Here.' }])
    const second = (await panel(id)).screen!
    expect(second.at).toBeGreaterThan(first.at)
    expect(second.path).not.toBe(first.path)
    const { SELF } = await import('cloudflare:test')
    const image = await SELF.fetch(`https://mr-robot.test${second.url}`, { headers: { 'x-dev-identity': ANNA } })
    expect(image.headers.get('content-type')).toBe('image/png')
  })
})
