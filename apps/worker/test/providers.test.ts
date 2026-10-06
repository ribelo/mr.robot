import { env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Me, ProvidersView, RobotSettings } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'
import type { Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const realFetch = globalThis.fetch

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const member = (id: string) => env.MEMBER.getByName(id) as unknown as DurableObjectStub<TestMember>

async function robotOf(as: string): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  return body.id
}

/** Answer the Providers' OAuth endpoints; everything else is real. */
function fakeOAuth(handler: (url: string, body: string) => Response | undefined) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const answer = handler(url, typeof init?.body === 'string' ? init.body : '')
    return answer ?? realFetch(input, init)
  }) as typeof fetch
}

describe('Providers and credentials', () => {
  it('stores API keys encrypted and lets the owner\'s Robots use them (robot-7v9s)', async () => {
    const anna = (await api<Me>(ANNA, '/api/me')).body
    expect((await api(ANNA, '/api/providers/deepseek', { method: 'PUT', body: { key: 'sk-anna-secret-key', shared: false } })).status).toBe(200)
    expect(await member(anna.id).sealedForTest('deepseek')).not.toContain('sk-anna')
    const id = await robotOf(ANNA)
    expect(await testRobot(id).credentialForTest('deepseek')).toEqual({ kind: 'api-key', key: 'sk-anna-secret-key' })
    const view = (await api<ProvidersView>(ANNA, '/api/providers')).body
    expect(view.mine).toEqual([expect.objectContaining({ provider: 'deepseek', kind: 'api-key', shared: false })])
    expect(JSON.stringify(view)).not.toContain('sk-anna')
  })

  it("runs another Member's Robot on a credential shared with the Home (robot-dic7)", async () => {
    await api(ANNA, '/api/providers/deepseek', { method: 'PUT', body: { key: 'sk-anna-secret-key', shared: false } })
    const bens = await robotOf(BEN)
    expect(await testRobot(bens).credentialForTest('deepseek')).toBeNull()
    await api(ANNA, '/api/providers/deepseek', { method: 'PATCH', body: { shared: true } })
    expect(await testRobot(bens).credentialForTest('deepseek')).toEqual({ kind: 'api-key', key: 'sk-anna-secret-key' })
    expect((await api<ProvidersView>(BEN, '/api/providers')).body.shared).toEqual([expect.objectContaining({ provider: 'deepseek', ownerName: 'Anna' })])
    await api(ANNA, '/api/providers/deepseek', { method: 'DELETE' })
    expect(await testRobot(bens).credentialForTest('deepseek')).toBeNull()
  })

  it('applies the Home default model to new Robots (robot-6nkv)', async () => {
    const patched = await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { defaultModel: { provider: 'stub', model: 'house-model', effort: 'low' } } })
    expect(patched.status).toBe(200)
    expect((await api(BEN, '/api/admin/settings', { method: 'PATCH', body: {} })).status).toBe(403)
    const id = await robotOf(BEN)
    const settings: RobotSettings = await env.ROBOT.getByName(id).settings()
    expect(settings.model).toEqual({ provider: 'stub', model: 'house-model', effort: 'low' })
  })

  it('connects a Claude subscription by OAuth and refreshes it without the Member (robot-lzu3)', async () => {
    let refreshes = 0
    fakeOAuth((url, body) => {
      if (!url.startsWith('https://platform.claude.com/v1/oauth/token')) return undefined
      const request = JSON.parse(body) as { grant_type: string; code?: string; refresh_token?: string }
      if (request.grant_type === 'authorization_code' && request.code === 'the-code') {
        return Response.json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 })
      }
      if (request.grant_type === 'refresh_token' && request.refresh_token === 'refresh-1') {
        refreshes += 1
        return Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 })
      }
      return new Response('bad', { status: 400 })
    })
    const start = (await api<{ url: string }>(ANNA, '/api/providers/anthropic/oauth/start', { body: {} })).body
    const state = new URL(start.url).searchParams.get('state')
    const finished = await api<{ connected: boolean }>(ANNA, '/api/providers/anthropic/oauth/finish', {
      body: { pasted: `http://localhost:53692/callback?code=the-code&state=${state}`, shared: false },
    })
    expect(finished.body).toEqual({ connected: true })
    const id = await robotOf(ANNA)
    expect(await testRobot(id).credentialForTest('anthropic')).toEqual({ kind: 'oauth', access: 'access-1' })

    const anna = (await api<Me>(ANNA, '/api/me')).body
    await member(anna.id).expireCredentialsForTest()
    expect(await testRobot(id).credentialForTest('anthropic')).toEqual({ kind: 'oauth', access: 'access-2' })
    expect(await testRobot(id).credentialForTest('anthropic')).toEqual({ kind: 'oauth', access: 'access-2' })
    expect(refreshes).toBe(1)
  })

  it('connects a ChatGPT subscription with the device code flow (robot-lzu3)', async () => {
    let polls = 0
    const jwt = `x.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } }))}.y`
    fakeOAuth((url) => {
      if (url === 'https://auth.openai.com/api/accounts/deviceauth/usercode') return Response.json({ device_auth_id: 'dev-1', user_code: 'ABCD-1234', interval: 5 })
      if (url === 'https://auth.openai.com/api/accounts/deviceauth/token') {
        polls += 1
        return polls === 1 ? new Response('pending', { status: 403 }) : Response.json({ authorization_code: 'auth-code', code_verifier: 'verifier' })
      }
      if (url === 'https://auth.openai.com/oauth/token') return Response.json({ access_token: jwt, refresh_token: 'r', expires_in: 3600 })
      return undefined
    })
    const start = (await api<{ url: string; userCode: string }>(ANNA, '/api/providers/openai/oauth/start', { body: {} })).body
    expect(start).toEqual({ url: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' })
    expect((await api<{ connected: boolean }>(ANNA, '/api/providers/openai/oauth/finish', { body: { shared: true } })).body.connected).toBe(false)
    expect((await api<{ connected: boolean }>(ANNA, '/api/providers/openai/oauth/finish', { body: { shared: true } })).body.connected).toBe(true)
    const bens = await robotOf(BEN)
    expect(await testRobot(bens).credentialForTest('openai')).toEqual({ kind: 'oauth', access: jwt, accountId: 'acct-1' })
  })
})
