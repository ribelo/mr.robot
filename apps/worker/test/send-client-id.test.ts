import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me } from '@mr-robot/protocol'
import { api, settle, stubModels } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

describe('send with a client id (v1.7 ticket 03)', () => {
  it('accepts a repeated send with the same client id once (ap-ceqx)', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    scripts.set(body.id, [{ text: 'Got it.' }, { text: 'Got the other.' }])
    const first = await api<{ wakeup: number }>(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'ping', clientId: 'c-1' } })
    const again = await api<{ wakeup: number }>(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'ping', clientId: 'c-1' } })
    await settle(body.id)
    expect(again.status).toBe(200)
    expect(again.body.wakeup).toBe(first.body.wakeup)
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'ping', clientId: 'c-2' } })
    await settle(body.id)
    const sent = (await api<Conversation>(ANNA, `/api/robots/${body.id}/conversation`)).body.items.filter((item) => item.kind === 'message' && item.sender.kind === 'member')
    expect(sent).toHaveLength(2)
    // The app matches its pending copy by the id the message carries.
    expect(sent.map((item) => (item.kind === 'message' ? item.clientId : undefined))).toEqual(['c-1', 'c-2'])
  })
})

describe('theme setting (v1.7 ticket 01)', () => {
  it('is stored with the Member and defaults to the system (ap-itj1)', async () => {
    expect((await api<Me>(ANNA, '/api/me')).body.theme).toBe('system')
    await api(ANNA, '/api/me', { method: 'PATCH', body: { theme: 'dark' } })
    expect((await api<Me>(ANNA, '/api/me')).body.theme).toBe('dark')
    expect((await api(ANNA, '/api/me', { method: 'PATCH', body: { theme: 'sepia' } })).status).toBe(400)
  })
})
