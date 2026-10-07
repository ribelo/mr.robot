import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RobotPanel, SettingsCatalog } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { backendLog, browserLog } from './stub-browser.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  backendLog.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

async function browsingRobot(): Promise<string> {
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

describe('browser backends (rb-wgtd, rb-ybt4, rb-bcui, rb-y50l, rb-kank)', () => {
  it('a Robot follows the Home default until it chooses its own; the login carries over to the new backend', async () => {
    const id = await browsingRobot()
    const catalog = (await api<SettingsCatalog>(ANNA, `/api/robots/${id}/catalog`)).body
    expect(catalog.defaultBrowserBackend).toBe('browser-run')
    expect(catalog.browserBackends?.map((option) => [option.id, option.available])).toEqual([['browser-run', true], ['container', false], ['container-vpn', false], ['container-proxy', false]])

    await say(id, 'log in', [
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/login' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'type', index: 1, text: 'right-password' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'click', index: 2 } }] },
      { text: 'Done.' },
    ])
    const saved = (await api<{ browserBackend: string | null }>(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { browserBackend: 'container' } })).body
    expect(saved.browserBackend).toBe('container')
    await say(id, 'check the cart', [{ calls: [{ name: 'browser_open', args: { url: 'https://shop.test/' } }] }, { text: 'Still signed in.' }])
    expect(backendLog).toEqual(['browser-run', 'container'])
    expect(toolResults(id).at(-1)).toContain('Hello, signed-in customer')
  })

  it('counts browser time per backend in usage', async () => {
    const id = await browsingRobot()
    await say(id, 'look', [{ calls: [{ name: 'browser_open', args: { url: 'https://shop.test/' } }] }, { text: 'Seen.' }])
    const usage = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.usage
    expect(usage.browser).toEqual([expect.objectContaining({ backend: 'browser-run' })])
  })

  it('a block page is reported with the backend and not retried', async () => {
    const id = await browsingRobot()
    await say(id, 'open allegro', [
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/blocked' } }] },
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/blocked' } }] },
      { text: 'Blocked.' },
    ])
    const [first, second] = toolResults(id)
    expect(first).toContain('This page blocks your browser (Browser Run)')
    expect(second).toContain('already blocked the Browser Run browser')
  })
})
