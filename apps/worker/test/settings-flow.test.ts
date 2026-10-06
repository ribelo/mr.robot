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
  it('starts a new Robot on a model its owner can use when the Home default is not connected', async () => {
    await env.HOME.getByName('home').updateSettings({ defaultModel: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } })
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${body.id}/panel`)).body
    expect(panel.settings.model.provider).toBe('workers-ai')
  })

  it('offers "Try again" after a failed Turn and runs the same wake-up once fixed', async () => {
    await stubModels()
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).activateForTest()
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } } })
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
    await api(ANNA, '/api/secrets/bank', { method: 'PUT', body: { value: 'very-secret-pin-123', shared: false } })
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['web', 'secrets'], skills: [], recipients: [], secrets: ['bank'] } } })
    await testRobot(body.id).activateForTest()
    const preview = (await api<{ sections: Array<{ name: string; text: string }>; tools: string[] }>(ANNA, `/api/robots/${body.id}/prompt`)).body
    expect(preview.sections.map((section) => section.name)).toEqual(['Platform', 'Persona and memory files'])
    expect(preview.sections[1]!.text).toContain('SOUL.md')
    expect(preview.tools).toContain('secret_get')
    expect(JSON.stringify(preview)).not.toContain('very-secret-pin-123')
  })
})
