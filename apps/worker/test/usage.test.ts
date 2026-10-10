import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AccountUsage, Me, ProviderView, ProvidersView } from '@mr-robot/protocol'
import { api, stubModels } from './api.ts'
import { connectorFixtures } from './connector-fixtures.ts'
import type { Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  connectorFixtures.reset()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

const member = (id: string) => env.MEMBER.getByName(id) as unknown as DurableObjectStub<TestMember>
const mine = async (as: string) => (await api<ProvidersView>(as, '/api/providers')).body.mine
const usage = (as: string, account: ProviderView) => api<AccountUsage>(as, `/api/accounts/${account.id}/usage?owner=${account.ownerId}`)
const calls = (url: string) => connectorFixtures.calls.filter((call) => call.url === url).length

describe('Account usage and checks (v1.10 tickets 04, 05)', () => {
  it('shows Claude windows, cached a minute, to the owner and to Members it is shared with (pa-lmbl, pa-7d50, pa-sstr)', async () => {
    const anna = (await api<Me>(ANNA, '/api/me')).body
    await member(anna.id).seedLegacyForTest('anthropic', 'oauth', { access: 'access-1', refresh: 'refresh-1', expires: Date.now() + 3_600_000 }, false)
    connectorFixtures.on('GET', 'https://api.anthropic.com/api/oauth/usage', (call: { headers: Record<string, string> }) => (call.headers['authorization'] === 'Bearer access-1' && call.headers['anthropic-beta'] === 'oauth-2025-04-20' ? {
      five_hour: { utilization: 6.0, resets_at: '2026-10-10T18:59:59Z' },
      seven_day: { utilization: 35.4, resets_at: '2026-10-14T16:59:59Z' },
      seven_day_opus: { utilization: 12, resets_at: '2026-10-14T17:59:59Z' },
      extra: null,
    } : new Response('no', { status: 401 })))
    const [claude] = await mine(ANNA)
    const first = (await usage(ANNA, claude!)).body
    expect(first.windows).toEqual([
      { name: 'Current session', percent: 6, resetsAt: '2026-10-10T18:59:59Z' },
      { name: 'This week', percent: 35, resetsAt: '2026-10-14T16:59:59Z' },
      { name: 'Opus this week', percent: 12, resetsAt: '2026-10-14T17:59:59Z' },
    ])
    await usage(ANNA, claude!)
    expect(calls('https://api.anthropic.com/api/oauth/usage')).toBe(1)

    expect((await usage(BEN, claude!)).status).toBe(404)
    await api(ANNA, `/api/accounts/${claude!.id}`, { method: 'PATCH', body: { shared: true } })
    expect((await usage(BEN, claude!)).body.windows).toHaveLength(3)
    expect(JSON.stringify((await api<ProvidersView>(BEN, '/api/providers')).body.shared)).not.toContain('access-1')
  })

  it('shows OpenCode Go windows and no bars for Providers without a usage endpoint (pa-sps4, pa-afb9)', async () => {
    await api(ANNA, '/api/providers/opencode-go/accounts', { body: { key: 'sk-opencode1111', shared: false } })
    await api(ANNA, '/api/providers/deepseek/accounts', { body: { key: 'sk-deepseek-key', shared: false } })
    connectorFixtures.on('GET', 'https://opencode.ai/zen/go/v1/usage', { usage: {
      rolling: { status: 'ok', percent: 0, resetsAt: '2026-10-10T15:00:00.000Z' },
      weekly: { status: 'ok', percent: 3, resetsAt: '2026-10-12T00:00:00.000Z' },
      monthly: { status: 'ok', percent: 65, resetsAt: '2026-10-21T00:00:00.000Z' },
    } })
    const [opencode, deepseek] = await mine(ANNA)
    expect((await usage(ANNA, opencode!)).body.windows).toEqual([
      { name: 'Rolling (5 hours)', percent: 0, resetsAt: '2026-10-10T15:00:00.000Z' },
      { name: 'This week', percent: 3, resetsAt: '2026-10-12T00:00:00.000Z' },
      { name: 'This month', percent: 65, resetsAt: '2026-10-21T00:00:00.000Z' },
    ])
    expect((await usage(ANNA, deepseek!)).body.windows).toBeNull()
    expect(connectorFixtures.calls.filter((call) => call.url.includes('deepseek'))).toEqual([])
  })

  it('checks an account at once and sets its state from the answer (pa-hq0v)', async () => {
    await api(ANNA, '/api/providers/deepseek/accounts', { body: { key: 'sk-deepseek-key', shared: false } })
    const [account] = await mine(ANNA)
    connectorFixtures.on('GET', 'https://api.deepseek.com/user/balance', { is_available: false })
    await api(ANNA, `/api/accounts/${account!.id}/check`, { body: {} })
    expect((await mine(ANNA))[0]).toMatchObject({ status: 'broken', note: 'no balance left' })
    connectorFixtures.on('GET', 'https://api.deepseek.com/user/balance', { is_available: true })
    await api(ANNA, `/api/accounts/${account!.id}/check`, { body: {} })
    expect((await mine(ANNA))[0]).toMatchObject({ status: 'ok', note: null, until: null })
  })
})
