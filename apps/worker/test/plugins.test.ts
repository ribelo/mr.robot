import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
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

async function robotWith(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [], hosts: [] } } })
  await testRobot(body.id).activateForTest()
  scripts.set(body.id, [{ text: 'ok' }])
  await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'hi' } })
  await settle(body.id)
  return body.id
}

const last = (id: string) => requests.get(id)!.at(-1)!
const names = (id: string) => (last(id).tools ?? []).map((tool) => tool.name)
const system = (id: string) => JSON.stringify(last(id).system ?? last(id).messages.filter((message) => message.role === 'system'))

describe('capabilities as plugins mounted by grant (v1.3 ticket 01, pl-vfxd, pl-rsoy)', () => {
  it('mounts a granted capability with its tools and its prompt rule; an ungranted one has neither', async () => {
    const without = await robotWith([])
    expect(names(without)).not.toContain('browser_open')
    expect(names(without)).not.toContain('login_fill')
    expect(system(without)).not.toContain('request a browser takeover')
    expect(system(without)).not.toContain('call login_fill')

    const withBrowser = await robotWith(['browser', 'secrets'])
    expect(names(withBrowser)).toEqual(expect.arrayContaining(['browser_open', 'browser_request_takeover', 'login_fill']))
    expect(system(withBrowser)).toContain('request a browser takeover')
    expect(system(withBrowser)).toContain('call login_fill')
    expect(await testRobot(withBrowser).toolNames()).toEqual(expect.arrayContaining(['browser_open', 'login_fill']))
  })
})
