import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await api(ANNA, '/api/me')
})

describe('configuring a Robot', () => {
  it('never creates a Robot on a model without a credential: refuses with nothing connected, else picks a connected one (robot-mx6s)', async () => {
    await env.HOME.getByName('home').updateSettings({ defaultModel: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } })
    const refused = await api<{ error: string }>(ANNA, '/api/robots', { body: {} })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toContain('Providers')

    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url === 'https://openrouter.ai/api/v1/models') return Response.json({ data: [{ id: 'z/model-a', name: 'Z: Model A', context_length: 100000, supported_parameters: ['tools'], pricing: { prompt: '0.000001', completion: '0.000002' } }] })
      if (url === 'https://models.dev/api.json') return Response.json({})
      return realFetch(input, init)
    }) as typeof fetch
    await api(ANNA, '/api/providers/openrouter', { method: 'PUT', body: { key: 'sk-or-test', shared: false } })
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${body.id}/panel`)).body
    expect(panel.settings.model).toMatchObject({ provider: 'openrouter', model: 'z/model-a' })
    globalThis.fetch = realFetch
  })

  it('offers "Try again" after a failed Turn and runs the same wake-up once fixed', async () => {
    await stubModels()
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).activateForTest()
    const refused = await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } } })
    expect(refused.status).toBe(400)
    // A key removed after the choice: the Robot is on a model it can no longer reach.
    await env.ROBOT.getByName(body.id).updateSettings({ model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } })
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'find me a flat' } })
    await settle(body.id)
    let chat = (await api<Conversation>(ANNA, `/api/robots/${body.id}/conversation`)).body
    expect(chat.canRetry).toBe(true)
    expect((chat.items.at(-1) as { text: string }).text).toContain('Providers')

    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { model: { provider: 'stub', model: 'stub', effort: 'off' } } })
    scripts.set(body.id, [{ text: 'On it.' }])
    await api(ANNA, `/api/robots/${body.id}/retry`, { body: {} })
    await settle(body.id)
    chat = (await api<Conversation>(ANNA, `/api/robots/${body.id}/conversation`)).body
    expect(chat.canRetry).toBe(false)
    expect(chat.items.at(-1)).toMatchObject({ kind: 'reply', text: 'On it.' })
  })

  it('shows the prompt, tools and skills the model gets, without secret values', async () => {
    await stubModels()
    scripts.set('*', [{ text: 'Hello.' }])
    await api(ANNA, '/api/secrets/bank', { method: 'PUT', body: { password: 'very-secret-pin-123', allowRead: true, shared: false } })
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['web', 'secrets'], skills: [], recipients: [], secrets: ['bank'] } } })
    await testRobot(body.id).activateForTest()
    const preview = (await api<{ sections: Array<{ name: string; text: string }>; tools: string[] }>(ANNA, `/api/robots/${body.id}/prompt`)).body
    expect(preview.sections.map((section) => section.name)).toEqual(['Platform', 'Memory (first message of the context)'])
    expect(preview.sections[1]!.text).toContain('SOUL.md')
    expect(preview.tools).toContain('secret_get')
    expect(JSON.stringify(preview)).not.toContain('very-secret-pin-123')
  })
})
