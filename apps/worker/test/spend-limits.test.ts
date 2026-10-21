/**
 * Spend limits as types (v1.12 ticket 05): the Space's limits are no limit or an amount, a Robot's is the
 * Space's, no limit or an amount; the numbers stored before migrate; the spend check, the Admin table and
 * the Robot's settings resolve the same limit in effect.
 */
import { env, reset, runInDurableObject } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { effectiveSpendLimit, spendLimitText, type AdminView, type Conversation, type EffectiveSpendLimit, type SpaceSettingsView, type Me, type RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'
import type { Space as TestSpace } from './worker.ts'

const ANNA = 'anna@example.com'
/** A dollar per token: one Turn spends more than the smallest limit. */
const DEAR_STUB = { provider: 'stub', model: 'stub', label: 'Stub', contextWindow: 128000, price: { input: 1_000_000, output: 1_000_000 } }

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

const space = () => env.SPACE.getByName('space') as unknown as DurableObjectStub<TestSpace>
const spaceSettings = async () => (await api<SpaceSettingsView>(ANNA, '/api/admin/settings')).body
const patchSpace = (body: unknown) => api(ANNA, '/api/admin/settings', { method: 'PATCH', body })
const patchRobot = (id: string, body: unknown) => api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body })
const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body

async function robotOf(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await patchRobot(body.id, { codeMode: false })
  await testRobot(body.id).activateForTest()
  return body.id
}

/** The limit in effect as each view shows it: the settings, the Robot's usage and the Admin fleet row. */
async function shown(id: string): Promise<{ settings: EffectiveSpendLimit; usage: EffectiveSpendLimit; admin: EffectiveSpendLimit }> {
  const { settings, usage } = await panel(id)
  const admin = (await api<AdminView>(ANNA, '/api/admin')).body.fleet.find((row) => row.id === id)!.usage.limit
  return { settings: effectiveSpendLimit(settings.spendLimit, settings.spaceSpendLimit), usage: usage.limit, admin }
}

const status = async (id: string) => (await panel(id)).summary.status
const notices = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))

describe('typed spend limits (ux-dbx4, ux-q8ve, ux-ommv)', () => {
  it('Space limits are no limit by default and take only no limit or a whole amount of at least 1 USD', async () => {
    expect(await spaceSettings()).toMatchObject({ robotSpendLimit: { kind: 'none' }, memberSpendLimit: { kind: 'none' } })
    expect((await patchSpace({ robotSpendLimit: { kind: 'usd', amount: 20 }, memberSpendLimit: { kind: 'none' } })).status).toBe(200)
    expect(await spaceSettings()).toMatchObject({ robotSpendLimit: { kind: 'usd', amount: 20 }, memberSpendLimit: { kind: 'none' } })
    for (const refused of [null, 0, { kind: 'usd', amount: 0 }, { kind: 'usd', amount: 2.5 }, { kind: 'usd' }, { kind: 'space' }]) {
      expect((await patchSpace({ robotSpendLimit: refused })).status).toBe(400)
    }
    expect((await spaceSettings()).robotSpendLimit).toEqual({ kind: 'usd', amount: 20 })
  })

  it("a Robot's limit is the Space's until changed, and takes the Space's, no limit or a whole amount", async () => {
    const id = await robotOf()
    expect((await panel(id)).settings).toMatchObject({ spendLimit: { kind: 'space' }, spaceSpendLimit: { kind: 'none' } })
    for (const accepted of [{ kind: 'usd', amount: 50 }, { kind: 'none' }, { kind: 'space' }]) {
      expect((await patchRobot(id, { spendLimit: accepted })).status).toBe(200)
      expect((await panel(id)).settings.spendLimit).toEqual(accepted)
    }
    for (const refused of [null, 0, { kind: 'usd', amount: 0 }, { kind: 'usd', amount: 1.5 }]) {
      expect((await patchRobot(id, { spendLimit: refused })).status).toBe(400)
    }
  })

  it('migrates the stored numbers once: for the Space null and 0 are no limit; for a Robot null is the Space\'s and 0 is no limit', async () => {
    await space().legacySpendLimitsForTest(null, 0)
    expect(await spaceSettings()).toMatchObject({ robotSpendLimit: { kind: 'none' }, memberSpendLimit: { kind: 'none' } })
    await space().legacySpendLimitsForTest(12, 7.5)
    expect(await spaceSettings()).toMatchObject({ robotSpendLimit: { kind: 'usd', amount: 12 }, memberSpendLimit: { kind: 'usd', amount: 8 } })
    const left = await runInDurableObject(env.SPACE.getByName('space'), async (_home, state) => state.storage.sql.exec("SELECT k FROM setting WHERE k LIKE '%SpendLimitUsd'").toArray())
    expect(left).toEqual([])

    const id = await robotOf()
    for (const [stored, typed] of [[null, { kind: 'space' }], [0, { kind: 'none' }], [50, { kind: 'usd', amount: 50 }]] as const) {
      await testRobot(id).legacySpendLimitForTest(stored)
      expect((await panel(id)).settings.spendLimit).toEqual(typed)
      const config = await testRobot(id).storedConfigForTest()
      expect(config).not.toHaveProperty('spendLimitUsd')
      expect(config['spendLimit']).toEqual(typed)
    }
  })
})

