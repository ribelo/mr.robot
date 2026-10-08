import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me, SkillView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import { connectorFixtures } from './connector-fixtures.ts'

const ANNA = 'anna@example.com'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  connectorFixtures.reset()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

async function robotWith(grants: { tools: string[]; skills: string[]; connections: string[] }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { recipients: [], secrets: [], ...grants } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function offered(id: string): Promise<string> {
  scripts.set(id, [{ text: 'ok' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'what can you do?' } })
  await settle(id)
  return JSON.stringify(requests.get(id)!.at(-1))
}

describe('connector skills (v1.5 ticket 07, cn-go3s, cn-6kh9)', () => {
  it('appear in the library when a connector is connected, and load only with the connector grant', async () => {
    expect((await api<{ skills: SkillView[] }>(ANNA, '/api/skills')).body.skills).toEqual([])
    const gmail = await env.MEMBER.getByName(annaId).addConnection({ kind: 'google', label: 'Private', account: 'anna@gmail.test', services: ['gmail'], shared: false, meta: { expiresAt: Date.now() + 3_600_000 }, secrets: { accessToken: 'a', refreshToken: 'r' } })
    const library = (await api<{ skills: SkillView[] }>(ANNA, '/api/skills')).body.skills.map((skill) => skill.name)
    expect(library).toEqual(expect.arrayContaining(['google-workspace', 'mbank-notifications', 'slack-workspace', 'discord-bot']))

    // A skill grant alone is not enough: the mBank skill rides on the Google connection.
    const skillOnly = await robotWith({ tools: ['skills'], skills: ['mbank-notifications'], connections: [] })
    expect(await offered(skillOnly)).not.toContain('mbank-notifications')

    const banker = await robotWith({ tools: [], skills: [], connections: [gmail.id] })
    const request = await offered(banker)
    expect(request).toContain('mbank-notifications')
    expect(request).toContain('google-workspace')
    expect(request).not.toContain('slack-workspace')
  })

  it('an admin edit of a connector skill survives the next seeding', async () => {
    await env.HOME.getByName('home').seedConnectorSkills()
    await api(ANNA, '/api/admin/skills/mbank-notifications', { method: 'PUT', body: { description: 'Our bank, our way', content: '---\nname: mbank-notifications\ndescription: Our bank, our way\n---\nEdited.' } })
    await env.HOME.getByName('home').seedConnectorSkills()
    const skill = (await api<{ skills: SkillView[] }>(ANNA, '/api/skills')).body.skills.find((entry) => entry.name === 'mbank-notifications')!
    expect(skill.description).toBe('Our bank, our way')
    expect((await api<{ content: string }>(ANNA, '/api/skills/mbank-notifications')).body.content).toContain('Edited.')
  })
})
