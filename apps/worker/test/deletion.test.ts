import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotPanel, RobotSummary } from '@mr-robot/protocol'
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

async function robot(name: string, tools: string[] = ['files', 'routines']): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, identity: { name }, grants: { tools, skills: [], recipients: [], secrets: [], hosts: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const robots = async () => (await api<RobotSummary[]>(ANNA, '/api/robots')).body
const mrRobot = async () => (await robots()).find((entry) => entry.kind === 'mr-robot')!

describe('delete, clear and reset (v1.3 ticket 06)', () => {
  it('deletes a robot for good only with its name typed: storage, files, routines, recipient grants (pl-3uoy, pl-kehf)', async () => {
    const id = await robot('New robot')
    await say(id, 'note it', [{ calls: [{ name: 'write', args: { file_path: 'notes.md', content: 'x' } }] }, { text: 'Noted.' }])
    const mr = (await mrRobot()).id
    await api(ANNA, `/api/robots/${mr}/settings`, { method: 'PATCH', body: { grants: { tools: ['messaging'], skills: [], recipients: [id], secrets: [], hosts: [] } } })
    expect((await env.FILES.list({ prefix: `robots/${id}/` })).objects.length).toBeGreaterThan(0)

    expect((await api(ANNA, `/api/robots/${id}`, { method: 'DELETE', body: { confirm: 'new robot' } })).status).toBe(400)
    expect((await api(ANNA, `/api/robots/${mr}`, { method: 'DELETE', body: { confirm: 'Mr. Robot' } })).status).toBe(400)
    const deleted = await api(ANNA, `/api/robots/${id}`, { method: 'DELETE', body: { confirm: 'New robot' } })
    expect(deleted.status).toBe(200)

    expect((await robots()).some((entry) => entry.id === id)).toBe(false)
    expect((await env.FILES.list({ prefix: `robots/${id}/` })).objects.length).toBe(0)
    expect(await testRobot(id).toolNames().catch(() => 'gone')).toBe('gone')
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${mr}/panel`)).body
    expect(JSON.stringify(panel.settings.grants.recipients)).not.toContain(id)
  })

  it('clears history keeping configuration, routines and memory, or memory too when chosen (pl-05eu, pl-y228)', async () => {
    const id = await robot('Bills')
    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\nPays on the 10th.' } })
    await say(id, 'zebra-before-clear', [{ text: 'Remembered.' }])
    expect((await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: 'Wrong' } })).status).toBe(400)
    expect((await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: 'New robot' } })).status).toBe(200)
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items.filter((item) => item.kind === 'message' || item.kind === 'reply')).toEqual([])
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.identity.name).toBe('New robot')
    const memory = await api<{ text: string }>(ANNA, `/api/robots/${id}/file?path=MEMORY.md`)
    expect(memory.body.text).toContain('Pays on the 10th.')
    await say(id, 'hello again', [{ text: 'Hi.' }])
    expect(JSON.stringify(requests.get(id)!.at(-1)!.messages)).not.toContain('zebra-before-clear')

    await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: 'New robot', memory: true } })
    expect((await api<{ text: string }>(ANNA, `/api/robots/${id}/file?path=MEMORY.md`)).body.text).not.toContain('Pays on the 10th.')

    const mr = (await mrRobot()).id
    expect((await api(ANNA, `/api/robots/${mr}/clear`, { body: { confirm: 'Mr. Robot' } })).status).toBe(200)
  })

  it('resets everything to Mr. Robot alone, keeping logins and providers (pl-062x)', async () => {
    await robot('One')
    await robot('Two')
    await api(ANNA, '/api/me/files/USER.md', { method: 'PUT', body: { content: '# USER.md\nAnna.' } })
    await api(ANNA, '/api/secrets/shop', { method: 'PUT', body: { username: 'anna', password: 'pw', websites: ['https://shop.test'], shared: false } })
    const name = (await api<{ name: string }>(ANNA, '/api/me')).body.name
    expect((await api(ANNA, '/api/me/reset', { body: { confirm: 'nope' } })).status).toBe(400)
    expect((await api(ANNA, '/api/me/reset', { body: { confirm: name } })).status).toBe(200)
    const after = await robots()
    expect(after.map((entry) => entry.kind)).toEqual(['mr-robot'])
    expect((await api<{ content: string }>(ANNA, '/api/me/files/USER.md')).body.content).not.toContain('Anna.')
    expect(JSON.stringify((await api(ANNA, '/api/secrets')).body)).toContain('shop')
    const items = (await api<Conversation>(ANNA, `/api/robots/${after[0]!.id}/conversation`)).body.items
    expect(items.filter((item) => item.kind === 'reply' || item.kind === 'message').length).toBe(0)
  })
})
