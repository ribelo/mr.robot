import { env, reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Me, PluginView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import { connectorFixtures, type RecordedCall } from './connector-fixtures.ts'
import { fakeConnector, fakeConnectors, fakeServiceTokens } from './fake-connector.ts'
import type { Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const ORIGIN = 'https://mr-robot.test'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  fakeConnectors.clear()
  fakeServiceTokens.length = 0
  connectorFixtures.reset()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

/** A navigation as the browser makes it: the redirect is returned, not followed. */
async function visit(path: string): Promise<URL> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, { headers: { 'x-dev-identity': ANNA }, redirect: 'manual' })
  expect(response.status).toBe(302)
  return new URL(response.headers.get('location')!)
}

const setUpClient = () => api(ANNA, '/api/admin/plugins/google/settings', { method: 'PUT', body: { values: { clientId: 'client-1.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' } } })

/** Google's recorded answers: the token exchange and the account's address. */
function google(email: string, scope: string, refreshToken = `refresh-${email}`) {
  connectorFixtures.on('POST', 'https://oauth2.googleapis.com/token', (call: RecordedCall) => {
    const form = new URLSearchParams(call.body ?? '')
    if (form.get('grant_type') === 'refresh_token') return { access_token: `access-refreshed-${email}`, expires_in: 3599, scope, token_type: 'Bearer' }
    return { access_token: `access-${email}`, expires_in: 3599, refresh_token: refreshToken, scope, token_type: 'Bearer', id_token: 'x' }
  })
  connectorFixtures.on('GET', 'https://openidconnect.googleapis.com/v1/userinfo', (call: RecordedCall) => (call.headers['authorization']?.includes(email) ? { sub: '1', email, email_verified: true } : undefined))
}

const SCOPES = (...names: string[]) => ['openid', 'https://www.googleapis.com/auth/userinfo.email', ...names.map((name) => `https://www.googleapis.com/auth/${name}`)].join(' ')

async function consent(services: string, email: string, scope: string, extra = ''): Promise<URL> {
  const start = await visit(`/api/connections/google/oauth/start?services=${services}&shared=0${extra}`)
  google(email, scope)
  return visit(`/api/connections/google/oauth/callback?state=${start.searchParams.get('state')}&code=code-${email}&scope=x`)
}

