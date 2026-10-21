import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type CatalogConnection, type HostView, type RobotPanel, type SettingsCatalog, type SettingsPatch } from '@mr-robot/protocol'
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
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'space' }, spaceSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, spaceReviewer: null, subagentModels: [],
  },
  tasks: [], screen: null, usage: { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0, breakdown: { model: { robot: 0, review: 0, subagent: 0 }, browser: 0, box: 0, services: 0, total: 0 }, limit: { limit: { kind: 'usd', amount: 5 }, from: 'robot' } }, canEdit: true, takeover: null,
}

const connection = (id: string, kind: CatalogConnection['kind'], pluginTitle: string, account: string): CatalogConnection => ({
  id, kind, pluginTitle, label: account, account, ownerId: 'm-1', ownerName: 'Anna', shared: false, mine: true, isDefault: true,
  services: [], status: 'connected', statusNote: null, setupLink: null, setupLabel: null, createdAt: 0,
})
const host = (id: string, name: string, online: boolean, owner: { mine: true } | { mine: false; ownerName: string }): HostView => ({
  id, name, platform: 'linux', ownerId: owner.mine ? 'm-1' : 'm-2', ownerName: owner.mine ? 'Anna' : owner.ownerName, sharing: owner.mine ? 'private' : 'space',
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
    expect(within(desk).getByText('Run commands on the host as the host owner, in their shell')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Studio' })).getByRole('heading').textContent).toBe("Studio · offline · Ben's")
    expect(levelOf('Desk · files')).toBe('ask')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Studio · shell' })).getByRole('radio', { name: 'allow' }))
    expect(levelOf('Studio · shell')).toBe('allow')
    expect(levelOf('Desk · shell')).toBe('deny')
  })
})

