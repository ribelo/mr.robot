/**
 * Identity after setup (v1.15 ticket 11, gb-vipe, gb-4563): set_identity stays mounted for an active Robot with title,
 * description and avatar colour; the name stays the owner's.
 */
import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function activeRobot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, identity: { name: 'Flat Watcher', title: 'Housing', description: 'Watches apartment prices.', avatarColor: '#3b82f6' } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

const results = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe('set_identity after setup', () => {
  it('changes title, description and avatar colour, and the panel shows them (gb-vipe)', async () => {
    const id = await activeRobot()
    scripts.set(id, [
      { calls: [{ name: 'set_identity', args: { title: 'Flat hunter', description: 'Watches Otodom and tells me about new flats.', avatar_color: '#10b981' } }] },
      { text: 'I changed my title, description and colour.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'You are more than a watcher now.' } })
    await settle(id)
    expect(requests.get(id)![0]!.tools!.map((tool) => tool.name)).toContain('set_identity')
    const result = JSON.parse(results(id)[0]!) as { identity: Record<string, string>; changed: string[] }
    expect(result.changed).toEqual(['title', 'description', 'avatarColor'])
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.settings.identity).toMatchObject({ name: 'Flat Watcher', title: 'Flat hunter', description: 'Watches Otodom and tells me about new flats.', avatarColor: '#10b981' })
    expect(panel.summary.identity).toMatchObject({ name: 'Flat Watcher', title: 'Flat hunter', avatarColor: '#10b981' })
  })

  it('refuses a name with a clear error and keeps the name (gb-4563)', async () => {
    const id = await activeRobot()
    scripts.set(id, [
      { calls: [{ name: 'set_identity', args: { name: 'Renamed', title: 'Changed' } }] },
      { text: 'I could not rename myself.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Rename yourself.' } })
    await settle(id)
    expect(results(id)[0]).toContain('your name is your owner')
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.settings.identity).toMatchObject({ name: 'Flat Watcher', title: 'Housing' })
  })

  it('refuses an avatar colour that is not #rrggbb', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ calls: [{ name: 'set_identity', args: { avatar_color: 'green' } }] }, { text: 'Colour not changed.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Go green.' } })
    await settle(id)
    expect(results(id)[0]).toContain('avatar_color must be a colour like #3b82f6')
  })

  it('the owner renames the Robot in its settings (gb-4563)', async () => {
    const id = await activeRobot()
    const saved = await api<{ identity: { name: string } }>(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { identity: { name: 'Flat Keeper', title: 'Housing', description: 'x', avatarColor: '#3b82f6' } } })
    expect(saved.body.identity.name).toBe('Flat Keeper')
  })
})
