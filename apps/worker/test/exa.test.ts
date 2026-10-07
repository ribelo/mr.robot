import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RobotPanel, SettingsCatalog } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const realFetch = globalThis.fetch
const exaCalls: Array<{ path: string; key: string | null; body: unknown }> = []

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  exaCalls.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'api.exa.ai') return realFetch(input, init)
    exaCalls.push({ path: url.pathname, key: new Headers(init?.headers).get('x-api-key'), body: init?.body === undefined ? null : JSON.parse(String(init.body)) })
    return Response.json({ requestId: 'r', results: [{ title: 'Containers pricing', url: 'https://developers.cloudflare.com/containers/pricing/', text: 'Billed per 10 ms.' }], costDollars: { total: 0.007 } })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

async function robotWith(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const lastTools = (id: string) => (requests.get(id)!.at(-1)!.tools ?? []).map((definition: { name: string }) => definition.name)
const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe('Exa (v1.1 ticket 11)', () => {
  it('searches with the Home key and counts the call and its cost (rb-cfvy, rb-x8i3, rb-pb26)', async () => {
    await api(ANNA, '/api/admin/exa', { method: 'PUT', body: { key: 'exa-test-key' } })
    const id = await robotWith(['exa'])
    scripts.set(id, [{ calls: [{ name: 'web_search_exa', args: { query: 'cloudflare containers pricing', numResults: 3 } }] }, { text: 'Found it.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'research' } })
    await settle(id)
    expect(exaCalls[0]).toMatchObject({ path: '/search', key: 'exa-test-key', body: { query: 'cloudflare containers pricing', numResults: 3 } })
    expect(toolResults(id)[0]).toContain('developers.cloudflare.com/containers/pricing')
    expect(lastTools(id)).toEqual(expect.arrayContaining(['web_search_exa', 'crawling_exa', 'get_code_context_exa']))
    // Agent runs are a separate grant (rb-a0x0).
    expect(lastTools(id)).not.toContain('exa_agent_create_run')
    const usage = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.usage
    expect(usage.services).toEqual([{ service: 'exa', calls: 1, costUsd: 0.007 }])
    expect(usage.costUsd).toBeGreaterThanOrEqual(0.007)
  })

  it('explains that the admin must add a key when there is none', async () => {
    const id = await robotWith(['exa', 'exa-agent'])
    const catalog = (await api<SettingsCatalog>(ANNA, `/api/robots/${id}/catalog`)).body
    expect(catalog.toolGroups.find((group) => group.name === 'exa')?.description).toContain('the Home admin adds it under Admin → Exa')
    scripts.set(id, [{ calls: [{ name: 'exa_agent_list_runs', args: {} }] }, { text: 'No key.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'list runs' } })
    await settle(id)
    expect(toolResults(id)[0]).toContain('the Home admin must add an Exa API key')
    expect(exaCalls).toEqual([])
  })
})