describe('Connect Google (v1.5 ticket 02)', () => {
  it('asks the admin for the OAuth client first, with the guide and this callback URL (cn-fpyt)', async () => {
    const back = await visit('/api/connections/google/oauth/start?services=gmail')
    expect(back.hash).toContain('connection-error=')
    expect(decodeURIComponent(back.hash)).toContain('has not set up the Google OAuth client')
    const plugin = (await api<PluginView[]>(ANNA, '/api/plugins')).body.find((entry) => entry.name === 'google')!
    expect(plugin.guide).toContain(`${ORIGIN}/api/connections/google/oauth/callback`)
    expect(plugin.guide).toContain('Publish app')
  })

  it('sends the person to Google with only the chosen services, offline (cn-aq2a, cn-lzqh)', async () => {
    await setUpClient()
    const consentUrl = await visit('/api/connections/google/oauth/start?services=gmail,calendar&shared=0')
    expect(consentUrl.origin + consentUrl.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const params = consentUrl.searchParams
    expect(params.get('client_id')).toBe('client-1.apps.googleusercontent.com')
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/api/connections/google/oauth/callback`)
    expect(params.get('access_type')).toBe('offline')
    expect(params.get('prompt')).toBe('consent')
    expect(params.get('scope')!.split(' ')).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/calendar'])
    expect(params.get('state')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('stores the connection with what Google granted; the state works once; a second account keeps its own services', async () => {
    await setUpClient()
    const start = await visit('/api/connections/google/oauth/start?services=gmail,calendar,drive&shared=0')
    // The person unticked Drive on Google's screen: only Gmail and Calendar were granted.
    google('anna@gmail.test', SCOPES('gmail.modify', 'calendar'))
    const done = await visit(`/api/connections/google/oauth/callback?state=${start.searchParams.get('state')}&code=code-1`)
    expect(decodeURIComponent(done.hash)).toBe('#/me?connected=anna@gmail.test')
    const exchange = connectorFixtures.calls.find((call) => call.url === 'https://oauth2.googleapis.com/token')!
    expect(Object.fromEntries(new URLSearchParams(exchange.body!))).toMatchObject({ code: 'code-1', client_id: 'client-1.apps.googleusercontent.com', client_secret: 'GOCSPX-secret', grant_type: 'authorization_code', redirect_uri: `${ORIGIN}/api/connections/google/oauth/callback` })
    const again = await visit(`/api/connections/google/oauth/callback?state=${start.searchParams.get('state')}&code=code-1`)
    expect(decodeURIComponent(again.hash)).toContain('expired or was already used')

    await consent('drive,contacts', 'anna@company.test', SCOPES('drive', 'documents', 'spreadsheets', 'contacts.readonly'))
    const connections = (await api<ConnectionView[]>(ANNA, '/api/connections')).body
    expect(connections.map(({ account, services, status }) => ({ account, services, status }))).toEqual([
      { account: 'anna@gmail.test', services: ['gmail', 'calendar'], status: 'connected' },
      { account: 'anna@company.test', services: ['drive', 'contacts'], status: 'connected' },
    ])
    expect(JSON.stringify(connections)).not.toContain('refresh-')
  })

  it('refreshes an expired access token for a robot without the owner (cn-j1la)', async () => {
    await setUpClient()
    await consent('gmail', 'anna@gmail.test', SCOPES('gmail.modify'))
    const [connection] = (await api<ConnectionView[]>(ANNA, '/api/connections')).body
    fakeConnectors.set('google', fakeConnector('google'))
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: [], skills: [], recipients: [], secrets: [], connections: [connection!.id] } } })
    await testRobot(body.id).activateForTest()
    await (env.MEMBER.getByName(annaId) as unknown as DurableObjectStub<TestMember>).expireConnectionsForTest()
    const before = connectorFixtures.calls.length
    scripts.set(body.id, [{ calls: [{ name: 'fake_whoami', args: {} }] }, { text: 'Done.' }])
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'check' } })
    await settle(body.id)
    const refresh = connectorFixtures.calls.slice(before).find((call) => call.url === 'https://oauth2.googleapis.com/token')!
    expect(Object.fromEntries(new URLSearchParams(refresh.body!))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-anna@gmail.test' })
    expect(fakeServiceTokens).toEqual(['access-refreshed-anna@gmail.test'])
  })

  it('a revoked token shows "needs consent again" and Reconnect repairs the same connection (cn-9s7r)', async () => {
    await setUpClient()
    await consent('gmail', 'anna@gmail.test', SCOPES('gmail.modify'))
    const [connection] = (await api<ConnectionView[]>(ANNA, '/api/connections')).body
    connectorFixtures.on('POST', 'https://oauth2.googleapis.com/token', { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)
    const member = env.MEMBER.getByName(annaId) as unknown as DurableObjectStub<TestMember>
    await member.expireConnectionsForTest()
    await member.useConnection(connection!.id)
    const broken = (await api<ConnectionView[]>(ANNA, '/api/connections')).body[0]!
    expect(broken).toMatchObject({ status: 'needs-reconsent', statusNote: 'Token has been expired or revoked.' })

    const start = await visit(`/api/connections/google/oauth/start?reconnect=${connection!.id}`)
    expect(start.searchParams.get('login_hint')).toBe('anna@gmail.test')
    google('anna@gmail.test', SCOPES('gmail.modify'), 'refresh-new')
    await visit(`/api/connections/google/oauth/callback?state=${start.searchParams.get('state')}&code=code-2`)
    const repaired = (await api<ConnectionView[]>(ANNA, '/api/connections')).body
    expect(repaired).toEqual([expect.objectContaining({ id: connection!.id, status: 'connected', statusNote: null })])
  })
})
