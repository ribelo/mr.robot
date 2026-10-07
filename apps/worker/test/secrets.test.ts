import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me, Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import type { Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const PASSWORD = 'hunter2-Very-Secret!'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

async function robotOf(as: string, secrets: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['secrets'], skills: [], recipients: [], secrets } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(as: string, id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(as, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const lastToolResult = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').at(-1)!.content.map((block) => ('text' in block ? block.text : '')).join('')

describe('secrets', () => {
  it('encrypts a secret at rest (robot-vplt)', async () => {
    await api(ANNA, '/api/secrets/allegro', { method: 'PUT', body: { password: PASSWORD, allowRead: true, shared: false } })
    const me = (await api<Me>(ANNA, '/api/me')).body
    const sealed = await (env.MEMBER.getByName(me.id) as unknown as DurableObjectStub<TestMember>).sealedSecretForTest('allegro')
    expect(sealed).toBeDefined()
    expect(sealed).not.toContain(PASSWORD)
    expect(JSON.stringify((await api(ANNA, '/api/secrets')).body)).not.toContain(PASSWORD)
  })

  it('resolves only granted names (robot-0bde)', async () => {
    await api(ANNA, '/api/secrets/allegro', { method: 'PUT', body: { password: PASSWORD, allowRead: true, shared: false } })
    await api(ANNA, '/api/secrets/bank', { method: 'PUT', body: { password: 'other-secret-value', allowRead: true, shared: false } })
    const id = await robotOf(ANNA, ['allegro'])
    await say(ANNA, id, 'log in', [{ calls: [{ name: 'secret_get', args: { name: 'bank' } }] }, { text: 'not allowed' }])
    expect(lastToolResult(id)).toContain('not granted')
    await say(ANNA, id, 'log in', [{ calls: [{ name: 'secret_get', args: { name: 'allegro' } }] }, { text: 'ok' }])
    expect(lastToolResult(id)).toBe(PASSWORD)
  })

  it('masks the value in the Trajectory and the chat (robot-4zi6)', async () => {
    await api(ANNA, '/api/secrets/allegro', { method: 'PUT', body: { password: PASSWORD, allowRead: true, shared: false } })
    const id = await robotOf(ANNA, ['allegro'])
    await say(ANNA, id, 'log in', [
      { calls: [{ name: 'secret_get', args: { name: 'allegro' } }] },
      { text: `Logged in with ${PASSWORD}.` },
    ])
    const trajectory = JSON.stringify((await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body)
    expect(trajectory).not.toContain(PASSWORD)
    expect(trajectory).toContain('[secret:allegro]')
    const chat = JSON.stringify((await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body)
    expect(chat).not.toContain(PASSWORD)
    expect(chat).toContain('Logged in with [secret:allegro].')

    // Revoking the Grant and deleting the secret never brings the value back.
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: ['secrets'], skills: [], recipients: [], secrets: [] } } })
    await api(ANNA, '/api/secrets/allegro', { method: 'DELETE' })
    expect(JSON.stringify((await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body)).not.toContain(PASSWORD)
    expect(JSON.stringify((await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body)).not.toContain(PASSWORD)
  })

  it('keeps plaintext out of later Turns: the model sees the mask after the Turn ends', async () => {
    await api(ANNA, '/api/secrets/allegro', { method: 'PUT', body: { password: PASSWORD, allowRead: true, shared: false } })
    const id = await robotOf(ANNA, ['allegro'])
    await say(ANNA, id, 'log in', [{ calls: [{ name: 'secret_get', args: { name: 'allegro' } }] }, { text: 'Logged in.' }])
    await say(ANNA, id, 'again?', [{ text: 'Yes.' }])
    expect(JSON.stringify(requests.get(id)!.at(-1)!.messages)).not.toContain(PASSWORD)
  })

  it("lets another Member's Robot use a Home-shared secret once granted", async () => {
    await api(ANNA, '/api/secrets/electricity', { method: 'PUT', body: { password: PASSWORD, allowRead: true, shared: true } })
    const bens = await robotOf(BEN, [])
    await say(BEN, bens, 'pay the bill', [{ calls: [{ name: 'secret_get', args: { name: 'electricity' } }] }, { text: 'no' }])
    expect(lastToolResult(bens)).toContain('not granted')
    await api(BEN, `/api/robots/${bens}/settings`, { method: 'PATCH', body: { grants: { tools: ['secrets'], skills: [], recipients: [], secrets: ['electricity'] } } })
    await say(BEN, bens, 'pay the bill', [{ calls: [{ name: 'secret_get', args: { name: 'electricity' } }] }, { text: 'ok' }])
    expect(lastToolResult(bens)).toBe(PASSWORD)
    expect((await api(BEN, '/api/secrets/electricity', { method: 'PUT', body: { password: 'x', allowRead: true, shared: true } })).status).toBe(400)
  })
})
