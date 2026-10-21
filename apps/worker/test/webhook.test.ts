import { reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, WebhookView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { fakeOutbox } from './fake-channel.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  fakeOutbox.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

async function activeRobot(channels: string[] = ['pwa']): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, notifications: { enabled: true, members: [], channels } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

/** A webhook request as an outside system sends it: no Access sign-in, only the key. */
const hook = (path: string, init: { body?: string; type?: string; idempotencyKey?: string; method?: string } = {}) => SELF.fetch(`https://mr-robot.test${path}`, {
  method: init.method ?? 'POST',
  headers: { ...(init.type === undefined ? {} : { 'content-type': init.type }), ...(init.idempotencyKey === undefined ? {} : { 'idempotency-key': init.idempotencyKey }) },
  body: init.body ?? '{}',
})

// The whole Conversation: the PWA's page holds the newest 50 items (v1.19).
const webhookMessages = async (id: string) => (await testRobot(id).conversationView()).items.filter((item) => item.kind === 'message' && item.sender.kind === 'channel')

describe('webhook Channel (v1.6 ticket 07)', () => {
  it('shows the owner an address and key, and Regenerate replaces the key at once (cd-pqt8)', async () => {
    const id = await activeRobot()
    const first = (await api<WebhookView>(ANNA, `/api/robots/${id}/webhook`)).body
    expect(first.path).toBe(`/hooks/${id}/${first.key}`)
    expect((await api<WebhookView>(ANNA, `/api/robots/${id}/webhook`)).body).toEqual(first)
    expect((await api(BEN, `/api/robots/${id}/webhook`)).status).toBe(404)

    const second = (await api<WebhookView>(ANNA, `/api/robots/${id}/webhook/regenerate`, { body: {} })).body
    expect(second.key).not.toBe(first.key)
    expect((await hook(first.path)).status).toBe(401)
    scripts.set(id, [{ text: 'Seen.' }])
    expect((await hook(second.path)).status).toBe(202)
    await settle(id)
  })

  it('wakes the Robot once per Idempotency-Key, quoting the body and its content type (cd-q7mc)', async () => {
    const id = await activeRobot()
    const { path } = (await api<WebhookView>(ANNA, `/api/robots/${id}/webhook`)).body
    scripts.set(id, [{ text: 'Noted the deploy.' }])
    const body = JSON.stringify({ event: 'deploy', ref: 'main' })
    expect((await hook(path, { body, type: 'application/json', idempotencyKey: 'evt-1' })).status).toBe(202)
    expect((await hook(path, { body, type: 'application/json', idempotencyKey: 'evt-1' })).status).toBe(202)
    await settle(id)
    expect(await webhookMessages(id)).toHaveLength(1)
    const wake = JSON.stringify(requests.get(id)!.at(-1))
    expect(wake).toContain('application/json')
    expect(wake).toContain('deploy')

    // Without a key every request wakes the Robot.
    scripts.set(id, [{ text: 'One.' }, { text: 'Two.' }])
    await hook(path, { body: 'plain text', type: 'text/plain' })
    await settle(id)
    await hook(path, { body: 'plain text', type: 'text/plain' })
    await settle(id)
    expect(await webhookMessages(id)).toHaveLength(3)
  })

  it('answers a wrong key with 401 and a body over 64 KB with 413, and wakes nobody (cd-s07d)', async () => {
    const id = await activeRobot()
    const { path, key } = (await api<WebhookView>(ANNA, `/api/robots/${id}/webhook`)).body
    expect((await hook(`/hooks/${id}/not-${key}`)).status).toBe(401)
    expect((await hook(`/hooks/no-such-robot/${key}`)).status).toBe(401)
    expect((await hook(path, { body: 'x'.repeat(70 * 1024) })).status).toBe(413)
    expect((await hook(path, { body: 'x'.repeat(64 * 1024) })).status).toBe(202)
    await settle(id)
    expect(await webhookMessages(id)).toHaveLength(1)
  })

  it('remembers the last 100 Idempotency-Keys: an older key wakes the Robot again, a recent one does not (cd-q7mc)', async () => {
    const id = await activeRobot()
    const { path } = (await api<WebhookView>(ANNA, `/api/robots/${id}/webhook`)).body
    scripts.set(id, Array.from({ length: 110 }, () => ({ text: 'Noted.' })))
    for (let index = 0; index <= 100; index += 1) expect((await hook(path, { body: 'tick', type: 'text/plain', idempotencyKey: `evt-${index}` })).status).toBe(202)
    await settle(id)
    expect(await webhookMessages(id)).toHaveLength(101)
    // evt-0 fell out of the last 100; evt-100 is the newest.
    await hook(path, { body: 'tick', type: 'text/plain', idempotencyKey: 'evt-100' })
    await hook(path, { body: 'tick', type: 'text/plain', idempotencyKey: 'evt-0' })
    await settle(id)
    expect(await webhookMessages(id)).toHaveLength(102)
    // 102 Turns in a row: slow when the whole suite shares the machine.
  }, 90_000)

  it('refuses an Idempotency-Key longer than 200 characters with 400 and wakes nobody', async () => {
    const id = await activeRobot()
    const { path } = (await api<WebhookView>(ANNA, `/api/robots/${id}/webhook`)).body
    expect((await hook(path, { body: 'x', idempotencyKey: 'k'.repeat(201) })).status).toBe(400)
    scripts.set(id, [{ text: 'Seen.' }])
    expect((await hook(path, { body: 'x', idempotencyKey: 'k'.repeat(200) })).status).toBe(202)
    await settle(id)
    expect(await webhookMessages(id)).toHaveLength(1)
  })

  it('answers like the Turn of a Task: in the app, and to the Channels the Robot hears everything on (cd-pqt8)', async () => {
    const id = await activeRobot(['pwa', 'fake'])
    const { path } = (await api<WebhookView>(ANNA, `/api/robots/${id}/webhook`)).body
    fakeOutbox.length = 0
    scripts.set(id, [{ say: 'Handled it.' }])
    await hook(path, { body: 'ping', type: 'text/plain' })
    await settle(id)
    expect(fakeOutbox.filter((output) => output.kind === 'reply')).toEqual([expect.objectContaining({ text: 'Handled it.', route: null, unprompted: true })])
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items.some((item) => item.kind === 'reply' && item.text === 'Handled it.')).toBe(true)
  })
})
