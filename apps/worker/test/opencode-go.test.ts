import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Me, OpencodeKeysView, SettingsCatalog } from '@mr-robot/protocol'
import { rotatingFetch, type OpencodeKey, type OpencodePool } from '../src/providers/opencode-go.ts'
import { api } from './api.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

/** An in-memory pool with the Member DO's ordering rules. */
function memoryPool(keys: OpencodeKey[]) {
  const state = { activeId: keys[0]?.id ?? null as string | null, sticky: new Map<string, string>() }
  const pool: OpencodePool = {
    candidates: async (sessionId) => {
      const sticky = sessionId === null ? undefined : state.sticky.get(sessionId)
      const first = keys.findIndex((key) => key.id === (sticky ?? state.activeId))
      return { keys: first < 0 ? keys : [...keys.slice(first), ...keys.slice(0, first)], activeId: state.activeId }
    },
    promote: async (expected, id) => { if (state.activeId === expected) state.activeId = id },
    stick: async (sessionId, id) => { state.sticky.set(sessionId, id) },
  }
  return { pool, state }
}

const limited = () => Response.json({ error: { type: 'MonthlyLimitError', message: 'Monthly limit exceeded' } }, { status: 429 })
const invalid = () => Response.json({ error: { type: 'AuthenticationError', message: 'Invalid API key' } }, { status: 401 })

function upstream(byKey: Record<string, () => Response>) {
  const seen: Array<{ key: string; session: string | null; body: string }> = []
  const fetcher = (async (request: Request) => {
    const key = (request.headers.get('authorization') ?? '').replace('Bearer ', '') || request.headers.get('x-api-key') || ''
    seen.push({ key, session: request.headers.get('x-opencode-session'), body: await request.clone().text() })
    return (byKey[key] ?? (() => Response.json({ ok: true })))()
  }) as unknown as typeof fetch
  return { fetcher, seen }
}

