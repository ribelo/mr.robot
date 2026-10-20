/**
 * Two browsers (v1.16 ticket 08): Browser Rendering and the Host browser. Container Chrome, via VPN and via proxy are
 * gone from the backend union, the catalog, the API and the Admin view; a Robot and the Home default that were on one
 * move to the Home default at the upgrade; the browser time already spent on them stays in the cost history.
 */
import { env, reset } from 'cloudflare:test'
import * as Schema from 'effect/Schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { UsageView, type AdminView, type HomeSettingsView, type RobotPanel, type SettingsCatalog } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { backendLog } from './stub-browser.ts'
import { scripts } from './stub-llm.ts'
import type { Home as TestHome } from './worker.ts'

const ANNA = 'anna@example.com'
const REMOVED = ['container', 'container-vpn', 'container-proxy']

beforeEach(async () => {
  await reset()
  scripts.clear()
  backendLog.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

const home = () => env.HOME.getByName('home') as unknown as DurableObjectStub<TestHome>

async function robotOf(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['browser'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

describe('the backend union (ob-ltsr)', () => {
  it('offers Browser Rendering and refuses every removed backend, for a Robot and for the Home default', async () => {
    const id = await robotOf()
    const catalog = (await api<SettingsCatalog>(ANNA, `/api/robots/${id}/catalog`)).body
    expect(catalog.browserBackends?.map((option) => option.id)).toEqual(['browser-run'])
    for (const backend of REMOVED) {
      expect((await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { browserBackend: backend } })).status).toBe(400)
      expect((await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { defaultBrowserBackend: backend } })).status).toBe(400)
    }
    expect((await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { defaultBrowserBackend: 'host:desk' } })).status).toBe(200)
    expect((await api<HomeSettingsView>(ANNA, '/api/admin/settings')).body.defaultBrowserBackend).toBe('host:desk')
  })

  it('has no VPN or proxy card: the Admin view and the endpoints are gone', async () => {
    const view = (await api<AdminView>(ANNA, '/api/admin')).body
    expect(view).not.toHaveProperty('vpnSummary')
    expect(view).not.toHaveProperty('proxyConfigured')
    expect(view.browserBackends?.map((option) => option.id)).toEqual(['browser-run'])
    expect((await api(ANNA, '/api/admin/vpn', { method: 'PUT', body: { config: null } })).status).toBe(404)
    expect((await api(ANNA, '/api/admin/proxy', { method: 'PUT', body: { url: null } })).status).toBe(404)
  })
})

describe('the upgrade (ob-l24v, ob-0c3o)', () => {
  it('moves a Robot on a removed backend to the Home default, forgets its open session and keeps its browser time', async () => {
    const id = await robotOf()
    await testRobot(id).legacyBrowserForTest('container-vpn')
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.browserBackend).toBeNull()
    expect(await testRobot(id).browserSessionForTest()).toBeNull()

    scripts.set(id, [{ calls: [{ name: 'browser_open', args: { url: 'https://shop.test/' } }] }, { text: 'Seen.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'look' } })
    await settle(id)
    expect(backendLog).toEqual(['browser-run'])

    const usage = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.usage
    expect(usage.browser).toContainEqual(expect.objectContaining({ backend: 'browser-run' }))
    const old = await testRobot(id).browserUsageForTest('2026-09')
    expect(old).toEqual([{ backend: 'container-vpn', ms: 600_000, costUsd: 0.018 }])
    expect(() => Schema.decodeUnknownSync(UsageView)({ ...usage, browser: [{ backend: 'container-vpn', minutes: 10, costUsd: 0.018 }] })).not.toThrow()
  })

  it('leaves a Robot on a Host browser where it is', async () => {
    const id = await robotOf()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { browserBackend: 'host:desk' } })
    await testRobot(id).legacyBrowserForTest('host:desk')
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.browserBackend).toBe('host:desk')
  })

  it('returns the Home default to Browser Rendering and drops the VPN and proxy credentials', async () => {
    await home().legacyBrowserForTest('container-vpn')
    expect((await api<HomeSettingsView>(ANNA, '/api/admin/settings')).body.defaultBrowserBackend).toBe('browser-run')
    const keys = await home().settingKeysForTest()
    expect(keys).not.toContain('defaultBrowserBackend')
    for (const gone of ['vpn-config', 'vpn-summary', 'proxy-config']) expect(keys).not.toContain(gone)

    await home().legacyBrowserForTest('host:desk')
    expect((await api<HomeSettingsView>(ANNA, '/api/admin/settings')).body.defaultBrowserBackend).toBe('host:desk')
  })
})
