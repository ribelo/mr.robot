import { env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Me, PluginView, SettingsCatalog, Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import { fakeConnector, fakeConnectors } from './fake-connector.ts'
import { PLUGINS } from '../src/plugins/catalog.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
let annaId = ''
let benId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  fakeConnectors.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  benId = (await api<Me>(BEN, '/api/me')).body.id
})

afterEach(() => fakeConnectors.clear())

async function robotOf(as: string, grants: { tools?: string[]; connections?: string[] }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: grants.tools ?? [], skills: [], recipients: [], secrets: [], connections: grants.connections ?? [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const toolsOf = async (as: string, id: string) => (await api<{ tools: string[] }>(as, `/api/robots/${id}/prompt`)).body.tools

async function say(as: string, id: string, calls: Array<{ name: string; args: Record<string, unknown> }>) {
  scripts.set(id, [...calls.map((call) => ({ calls: [call] })), { text: 'Done.' }])
  await api(as, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  const last = requests.get(id)!.at(-1)!
  return last.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
}

const addConnection = (memberId: string, label: string, account: string, token: string, shared = false) =>
  env.MEMBER.getByName(memberId).addConnection({ kind: 'google', label, account, services: [], shared, meta: {}, secrets: { token } })

describe('plugins and their settings (cn-dbm9, cn-s1pd, cn-a1i0)', () => {
  it('lists every plugin with a schema-derived form for the admin only, and keeps secrets out of the configuration', async () => {
    const plugins = (await api<PluginView[]>(ANNA, '/api/plugins')).body
    expect(plugins.map((plugin) => plugin.name)).toEqual(PLUGINS.map((plugin) => plugin.name))
    const google = plugins.find((plugin) => plugin.name === 'google')!
    expect(google.fields.map((field) => [field.key, field.kind])).toEqual([['clientId', 'text'], ['clientSecret', 'secret']])
    expect(google.setupNeeded).toContain('Google OAuth client')
    expect(google.connector).toMatchObject({ kind: 'google', connect: { method: 'oauth' } })
    expect((await api<PluginView[]>(BEN, '/api/plugins')).body.find((plugin) => plugin.name === 'google')!.fields).toEqual([])

    const saved = await api<PluginView>(ANNA, '/api/admin/plugins/google/settings', { method: 'PUT', body: { values: { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'GOCSPX-very-secret' } } })
    expect(saved.status).toBe(200)
    expect(saved.body.values).toEqual({ clientId: 'client-123.apps.googleusercontent.com' })
    expect(saved.body.secretsSet).toEqual(['clientSecret'])
    expect(saved.body.setupNeeded).toBeNull()
    const again = await api<PluginView[]>(ANNA, '/api/plugins')
    expect(JSON.stringify(again.body)).not.toContain('GOCSPX-very-secret')
    // Saving without the secret keeps the stored one.
    await api(ANNA, '/api/admin/plugins/google/settings', { method: 'PUT', body: { values: { clientId: 'client-456' } } })
    expect((await env.HOME.getByName('home').pluginSettings('google')).secrets).toEqual({ clientSecret: 'GOCSPX-very-secret' })
    expect((await api(BEN, '/api/admin/plugins/google/settings', { method: 'PUT', body: { values: { clientId: 'x' } } })).status).toBe(403)
  })

  it('a plugin switched off is neither offered nor mounted (cn-dbm9)', async () => {
    const id = await robotOf(ANNA, { tools: ['browser', 'files'] })
    expect(await toolsOf(ANNA, id)).toContain('browser_open')
    expect((await api(BEN, '/api/admin/plugins/browser', { method: 'PUT', body: { enabled: false } })).status).toBe(403)
    expect((await api(ANNA, '/api/admin/plugins/browser', { method: 'PUT', body: { enabled: false } })).status).toBe(200)
    expect((await api<PluginView[]>(ANNA, '/api/plugins')).body.find((plugin) => plugin.name === 'browser')!.enabled).toBe(false)
    const catalog = (await api<SettingsCatalog>(ANNA, `/api/robots/${id}/catalog`)).body
    expect(catalog.toolGroups.map((group) => group.name)).not.toContain('browser')
    const tools = await toolsOf(ANNA, id)
    expect(tools).not.toContain('browser_open')
    expect(tools).toContain('glob')
  })
})

describe('connections (cn-qs78, cn-xezx, cn-bsge, cn-f6ux, cn-a1i0, cn-07jo)', () => {
  it('an ungranted connection is invisible; a granted one acts on its own account and its secret is masked', async () => {
    fakeConnectors.set('google', fakeConnector('google'))
    const priv = await addConnection(annaId, 'Private', 'anna@private.test', 'token-private')
    const id = await robotOf(ANNA, {})
    expect((await toolsOf(ANNA, id)).filter((name) => name.startsWith('fake_') || name.startsWith('google_'))).toEqual([])

    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: [], skills: [], recipients: [], secrets: [], connections: [priv.id] } } })
    expect(await toolsOf(ANNA, id)).toEqual(expect.arrayContaining(['google_accounts', 'fake_whoami']))
    expect(await toolsOf(ANNA, id)).not.toContain('fake_send')
    const [result] = await say(ANNA, id, [{ name: 'fake_whoami', args: {} }])
    expect(result).toContain('[google · Private (anna@private.test)] whoami')
    expect(result).toContain('anna@private.test')
    const trajectory = JSON.stringify((await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body)
    expect(trajectory).toContain('[google · Private (anna@private.test)] whoami')
    expect(trajectory).not.toContain('token-private')
  })

  it('routes by the account parameter between two connections, defaulting to the marked one (cn-bsge)', async () => {
    fakeConnectors.set('google', fakeConnector('google'))
    const priv = await addConnection(annaId, 'Private', 'anna@private.test', 'token-private')
    const work = await addConnection(annaId, 'Work', 'anna@work.test', 'token-work')
    const id = await robotOf(ANNA, { connections: [priv.id, work.id, `${work.id}:write`] })
    const [toWork, byDefault, sendWork] = await say(ANNA, id, [
      { name: 'fake_whoami', args: { account: 'Work' } },
      { name: 'fake_whoami', args: {} },
      { name: 'fake_send', args: { text: 'hi' } },
    ])
    expect(toWork).toContain('[google · Work (anna@work.test)]')
    expect(toWork).toContain('The service says: anna@work.test')
    expect(byDefault).toContain('[google · Private (anna@private.test)]')
    // Only Work carries the write grant, so sending acts on Work.
    expect(sendWork).toContain('[google · Work (anna@work.test)] send "hi"')
    // The default moves when the person marks another one.
    await api(ANNA, `/api/connections/${work.id}`, { method: 'PATCH', body: { isDefault: true } })
    const [moved] = await say(ANNA, id, [{ name: 'fake_whoami', args: {} }])
    expect(moved).toContain('[google · Work (anna@work.test)]')
  })

  it("a Home-shared connection is usable by another Member's robot once granted, and stops when unshared (cn-qs78)", async () => {
    fakeConnectors.set('google', fakeConnector('google'))
    const bens = await addConnection(benId, 'Household', 'ben@home.test', 'token-ben', true)
    const mine = (await api<ConnectionView[]>(ANNA, '/api/connections')).body
    expect(mine).toEqual([expect.objectContaining({ id: bens.id, ownerName: 'Ben', mine: false, shared: true })])
    expect(JSON.stringify(mine)).not.toContain('token-ben')
    const id = await robotOf(ANNA, { connections: [bens.id] })
    const [used] = await say(ANNA, id, [{ name: 'fake_whoami', args: {} }])
    expect(used).toContain('The service says: ben@home.test')
    // Anna cannot change Ben's connection.
    expect((await api(ANNA, `/api/connections/${bens.id}`, { method: 'PATCH', body: { shared: false } })).status).toBe(404)
    await api(BEN, `/api/connections/${bens.id}`, { method: 'PATCH', body: { shared: false } })
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toEqual([])
    expect(await toolsOf(ANNA, id)).not.toContain('fake_whoami')
  })

  it('refused credentials show on the owner\'s row (cn-9s7r)', async () => {
    fakeConnectors.set('google', fakeConnector('google'))
    const revoked = await addConnection(annaId, 'Old', 'anna@old.test', 'revoked-token')
    const id = await robotOf(ANNA, { connections: [revoked.id] })
    const [result] = await say(ANNA, id, [{ name: 'fake_whoami', args: {} }])
    expect(result).toContain('Failed: the account\'s credentials were refused')
    const row = (await api<ConnectionView[]>(ANNA, '/api/connections')).body.find((connection) => connection.id === revoked.id)!
    expect(row.status).toBe('needs-reconsent')
    expect(row.statusNote).toBe('invalid_token')
  })
})
