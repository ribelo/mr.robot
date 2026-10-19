import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type CatalogConnection, type HostView, type RobotPanel, type SettingsCatalog } from '@mr-robot/protocol'
import { AdvancedSettings } from '../src/components/AdvancedSettings.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const identity = { name: 'Sales Outbound', title: 'Sales', description: 'Works the pipeline overnight.', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const panel: RobotPanel = {
  summary: { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false },
  settings: {
    identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }], contextBudget: 128000,
    codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: { ...emptyGrants, hosts: { 'h-desk:files': 'ask' } },
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'home' }, homeSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true,
  },
  tasks: [], screen: null, usage: { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0, breakdown: { model: { robot: 0, review: 0, subagent: 0 }, browser: 0, computer: 0, services: 0, total: 0 }, limit: { limit: { kind: 'usd', amount: 5 }, from: 'robot' } }, canEdit: true, takeover: null,
}

const connection = (id: string, kind: CatalogConnection['kind'], pluginTitle: string, account: string): CatalogConnection => ({
  id, kind, pluginTitle, label: account, account, ownerId: 'm-1', ownerName: 'Anna', shared: false, mine: true, isDefault: true,
  services: [], status: 'connected', statusNote: null, setupLink: null, setupLabel: null, createdAt: 0,
})
const host = (id: string, name: string, online: boolean, owner: { mine: true } | { mine: false; ownerName: string }): HostView => ({
  id, name, platform: 'linux', ownerId: owner.mine ? 'm-1' : 'm-2', ownerName: owner.mine ? 'Anna' : owner.ownerName, sharing: owner.mine ? 'private' : 'home',
  online, lastSeen: null, version: null, capabilities: null, mine: owner.mine, users: [],
})

const catalog: SettingsCatalog = {
  toolGroups: [{ name: 'web', description: 'Fetch pages by address (web_fetch, free; searching the web is the exa group).' }],
  skills: [], robots: [], secrets: [], models: [], workersAiEnabled: true,
  connections: [connection('c-google', 'google', 'Google', 'r.krzywaznia@gmail.com'), connection('c-discord', 'discord', 'Discord bot', 'Mr. Robot')],
  hosts: [host('h-desk', 'Desk', true, { mine: true }), host('h-studio', 'Studio', false, { mine: false, ownerName: 'Ben' })],
}

const open = () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
  render(<RegistryProvider><AdvancedSettings panel={panel} catalog={catalog} onSave={async () => true} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
}
const levelOf = (name: string) => screen.getByRole('radiogroup', { name }).querySelector('[aria-checked="true"]')?.textContent

describe('Robot settings: Connections and Hosts (ux-5g3w, ux-q8o6)', () => {
  it('says that Connections are the plugin tools and labels each account with its plugin', () => {
    open()
    expect(screen.getByText('Plugin tools: one item per connected account. Each Robot gets only the accounts you grant here.')).toBeTruthy()
    expect(screen.getByText('Google · r.krzywaznia@gmail.com')).toBeTruthy()
    expect(screen.getByText('Discord bot · Mr. Robot')).toBeTruthy()
    expect(levelOf('Google · r.krzywaznia@gmail.com')).toBe('deny')
  })

  it('groups the Host facets under one heading per Host with its state', () => {
    open()
    const desk = screen.getByRole('region', { name: 'Desk' })
    expect(within(desk).getByRole('heading').textContent).toBe('Desk · online')
    expect(within(desk).getAllByRole('radiogroup').map((group) => group.getAttribute('aria-label'))).toEqual(['Desk · files', 'Desk · shell', 'Desk · browser'])
    expect(within(desk).getByText('files')).toBeTruthy()
    expect(within(desk).getByText('host_run as the host owner, in their shell')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Studio' })).getByRole('heading').textContent).toBe("Studio · offline · Ben's")
    expect(levelOf('Desk · files')).toBe('ask')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Studio · shell' })).getByRole('radio', { name: 'allow' }))
    expect(levelOf('Studio · shell')).toBe('allow')
    expect(levelOf('Desk · shell')).toBe('deny')
  })
})
