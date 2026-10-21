/**
 * The Space's Workers AI switch (v1.12 ticket 04): off, Workers AI leaves every model list, the
 * Space default moves off it, and model chains skip it, block on it and resume when it is on again.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AdminView, Conversation, SpaceSettingsSaved, SpaceSettingsView, ModelOption, ProvidersView, SettingsCatalog } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scriptedProviders, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const realFetch = globalThis.fetch
const KIMI: ModelOption = { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6', contextWindow: 128_000 }
const KIMI_CHOICE = { provider: KIMI.provider, model: KIMI.model, effort: 'off' } as const

beforeEach(async () => {
  await reset()
  scripts.clear()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://openrouter.ai/api/v1/models') return Response.json({ data: [{ id: 'z/model-a', name: 'Z: Model A', context_length: 100000, supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } }] })
    if (url === 'https://models.dev/api.json') return Response.json({})
    return realFetch(input, init)
  }) as typeof fetch
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
  // The Workers AI binding does not exist in tests: its model comes from the admin's list.
  await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { models: [KIMI] } })
})

afterEach(() => {
  globalThis.fetch = realFetch
  scriptedProviders.delete('workers-ai')
})

const switchWorkersAi = (enabled: boolean) => api<SpaceSettingsSaved>(ANNA, '/api/admin/settings', { method: 'PATCH', body: { workersAiEnabled: enabled } })
const hasKimi = (models: readonly ModelOption[]) => models.some((option) => option.provider === 'workers-ai')
const notices = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))
const lastReply = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.filter((item) => item.kind === 'reply').at(-1)
const blockNotices = async (id: string) => (await notices(id)).filter((text) => text.startsWith('Every model in the chain is unavailable'))

async function robotOf(as: string): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  return body.id
}

describe('the Workers AI switch (ux-101w, ux-xsnr)', () => {
  it('is on by default; off, Workers AI leaves the Providers view, the settings catalogue and the Space settings models', async () => {
    const id = await robotOf(BEN)
    const providers = (await api<ProvidersView>(BEN, '/api/providers')).body
    expect(providers.workersAiEnabled).toBe(true)
    expect(hasKimi(providers.models)).toBe(true)
    expect(hasKimi((await api<SettingsCatalog>(BEN, `/api/robots/${id}/catalog`)).body.models)).toBe(true)
    expect(hasKimi((await api<SpaceSettingsView>(ANNA, '/api/admin/settings')).body.models)).toBe(true)

    const saved = await switchWorkersAi(false)
    expect(saved.status).toBe(200)
    expect(saved.body.workersAiEnabled).toBe(false)
    expect(hasKimi(saved.body.models)).toBe(false)

    const off = (await api<ProvidersView>(BEN, '/api/providers')).body
    expect(off.workersAiEnabled).toBe(false)
    expect(hasKimi(off.models)).toBe(false)
    const catalog = (await api<SettingsCatalog>(BEN, `/api/robots/${id}/catalog`)).body
    expect(catalog.workersAiEnabled).toBe(false)
    expect(hasKimi(catalog.models)).toBe(false)
    expect(hasKimi(catalog.unavailableModels ?? [])).toBe(false)
    expect(hasKimi((await api<SpaceSettingsView>(ANNA, '/api/admin/settings')).body.models)).toBe(false)
    const admin = (await api<AdminView>(ANNA, '/api/admin')).body
    expect(admin.settings.workersAiEnabled).toBe(false)
    expect(hasKimi(admin.settings.models)).toBe(false)
    // Nobody can pick it while it is off.
    expect((await api(BEN, `/api/robots/${id}/settings`, { method: 'PATCH', body: { model: KIMI_CHOICE } })).status).toBe(400)

    await switchWorkersAi(true)
    expect(hasKimi((await api<ProvidersView>(BEN, '/api/providers')).body.models)).toBe(true)
  })
})

describe('the Space default model when Workers AI goes off (ux-jseo)', () => {
  it('stays when the admin can use no other model, and moves to the first usable model when one exists', async () => {
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { defaultModel: KIMI_CHOICE } })
    const kept = await switchWorkersAi(false)
    expect(kept.body.defaultModelMoved).toBeUndefined()
    expect(kept.body.defaultModel).toEqual(KIMI_CHOICE)

    await switchWorkersAi(true)
    await api(ANNA, '/api/providers/openrouter/accounts', { body: { key: 'sk-or-anna', shared: false } })
    const moved = await switchWorkersAi(false)
    const to = { provider: 'openrouter', model: 'z/model-a', effort: 'off' }
    expect(moved.body.defaultModelMoved).toEqual({ from: KIMI_CHOICE, to })
    expect(moved.body.defaultModel).toEqual(to)
    expect((await api<ProvidersView>(BEN, '/api/providers')).body.defaultModel).toEqual(to)
  })
})

describe('model chains while Workers AI is off (ux-zh1l, ux-mz3h)', () => {
  it('skips a Workers AI entry with the reason, blocks when nothing is left, and resumes when it is on again', async () => {
    const id = await robotOf(ANNA)
    await testRobot(id).activateForTest()
    const workersAi = { account: 'workers-ai', owner: '', ...KIMI_CHOICE }
    expect((await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { chain: [workersAi, { account: '', owner: '', provider: 'stub', model: 'stub', effort: 'off' }] } })).status).toBe(200)
    await switchWorkersAi(false)

    scripts.set(id, [{ text: 'From the fallback.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'hi' } })
    await settle(id)
    expect(await lastReply(id)).toMatchObject({ text: 'From the fallback.' })
    expect(await notices(id)).toContain('Switched to stub on stub: Workers AI is disabled by the admin.')

    // Only Workers AI is left: the Robot blocks with the reason.
    expect((await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { chain: [workersAi] } })).status).toBe(200)
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'still there?' } })
    await settle(id)
    expect(await blockNotices(id)).toEqual(['Every model in the chain is unavailable (Workers AI is disabled by the admin). New robot continues after the admin switches Workers AI on again, or sooner when you add another entry.'])
    expect(await lastReply(id)).toMatchObject({ text: 'From the fallback.' })

    // The alarm looks again while it is still off: nothing runs and the notice is not repeated.
    expect(await testRobot(id).resumeChainDueForTest()).toBeGreaterThan(Date.now())
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await blockNotices(id)).toHaveLength(1)
    expect(await lastReply(id)).toMatchObject({ text: 'From the fallback.' })

    // The admin switches it on: the next look continues the work on Workers AI.
    await switchWorkersAi(true)
    scriptedProviders.add('workers-ai')
    scripts.set(id, [{ text: 'Back on Workers AI.' }])
    await testRobot(id).resumeChainDueForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await lastReply(id)).toMatchObject({ text: 'Back on Workers AI.' })
  })
})
