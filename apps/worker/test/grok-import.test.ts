/**
 * Import a Grok Bot template as a brief (v1.18 ticket 07, rm-pdgk, rm-ewhv, rm-zutf), against a saved page: the object found, the
 * mapping, the label, a broken page refused. No network: fetch answers with the fixture.
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Result from 'effect/Result'
import type { DefinitionView } from '@mr-robot/protocol'
import { parseGrants, parseTasks } from '../src/definitions/definition.ts'
import { untar } from '../src/skills/library.ts'
import { SELF } from 'cloudflare:test'
import { api, stubModels } from './api.ts'
import PAGE from './fixtures/grok-overheard.html?raw'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const realFetch = globalThis.fetch
let served = PAGE
let userAgent: string | null = null

beforeEach(async () => {
  await reset()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
  served = PAGE
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://x.ai/bot/marketplace/bots/overheard') {
      userAgent = new Headers(init?.headers).get('user-agent')
      return new Response(served, { headers: { 'content-type': 'text/html' } })
    }
    return realFetch(input, init)
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const files = async (as: string, slug: string) => {
  const response = await SELF.fetch(`https://mr-robot.test/api/definitions/${slug}/archive`, { headers: { 'x-dev-identity': as } })
  const all = await untar(await response.arrayBuffer())
  return (path: string) => new TextDecoder().decode(all.get(`robots/${slug}/${path}`))
}

describe('importing a Grok Bot template (rm-pdgk, rm-ewhv)', () => {
  it('finds the object, maps it to a brief with the label and the source, for the importer only', async () => {
    const imported = await api<DefinitionView>(BEN, '/api/definitions/import', { body: { url: 'https://x.ai/bot/marketplace/bots/overheard' } })
    expect(imported.status, JSON.stringify(imported.body)).toBe(200)
    expect(userAgent).toContain('Mozilla/5.0')
    expect(imported.body).toMatchObject({ slug: 'grok-overheard', title: 'Overheard', source: 'import', author: 'Lenny Rachitsky (Grok Bot, imported)', published: false, mine: true })
    // Not published: the Space admin sees it to publish it (v1.20.1); another Member would not.
    expect((await api<DefinitionView[]>(ANNA, '/api/definitions')).body.map((row) => [row.slug, row.published])).toEqual([['grok-overheard', false]])

    const read = await files(BEN, 'grok-overheard')
    expect(read('README.md')).toContain('Imported summary; Grok Bot keeps the recipe closed. Source: https://x.ai/bot/marketplace/bots/overheard')
    expect(read('README.md')).toContain('Watches Reddit, Hacker News, news sites, and X')
    expect(read('SOUL.md')).toContain('never posts on your behalf')
    expect(read('MEMORY.md')).toContain('## Facts\n- One job: find real third-party mentions')
    expect(read('MEMORY.md')).toContain('- Default sources ON: Reddit, Hacker News, news, and X.')
    expect(read('skills/overheard/SKILL.md')).toContain('description: "Core instructions on every turn: voice, first-run interview, day-two starter menu, sources, digests, anti-jobs."')
    const tasks = Result.getOrThrow(parseTasks(read('tasks.yaml')))
    expect(tasks.tasks).toEqual([{ title: 'Daily mention monitor', instructions: expect.stringContaining('Paused weekday-morning mention sweep.'), timing: { kind: 'unscheduled' }, enabled: false }])
    const grants = Result.getOrThrow(parseGrants(read('grants.yaml')))
    expect(grants.connectors).toEqual([{ kind: 'slack', write: false, level: 'ask' }])
    expect(grants.notes).toEqual(['X: no Connector in Mr. Robot (Search posts and read accounts on X. Optional, improves X coverage over web search.)'])
  })

  it('refuses a page without the object, or with a key missing, and an address that is not a marketplace page (rm-zutf)', async () => {
    served = PAGE.replace(',\\"updatedAt\\":\\"2026-09-04T22:21:40.855Z\\"', '')
    const missing = await api<{ error: string }>(BEN, '/api/definitions/import', { body: { url: 'https://x.ai/bot/marketplace/bots/overheard' } })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain('lacks updatedAt')
    served = '<html><body>Bot Marketplace</body></html>'
    expect((await api<{ error: string }>(BEN, '/api/definitions/import', { body: { url: 'https://x.ai/bot/marketplace/bots/overheard' } })).body.error).toContain('no Next.js flight data')
    expect((await api<{ error: string }>(BEN, '/api/definitions/import', { body: { url: 'https://example.com/bots/overheard' } })).body.error).toContain('Grok Bot marketplace page')
    expect((await api<DefinitionView[]>(BEN, '/api/definitions')).body).toEqual([])
  })
})
