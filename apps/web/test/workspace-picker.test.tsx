/**
 * The Workspace in Robot settings (v1.21, cw-gx04) and in the Fleet (cw-hiwf): the picker lists a Host's folders through the API, walks
 * into one, and the save sends the chosen Host and folder; the Fleet row shows the Host and the root.
 */
import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type HostView, type RobotPanel, type SettingsCatalog, type SettingsPatch } from '@mr-robot/protocol'
import { AdvancedSettings } from '../src/components/AdvancedSettings.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const identity = { name: 'Coder', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const panel = (workspace: RobotPanel['settings']['workspace'] = null): RobotPanel => ({
  summary: { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false },
  settings: {
    identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }], contextBudget: 128000,
    wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: { ...emptyGrants, hosts: { 'h-desk:files': 'allow' } },
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'space' }, spaceSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, spaceReviewer: null, subagentModels: [],
    workspace,
  },
  tasks: [], screen: null, usage: { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0, breakdown: { model: { robot: 0, review: 0, subagent: 0, memory: 0 }, browser: 0, box: 0, services: 0, total: 0 }, limit: { limit: { kind: 'usd', amount: 5 }, from: 'robot' } }, canEdit: true, takeover: null,
})
const host = (id: string, name: string): HostView => ({ id, name, platform: 'linux', ownerId: 'm-1', ownerName: 'Anna', sharing: 'private', online: true, lastSeen: null, version: null, capabilities: null, mine: true, users: [] })
const catalog: SettingsCatalog = { toolGroups: [], skills: [], robots: [], secrets: [], models: [], workersAiEnabled: true, connections: [], hosts: [host('h-desk', 'Desk'), host('h-nas', 'NAS')] }

const FOLDERS: Record<string, string[]> = { '~': ['notes', 'projects'], '/home/anna/projects': ['mr.robot', 'stockroom'] }

function open(shown: RobotPanel, saved: SettingsPatch[]) {
  const asked: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/robots/r-1/hosts/h-desk/directories') {
      const path = url.searchParams.get('path') ?? '~'
      asked.push(path)
      const full = path === '~' ? '/home/anna' : path
      return Response.json({ path: full, directories: FOLDERS[path] ?? [], truncated: false })
    }
    return Response.json({ sections: [], tools: [], skills: [] })
  }))
  render(<RegistryProvider><AdvancedSettings panel={shown} catalog={catalog} onSave={async (patch) => { saved.push(patch); return true }} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
  return asked
}

describe('the Workspace picker (cw-gx04)', () => {
  it('offers the Hosts the Robot holds the files facet on, walks their folders and saves the chosen one', async () => {
    const saved: SettingsPatch[] = []
    const asked = open(panel(), saved)
    const picker = screen.getByRole('region', { name: 'Workspace' })
    expect(within(picker).getByText('None')).toBeTruthy()
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['Desk'])
    fireEvent.click(within(picker).getByRole('button', { name: 'Browse' }))
    await waitFor(() => expect(within(picker).getByRole('button', { name: 'projects/' })).toBeTruthy())
    fireEvent.click(within(picker).getByRole('button', { name: 'projects/' }))
    await waitFor(() => expect(within(picker).getByRole('button', { name: 'mr.robot/' })).toBeTruthy())
    expect(asked).toEqual(['~', '/home/anna/projects'])
    fireEvent.click(within(picker).getByRole('button', { name: 'mr.robot/' }))
    await waitFor(() => expect((within(picker).getByRole('textbox', { name: 'Workspace folder' }) as HTMLInputElement).value).toBe('/home/anna/projects/mr.robot'))
    fireEvent.click(within(picker).getByRole('button', { name: 'Use this folder' }))
    expect(within(picker).getByText('Desk: /home/anna/projects/mr.robot (checked when you save)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.workspace).toEqual({ host: 'h-desk', root: '/home/anna/projects/mr.robot' })
  })

  it('shows the Workspace the Robot has, leaves it alone on a save, and removes it on request', async () => {
    const saved: SettingsPatch[] = []
    open(panel({ hostId: 'h-desk', host: 'Desk', root: '/home/anna/repo/app', repository: '/home/anna/repo' }), saved)
    const picker = screen.getByRole('region', { name: 'Workspace' })
    expect(within(picker).getByText('Desk: /home/anna/repo/app (repository /home/anna/repo)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect('workspace' in saved[0]!).toBe(false)
    fireEvent.click(within(picker).getByRole('button', { name: 'No Workspace' }))
    // A press while it says Saved saves again.
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]!.workspace).toBeNull()
  })
})
