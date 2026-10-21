/**
 * Home became Space (v1.18 ticket 09, rm-en62, rm-lseo, rm-sina): HOME.md's stored text is SPACE.md, the routes and the words say Space,
 * and a Conversation written before reads as it did.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import type { Space } from './worker.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

describe('Home becomes Space (rm-lseo, rm-en62)', () => {
  it('moves HOME.md to SPACE.md, which every Robot reads under the new name; the routes carry the word', async () => {
    await (env.SPACE.getByName('space') as unknown as DurableObjectStub<Space>).legacyHomeMemoryForTest('# HOME.md\nElectricity: Tauron.')
    expect((await api<{ content: string }>(ANNA, '/api/space-memory')).body.content).toBe('# HOME.md\nElectricity: Tauron.')
    expect((await api(ANNA, '/api/home-memory')).status).toBe(404)
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).activateForTest()
    scripts.set(body.id, [{ say: 'Hi.' }])
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'hi' } })
    await settle(body.id)
    const context = JSON.stringify(requests.get(body.id)!.at(-1)!.messages)
    expect(context).toContain('path=\\"SPACE.md\\"')
    expect(context).toContain('Electricity: Tauron.')
    expect(context).not.toContain('path=\\"HOME.md\\"')
    const system = JSON.stringify(requests.get(body.id)!.at(-1)!.messages.filter((message) => message.role === 'system'))
    expect(system).toContain('Space')
    expect(system).not.toMatch(/\bHome\b/)
    const me = (await api<Me>(ANNA, '/api/me')).body
    expect(me.role).toBe('admin')
    expect((await api(ANNA, '/api/admin/space-memory', { method: 'PUT', body: { content: '# SPACE.md\nGas: PGNiG.' } })).status).toBe(200)
    expect((await api<{ content: string }>(ANNA, '/api/space-memory')).body.content).toBe('# SPACE.md\nGas: PGNiG.')
  })
})

describe('the stored values say space (v1.18 ticket 09)', () => {
  it('moves the object named home to space at the first touch, with its values renamed; the old object stops', async () => {
    await reset()
    await (env.SPACE.getByName('home') as unknown as DurableObjectStub<Space>).seedLegacyHomeForTest()
    await env.MEMBER.getByName('m-anna').init({ id: 'm-anna', email: 'anna@example.com', name: 'Anna' })
    const me = await api<Me>(ANNA, '/api/me')
    expect(me.body).toMatchObject({ id: 'm-anna', role: 'admin', space: 'Test Space' })
    expect((await api<{ content: string }>(ANNA, '/api/space-memory')).body.content).toBe('# HOME.md\nWater: MPWiK.')
    const skills = (await api<{ skills: Array<{ name: string; source: string; visibility: string }> }>(ANNA, '/api/skills')).body.skills
    expect(skills.find((skill) => skill.name === 'filing')).toMatchObject({ source: 'space', visibility: 'space' })
    expect(await (env.SPACE.getByName('home') as unknown as DurableObjectStub<Space>).movedForTest()).toBe(true)
  })

  it('migrates a Robot\'s stored sharing and spend limit, and takes a client\'s old value for one release', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).legacySpaceValuesForTest()
    const panel = (await api<{ settings: { sharing: string; spendLimit: { kind: string } } }>(ANNA, `/api/robots/${body.id}/panel`)).body
    expect(panel.settings).toMatchObject({ sharing: 'space', spendLimit: { kind: 'space' } })
    expect((await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { sharing: 'private' } })).status).toBe(200)
    // A PWA from before v1.18 still sends 'home'.
    const patched = await api<{ sharing: string }>(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { sharing: 'home', spendLimit: { kind: 'home' } } })
    expect(patched.status, JSON.stringify(patched.body)).toBe(200)
    expect((await api<{ settings: { sharing: string } }>(ANNA, `/api/robots/${body.id}/panel`)).body.settings.sharing).toBe('space')
  })
})
