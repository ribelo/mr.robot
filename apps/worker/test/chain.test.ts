import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainEntry, Me, ProvidersView, RobotSettings } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

async function robotOf(as: string): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  return body.id
}

const addKey = async (as: string, provider: string, key: string, shared = false) => (await api<{ id: string }>(as, `/api/providers/${provider}/accounts`, { body: { key, shared } })).body.id
const settingsOf = (id: string): Promise<RobotSettings> => env.ROBOT.getByName(id).settings()

describe('Model chain (v1.10 ticket 03)', () => {
  it('gives a Robot made before chains one entry on its model, bound to the account it first uses (pa-u06u, pa-l3l9)', async () => {
    const first = await addKey(ANNA, 'deepseek', 'sk-anna-first-key')
    await addKey(ANNA, 'deepseek', 'sk-anna-second-key')
    const id = await robotOf(ANNA)
    const anna = (await api<Me>(ANNA, '/api/me')).body
    expect((await settingsOf(id)).chain).toHaveLength(1)
    // An entry stored before accounts existed has no account until its first use.
    expect((await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'off' }] } })).status).toBe(200)
    const before = await settingsOf(id)
    expect(before.chain).toEqual([{ account: '', owner: '', ...before.model }])
    expect(await testRobot(id).credentialForTest('deepseek')).toMatchObject({ key: 'sk-anna-first-key' })
    await settle(id)
    expect((await settingsOf(id)).chain).toEqual([{ account: first, owner: anna.id, ...before.model }])
  })

  it('runs on the account its chain names, refuses an account it may not use, and shows who uses an account (pa-mho0, pa-f59m)', async () => {
    await addKey(ANNA, 'deepseek', 'sk-anna-first-key')
    const second = await addKey(ANNA, 'deepseek', 'sk-anna-second-key')
    const bens = await addKey(BEN, 'deepseek', 'sk-ben-private-key')
    const anna = (await api<Me>(ANNA, '/api/me')).body
    const ben = (await api<Me>(BEN, '/api/me')).body
    const id = await robotOf(ANNA)
    const { model } = await settingsOf(id)
    const entry = (account: string, owner: string): ChainEntry => ({ account, owner, provider: 'deepseek', model: 'deepseek-flash', effort: model.effort })
    const refused = await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { chain: [entry(bens, ben.id)] } })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(refused.body)).toContain('not yours or shared')
    expect((await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { chain: [entry(second, anna.id), { account: 'workers-ai', owner: '', provider: 'workers-ai', model: 'any', effort: 'off' }] } })).status).toBe(200)
    expect(await testRobot(id).credentialForTest('deepseek')).toMatchObject({ key: 'sk-anna-second-key' })
    const settings = await settingsOf(id)
    expect(settings.model).toEqual({ provider: 'deepseek', model: 'deepseek-flash', effort: model.effort })
    await settle(id)
    const mine = (await api<ProvidersView>(ANNA, '/api/providers')).body.mine
    expect(mine.find((account) => account.id === second)?.usedBy).toEqual([expect.objectContaining({ robotId: id, ownerName: 'Anna' })])

    // Ben's account becomes usable for Anna's Robots once Ben shares it.
    await api(BEN, `/api/accounts/${bens}`, { method: 'PATCH', body: { shared: true } })
    expect((await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { chain: [entry(bens, ben.id)] } })).status).toBe(200)
    expect(await testRobot(id).credentialForTest('deepseek')).toMatchObject({ key: 'sk-ben-private-key' })
    await api(BEN, `/api/accounts/${bens}`, { method: 'PATCH', body: { shared: false } })
    expect(await testRobot(id).credentialForTest('deepseek')).toBeNull()
  })
})
