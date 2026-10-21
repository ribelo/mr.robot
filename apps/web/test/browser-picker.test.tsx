/**
 * The browser picker with two choices (v1.16 ticket 08, ob-myzd): Browser Run and the Host browser, in the Robot's
 * Advanced settings and for the Space default in Admin. No Container Chrome, no VPN card, no proxy card (ob-ltsr).
 */
import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type AdminView, type BrowserBackendOption, type RobotPanel, type SettingsCatalog, type SettingsPatch } from '@mr-robot/protocol'
import { Admin } from '../src/components/Admin.tsx'
import { AdvancedSettings } from '../src/components/AdvancedSettings.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const browserRun: BrowserBackendOption = { id: 'browser-run', label: 'Browser Run', note: 'Cloudflare Browser Rendering.', available: true }
const deskBrowser: BrowserBackendOption = { id: 'host:h-desk', label: 'Host browser: Desk', note: "Chrome on Anna's computer \"Desk\".", available: true }

const identity = { name: 'Sales Outbound', title: 'Sales', description: 'Works the pipeline overnight.', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const panel: RobotPanel = {
  summary: { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false },
  settings: {
    identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }], contextBudget: 128000,
    wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants,
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'space' }, spaceSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, spaceReviewer: null, subagentModels: [],
  },
  tasks: [], screen: null, usage: { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0, breakdown: { model: { robot: 0, review: 0, subagent: 0, memory: 0 }, browser: 0, box: 0, services: 0, total: 0 }, limit: { limit: { kind: 'usd', amount: 5 }, from: 'robot' } }, canEdit: true, takeover: null,
}
const catalog: SettingsCatalog = { toolGroups: [], skills: [], robots: [], secrets: [], models: [], workersAiEnabled: true, connections: [], hosts: [], browserBackends: [browserRun, deskBrowser], defaultBrowserBackend: 'browser-run' }

describe("the Robot's browser backend", () => {
  it('offers the Space default, Browser Run and the Host browser, and saves the choice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
    const patches: SettingsPatch[] = []
    render(<RegistryProvider><AdvancedSettings panel={panel} catalog={catalog} onSave={async (patch) => { patches.push(patch); return true }} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
    const picker = screen.getByRole('combobox', { name: 'Browser backend' })
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['Space default (Browser Run)', 'Browser Run', 'Host browser: Desk'])
    fireEvent.change(picker, { target: { value: 'host:h-desk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patches.at(-1)?.browserBackend).toBe('host:h-desk'))
  })
})

describe('the Space default browser and the Admin cards', () => {
  const settings = {
    defaultModel: { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'off' }, workersAiEnabled: true, defaultBrowserBackend: 'browser-run',
    robotSpendLimit: { kind: 'none' }, memberSpendLimit: { kind: 'none' }, defaultReviewer: null,
    models: [{ provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextWindow: 128_000 }],
  } as const
  const view: AdminView = { fleet: [], robotsToMigrate: 0, members: [], skills: [], skillRepository: null, providers: [], settings, browserBackends: [browserRun, deskBrowser] }

  it('shows the two choices and no VPN or proxy card', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname
      if (path === '/api/admin') return Response.json(view)
      if (path === '/api/space-memory') return Response.json({ content: '' })
      return Response.json([])
    }))
    render(<RegistryProvider><Admin /></RegistryProvider>)
    const picker = await screen.findByRole('combobox', { name: 'Default browser backend' })
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['Browser Run', 'Host browser: Desk'])
    expect(screen.queryByRole('heading', { name: 'Proton VPN' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Proxy' })).toBeNull()
    expect(screen.queryByLabelText('WireGuard configuration')).toBeNull()
    expect(screen.queryByLabelText('Proxy address')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Exa' })).toBeTruthy()
  })
})