describe('Robot settings: what a Host grant may change (v1.16 ticket 02, ob-wh59)', () => {
  const withGrants = { ...panel, settings: { ...panel.settings, grants: { ...emptyGrants, hosts: { 'h-desk:files': 'allow' as const, 'h-desk:shell': 'allow' as const } }, hostAccess: { 'h-desk:shell': { mode: 'workspace-write' as const, roots: ['~/projects'] } } } }
  const render_ = (saved: SettingsPatch[]) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
    render(<RegistryProvider><AdvancedSettings panel={withGrants} catalog={catalog} onSave={async (patch) => { saved.push(patch); return true }} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
  }

  it('shows the mode and the roots of each files and shell grant, workspace-write with no root by default, and none for the browser or a denied facet', () => {
    render_([])
    expect((screen.getByRole('combobox', { name: 'Desk · files changes allowed' }) as HTMLSelectElement).value).toBe('workspace-write')
    expect((screen.getByRole('textbox', { name: 'Desk · files write roots' }) as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByRole('textbox', { name: 'Desk · shell write roots' }) as HTMLTextAreaElement).value).toBe('~/projects')
    expect(screen.queryByRole('combobox', { name: 'Desk · browser changes allowed' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Studio · shell changes allowed' })).toBeNull()
  })

  it('saves a changed mode and a list of roots, and hides the roots when the mode is not workspace-write', async () => {
    const saved: SettingsPatch[] = []
    render_(saved)
    fireEvent.change(screen.getByRole('textbox', { name: 'Desk · shell write roots' }), { target: { value: '~/projects\n/srv/data' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Desk · files changes allowed' }), { target: { value: 'read-only' } })
    expect(screen.queryByRole('textbox', { name: 'Desk · files write roots' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.hostAccess).toEqual({ 'h-desk:shell': { mode: 'workspace-write', roots: ['~/projects', '/srv/data'] }, 'h-desk:files': { mode: 'read-only', roots: [] } })
  })

  it('shows a root that is not a folder path and does not save it', async () => {
    const saved: SettingsPatch[] = []
    render_(saved)
    fireEvent.change(screen.getByRole('textbox', { name: 'Desk · shell write roots' }), { target: { value: 'projects' } })
    expect(screen.getByRole('alert').textContent).toBe('Not a folder path: projects')
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(saved).toEqual([])
  })
})

describe('Robot settings: while idle (ao-jlr0, ao-f4sp, ao-z22f)', () => {
  it('shows cache warming, idle compaction and the floor as stored, and saves the changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
    const saved: SettingsPatch[] = []
    render(<RegistryProvider><AdvancedSettings panel={panel} catalog={catalog} onSave={async (patch) => { saved.push(patch); return true }} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
    const warming = screen.getByRole('checkbox', { name: /^Cache warming/ }) as HTMLInputElement
    const compaction = screen.getByRole('checkbox', { name: /^Idle compaction/ }) as HTMLInputElement
    const floor = screen.getByLabelText('Compact only above (tokens)') as HTMLInputElement
    expect([warming.checked, compaction.checked, floor.value]).toEqual([false, true, '20000'])
    fireEvent.click(warming)
    fireEvent.click(compaction)
    fireEvent.change(floor, { target: { value: '50000' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ cacheWarming: true, idleCompaction: false, idleCompactionFloorTokens: 50000 })
  })
})

describe('Robot settings: Auto review (ao-c8k9, ao-6m9i)', () => {
  it('is off with the Space default reviewer; switching it on with a model of its own saves both', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
    const saved: SettingsPatch[] = []
    const models = [{ provider: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek Flash', contextWindow: 128000 }, { provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku', contextWindow: 200000 }]
    render(<RegistryProvider><AdvancedSettings panel={panel} catalog={{ ...catalog, models }} onSave={async (patch) => { saved.push(patch); return true }} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
    const toggle = screen.getByRole('checkbox', { name: /^Auto review/ }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    const reviewer = screen.getByRole('combobox', { name: 'Reviewer' }) as HTMLSelectElement
    expect(reviewer.selectedOptions[0]!.textContent).toBe("Space default (this Robot's own model)")
    fireEvent.click(toggle)
    fireEvent.change(reviewer, { target: { value: 'own' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Reviewer thinking' }), { target: { value: 'low' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ autoReview: true, reviewer: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' } })
  })
})


describe('Robot settings: waiting for Hosts (v1.16 ticket 05, ob-5nvd)', () => {
  it('is off by default; switching it on saves requiresHosts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
    const saved: SettingsPatch[] = []
    render(<RegistryProvider><AdvancedSettings panel={panel} catalog={catalog} onSave={async (patch) => { saved.push(patch); return true }} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
    const toggle = screen.getByRole('checkbox', { name: /^Do not run while any of my Hosts is offline/ }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ requiresHosts: true })
  })

  it('shows the stored setting', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
    render(<RegistryProvider><AdvancedSettings panel={{ ...panel, settings: { ...panel.settings, requiresHosts: true } }} catalog={catalog} onSave={async () => true} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
    expect((screen.getByRole('checkbox', { name: /^Do not run while any of my Hosts is offline/ }) as HTMLInputElement).checked).toBe(true)
  })
})

describe('Robot settings: the prompt preview (v1.15 ticket 13, gb-dzf6)', () => {
  it('shows the new sections of the Platform part and the platform skills before the granted ones', async () => {
    const preview = {
      sections: [{ name: 'Platform', text: '## Talking to Anna\nReply first.\n\n## Platform skills\n- tasks-cadence: When a Task runs.\n- asking: When to ask.' }, { name: 'mr-robot:box', text: '## Your Box' }],
      tools: ['say', 'ask'],
      skills: ['tasks-cadence (platform): When a Task runs.', 'asking (platform): When to ask.', 'invoices'],
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(String(url).endsWith('/prompt') ? preview : { sections: [], tools: [], skills: [] })))
    render(<RegistryProvider><AdvancedSettings panel={panel} catalog={catalog} onSave={async () => true} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
    await waitFor(() => expect(screen.getByText(/^Platform/, { selector: 'summary' })).toBeTruthy())
    const platform = screen.getByText(/^Platform/, { selector: 'summary' }).closest('details')!
    expect(platform.querySelector('pre')?.textContent).toContain('## Talking to Anna')
    expect(platform.querySelector('pre')?.textContent).toContain('## Platform skills\n- tasks-cadence: When a Task runs.')
    const skills = screen.getByText(/^Skills/, { selector: 'summary' }).closest('details')!
    expect(skills.querySelector('summary')?.textContent).toContain('3')
    expect(skills.querySelector('pre')?.textContent).toBe('tasks-cadence (platform): When a Task runs.\nasking (platform): When to ask.\ninvoices')
  })
})