const call = (fetcher: typeof fetch, body: unknown = { model: 'm' }, path = 'chat/completions') =>
  fetcher(`https://opencode.ai/zen/go/v1/${path}`, { method: 'POST', headers: { authorization: 'Bearer pool', 'x-opencode-session': 's-1', 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('OpenCode Go key rotation (ticket 19)', () => {
  it('moves past an exhausted and an invalid key and makes the working one active', async () => {
    const { pool, state } = memoryPool([{ id: 'a', key: 'sk-a' }, { id: 'b', key: 'sk-b' }, { id: 'c', key: 'sk-c' }])
    const { fetcher, seen } = upstream({ 'sk-a': limited, 'sk-b': invalid })
    const response = await call(rotatingFetch(pool, fetcher))
    expect(response.ok).toBe(true)
    expect(seen.map((entry) => entry.key)).toEqual(['sk-a', 'sk-b', 'sk-c'])
    expect(seen.every((entry) => entry.session === 's-1')).toBe(true)
    expect(state.activeId).toBe('c')
  })

  it('keeps a key the person chose meanwhile', async () => {
    const { pool, state } = memoryPool([{ id: 'a', key: 'sk-a' }, { id: 'b', key: 'sk-b' }])
    const { fetcher } = upstream({ 'sk-a': () => { state.activeId = 'manual'; return limited() } })
    await call(rotatingFetch(pool, fetcher))
    expect(state.activeId).toBe('manual')
  })

  it('sticks a session to the key that last worked for it', async () => {
    const { pool, state } = memoryPool([{ id: 'a', key: 'sk-a' }, { id: 'b', key: 'sk-b' }])
    state.sticky.set('s-1', 'b')
    const { fetcher, seen } = upstream({})
    await call(rotatingFetch(pool, fetcher))
    expect(seen[0]!.key).toBe('sk-b')
  })

  it('passes through ordinary errors without rotating', async () => {
    const { pool, state } = memoryPool([{ id: 'a', key: 'sk-a' }, { id: 'b', key: 'sk-b' }])
    const { fetcher, seen } = upstream({ 'sk-a': () => Response.json({ error: { message: 'bad request' } }, { status: 400 }) })
    expect((await call(rotatingFetch(pool, fetcher))).status).toBe(400)
    expect(seen).toHaveLength(1)
    expect(state.activeId).toBe('a')
  })

  it('retries Responses input without reasoning issued to another key', async () => {
    const { pool } = memoryPool([{ id: 'a', key: 'sk-a' }])
    let first = true
    const { fetcher, seen } = upstream({ 'sk-a': () => {
      if (!first) return Response.json({ ok: true })
      first = false
      return Response.json({ error: { message: 'The encrypted_content for item rs_1 was not issued to this caller' } }, { status: 400 })
    } })
    const body = { input: [{ type: 'reasoning', encrypted_content: 'xyz' }, { type: 'message', role: 'user', content: 'hi' }] }
    expect((await call(rotatingFetch(pool, fetcher), body, 'responses')).ok).toBe(true)
    expect(seen[1]!.body).not.toContain('encrypted_content')
    expect(seen[1]!.body).toContain('"hi"')
  })
})

describe('OpenCode Go in the Home', () => {
  beforeEach(async () => {
    await reset()
    await api(ANNA, '/api/me')
    await api(ANNA, '/api/admin/members', { body: { email: BEN } })
    await api(BEN, '/api/me')
  })
  afterEach(() => undefined)

  it('lists every OpenCode Go model for the Robot settings once a key is connected', async () => {
    await api(ANNA, '/api/providers/opencode-go/keys', { body: { key: 'sk-firstkey1111' } })
    const { body: robot } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    const catalog = (await api<SettingsCatalog>(ANNA, `/api/robots/${robot.id}/catalog`)).body
    const models = catalog.models.filter((model) => model.provider === 'opencode-go').map((model) => model.model)
    expect(models).toEqual(expect.arrayContaining(['deepseek-v4-flash', 'glm-5.3', 'kimi-k3', 'minimax-m3', 'gpt-5.6-luna']))
    expect(models.length).toBeGreaterThanOrEqual(30)
  })

  it('keeps keys encrypted and masked; add, activate, remove; share with the Home', async () => {
    const add = (key: string) => api<OpencodeKeysView>(ANNA, '/api/providers/opencode-go/keys', { body: { key } })
    expect((await add('Bearer sk-x')).status).toBe(400)
    await add('sk-firstkey1111')
    const view = (await add('oc_sk_second2222')).body
    expect(view.keys.map((key) => key.masked)).toEqual(['••••1111', '••••2222'])
    expect(view.activeId).toBe(view.keys[0]!.id)
    expect(JSON.stringify(view)).not.toContain('firstkey')
    const activated = (await api<OpencodeKeysView>(ANNA, `/api/providers/opencode-go/keys/${view.keys[1]!.id}/activate`, { body: {} })).body
    expect(activated.activeId).toBe(view.keys[1]!.id)
    const removed = (await api<OpencodeKeysView>(ANNA, `/api/providers/opencode-go/keys/${view.keys[1]!.id}`, { method: 'DELETE' })).body
    expect(removed.keys).toHaveLength(1)
    expect(removed.activeId).toBe(view.keys[0]!.id)

    const { env } = await import('cloudflare:test')
    const annaId = (await api<Me>(ANNA, '/api/me')).body.id
    const benId = (await api<Me>(BEN, '/api/me')).body.id
    expect(await env.HOME.getByName('home').opencodePoolOwner(benId)).toBeNull()
    await api(ANNA, '/api/providers/opencode-go', { method: 'PATCH', body: { shared: true } })
    expect(await env.HOME.getByName('home').opencodePoolOwner(benId)).toEqual({ ownerId: annaId, forHome: true })
    const candidates = await env.MEMBER.getByName(annaId).opencodeCandidates(null, true)
    expect(candidates.keys.map((key) => key.key)).toEqual(['sk-firstkey1111'])
  })
})