describe('the limit in effect (ux-en86)', () => {
  it('the spend check, the Admin table and the settings resolve the same limit', async () => {
    await patchSpace({ models: [DEAR_STUB], robotSpendLimit: { kind: 'usd', amount: 1 } })
    const id = await robotOf()
    const home1 = { limit: { kind: 'usd', amount: 1 }, from: 'space' } as const
    expect(await shown(id)).toEqual({ settings: home1, usage: home1, admin: home1 })
    expect(spendLimitText(home1)).toBe('$1 (Space)')

    // One Turn spends more than the Space's dollar: the check stops the Robot on the same limit.
    scripts.set(id, [{ text: 'Done.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    expect(await status(id)).toBe('blocked')
    expect((await notices(id)).some((text) => text.startsWith('This Robot reached its monthly spend limit') && text.includes('of $1.00)'))).toBe(true)

    // No limit of its own: the check lets it go on, and every view says so.
    await patchRobot(id, { spendLimit: { kind: 'none' } })
    const none = { limit: { kind: 'none' }, from: 'robot' } as const
    expect(await shown(id)).toEqual({ settings: none, usage: none, admin: none })
    expect(spendLimitText(none)).toBe('no limit')
    expect(await status(id)).toBe('active')

    // An amount of its own below what it spent: stopped again.
    await patchRobot(id, { spendLimit: { kind: 'usd', amount: 2 } })
    const own = { limit: { kind: 'usd', amount: 2 }, from: 'robot' } as const
    expect(await shown(id)).toEqual({ settings: own, usage: own, admin: own })
    expect(spendLimitText(own)).toBe('$2')
    expect(await status(id)).toBe('blocked')

    // Back to the Space's, still a dollar: blocked; the Space lifts its limit: the Robot goes on.
    await patchRobot(id, { spendLimit: { kind: 'space' } })
    expect(await status(id)).toBe('blocked')
    await patchSpace({ robotSpendLimit: { kind: 'none' } })
    const spaceNone = { limit: { kind: 'none' }, from: 'space' } as const
    expect(await shown(id)).toEqual({ settings: spaceNone, usage: spaceNone, admin: spaceNone })
    expect(await status(id)).toBe('active')
  })

  it("the Member limit is the Space's in the Admin members table and in the spend check", async () => {
    await patchSpace({ models: [DEAR_STUB], memberSpendLimit: { kind: 'usd', amount: 3 } })
    const me = (await api<Me>(ANNA, '/api/me')).body
    const memberRow = async () => (await api<AdminView>(ANNA, '/api/admin')).body.members.find((row) => row.id === me.id)!
    expect((await memberRow()).usage.limit).toEqual({ limit: { kind: 'usd', amount: 3 }, from: 'space' })
    const id = await robotOf()
    scripts.set(id, [{ text: 'Done.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    expect(await status(id)).toBe('blocked')
    expect((await notices(id)).some((text) => text.startsWith('Your Robots reached your monthly spend limit') && text.includes('of $3.00)'))).toBe(true)
    await patchSpace({ memberSpendLimit: { kind: 'none' } })
    expect((await memberRow()).usage.limit).toEqual({ limit: { kind: 'none' }, from: 'space' })
    expect(await status(id)).toBe('active')
  })
})
