/**
 * The model chain at work (v1.10 ticket 04): real OpenRouter adapter, only its HTTP answers faked
 * per account key.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me, ProvidersView, RobotSettings } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'
import type { Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const realFetch = globalThis.fetch
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
const reply = (text: string) => new Response(sse({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })

/** What each OpenRouter key answers now, and how many model calls were made. */
const byKey = new Map<string, () => Response>()
let modelCalls = 0

beforeEach(async () => {
  await reset()
  scripts.clear()
  byKey.clear()
  await stubModels()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (request.url === 'https://openrouter.ai/api/v1/models') return Response.json({ data: [{ id: 'z/model-a', name: 'Z: Model A', context_length: 100000, supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } }] })
    if (request.url === 'https://openrouter.ai/api/v1/chat/completions') {
      modelCalls += 1
      const key = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
      return (byKey.get(key) ?? (() => new Response('unknown key', { status: 401 })))()
    }
    return realFetch(input, init)
  }) as typeof fetch
  await api(ANNA, '/api/me')
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const member = (id: string) => env.MEMBER.getByName(id) as unknown as DurableObjectStub<TestMember>
const notices = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))
const lastReply = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.filter((item) => item.kind === 'reply').at(-1)

async function chainRobot(): Promise<{ id: string; first: string; second: string; anna: Me }> {
  const anna = (await api<Me>(ANNA, '/api/me')).body
  const first = (await api<{ id: string }>(ANNA, '/api/providers/openrouter/accounts', { body: { key: 'sk-or-first', shared: false, label: 'First' } })).body.id
  const second = (await api<{ id: string }>(ANNA, '/api/providers/openrouter/accounts', { body: { key: 'sk-or-second', shared: false, label: 'Second' } })).body.id
  scripts.set('*', [{ say: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await testRobot(body.id).activateForTest()
  const entry = (account: string) => ({ account, owner: anna.id, provider: 'openrouter', model: 'z/model-a', effort: 'off' })
  expect((await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { chain: [entry(first), entry(second)] } })).status).toBe(200)
  return { id: body.id, first, second, anna }
}

describe('Model chain walking (v1.10 ticket 04)', () => {
  it('moves to the next entry on a limit, continues, and goes back after the reset (pa-kvsr, pa-q0dg, pa-14yx, pa-gqff)', async () => {
    const { id, first, anna } = await chainRobot()
    byKey.set('sk-or-first', () => new Response('{"error":{"message":"limit reached"}}', { status: 429, headers: { 'retry-after': '3600' } }))
    byKey.set('sk-or-second', () => reply('From the second account.'))
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'hi' } })
    await settle(id)
    expect(await lastReply(id)).toMatchObject({ text: 'From the second account.' })
    expect(await notices(id)).toEqual(expect.arrayContaining([expect.stringMatching(/^Switched to z\/model-a on Second: First hit its limit\.$/)]))
    const limited = (await api<ProvidersView>(ANNA, '/api/providers')).body.mine.find((account) => account.id === first)!
    expect(limited.status).toBe('limited')
    expect(limited.until! - Date.now()).toBeGreaterThan(3_500_000)
    expect(((await env.ROBOT.getByName(id).settings()) as RobotSettings).model.model).toBe('z/model-a')

    // The reset passed: the next Turn goes back to the first account and clears its state.
    await member(anna.id).expireAccountStatesForTest()
    byKey.set('sk-or-first', () => reply('Back on the first.'))
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'again' } })
    await settle(id)
    expect(await lastReply(id)).toMatchObject({ text: 'Back on the first.' })
    expect(await notices(id)).toEqual(expect.arrayContaining(['Back to z/model-a on First: it works again.']))
    expect((await api<ProvidersView>(ANNA, '/api/providers')).body.mine.find((account) => account.id === first)!.status).toBe('ok')
  })

  it('marks a broken account, tells its owner once, and blocks when every entry is unusable (pa-bc78, pa-dus3)', async () => {
    const { id, first, second, anna } = await chainRobot()
    byKey.set('sk-or-first', () => new Response('{"error":{"message":"subscription cancelled"}}', { status: 402 }))
    byKey.set('sk-or-second', () => new Response('{"error":{"message":"invalid key"}}', { status: 401 }))
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'hi' } })
    await settle(id)
    const accounts = (await api<ProvidersView>(ANNA, '/api/providers')).body.mine
    expect(accounts.find((account) => account.id === first)).toMatchObject({ status: 'broken' })
    expect(accounts.find((account) => account.id === second)).toMatchObject({ status: 'broken' })
    expect(accounts.find((account) => account.id === first)!.until! - Date.now()).toBeGreaterThan(5 * 3_600_000)
    const told = (await member(anna.id).deliveredForTest()).filter((push) => push.body.includes('stopped working'))
    expect(told.map((push) => push.body)).toEqual([expect.stringContaining('"First" stopped working'), expect.stringContaining('"Second" stopped working')])
    expect(await notices(id)).toEqual(expect.arrayContaining([expect.stringContaining('Every model in the chain is unavailable')]))

    // A new message waits for the reset instead of failing again.
    const calls = modelCalls
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'still there?' } })
    await settle(id)
    expect(modelCalls).toBe(calls)
    expect(await lastReply(id)).toMatchObject({ text: 'Hello.' })

    // The earliest reset comes: the alarm continues the work on the first usable entry.
    expect(await testRobot(id).resumeChainDueForTest()).toBeGreaterThan(Date.now())
    await member(anna.id).expireAccountStatesForTest()
    byKey.set('sk-or-first', () => reply('Working again.'))
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await lastReply(id)).toMatchObject({ text: 'Working again.' })
  })
})
