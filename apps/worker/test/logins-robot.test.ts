import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, LoginView, Me, Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import type { Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const PASSWORD = 'right-password'

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
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['secrets', 'browser'], skills: [], recipients: [], secrets } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(as: string, id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(as, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe('login entries (v1.1 ticket 05)', () => {
  it('fills a granted login on its own site only, and the password appears nowhere (rb-e1ic, rb-1dzv)', async () => {
    await api(ANNA, '/api/secrets/shop', { method: 'PUT', body: { username: 'anna', password: PASSWORD, websites: ['https://shop.test'], shared: false } })
    await api(ANNA, '/api/secrets/bank', { method: 'PUT', body: { username: 'anna', password: 'bank-password-1', websites: ['https://bank.test'], shared: false } })
    const id = await robotOf(ANNA, ['shop'])
    await say(ANNA, id, 'log in', [
      { calls: [{ name: 'login_list', args: {} }] },
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/login' } }] },
      { calls: [{ name: 'login_list', args: {} }] },
      { calls: [{ name: 'login_fill', args: { name: 'shop' } }] },
      { calls: [{ name: 'browser_act', args: { action: 'click', index: 2 } }] },
      { calls: [{ name: 'secret_get', args: { name: 'shop' } }] },
      { calls: [{ name: 'browser_open', args: { url: 'https://other.test/login' } }] },
      { calls: [{ name: 'login_fill', args: { name: 'shop' } }] },
      { text: 'Logged in.' },
    ])
    const [before, , onPage, fill, signedIn, read, , elsewhere] = toolResults(id)
    expect(before).toContain('"matchesPage": false')
    expect(before).not.toContain('bank')
    expect(onPage).toContain('"matchesPage": true')
    expect(fill).toContain('Filled the password of "shop"')
    expect(signedIn).toContain('Hello, signed-in customer')
    expect(read).toContain('website login: use login_fill')
    expect(elsewhere).toContain('belongs to https://shop.test, not to https://other.test/login')
    const trajectory = JSON.stringify((await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body)
    const chat = JSON.stringify((await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body)
    expect(trajectory).not.toContain(PASSWORD)
    expect(chat).not.toContain(PASSWORD)
    expect(JSON.stringify(requests.get(id))).not.toContain(PASSWORD)
  })

  it("lets another Member's Robot fill a Home entry once granted (rb-ob2g)", async () => {
    await api(ANNA, '/api/secrets/shop', { method: 'PUT', body: { username: 'home', password: PASSWORD, websites: ['shop.test'], shared: true } })
    const bens = await robotOf(BEN, ['shop'])
    await say(BEN, bens, 'log in', [
      { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/login' } }] },
      { calls: [{ name: 'login_fill', args: { name: 'shop' } }] },
      { text: 'Done.' },
    ])
    expect(toolResults(bens)[1]).toContain('Filled')
  })

  it('keeps a secret stored before entries, readable and granted (rb-36g4); the list shows which Robots hold each', async () => {
    const me = (await api<Me>(ANNA, '/api/me')).body
    await (env.MEMBER.getByName(me.id) as unknown as DurableObjectStub<TestMember>).setSecret('apikey', 'legacy-value-123')
    const id = await robotOf(ANNA, ['apikey'])
    const list = (await api<LoginView[]>(ANNA, '/api/secrets')).body
    expect(list).toEqual([expect.objectContaining({ name: 'apikey', username: '', websites: [], allowRead: true, robots: ['New robot'] })])
    await say(ANNA, id, 'read it', [{ calls: [{ name: 'secret_get', args: { name: 'apikey' } }] }, { text: 'ok' }])
    expect(toolResults(id)[0]).toBe('legacy-value-123')
    // Editing keeps the password when it is not resent.
    await api(ANNA, '/api/secrets/apikey', { method: 'PUT', body: { notes: 'for the weather API', shared: false } })
    expect((await api<{ password: string }>(ANNA, '/api/secrets/apikey/reveal')).body.password).toBe('legacy-value-123')
  })
})
