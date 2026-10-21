import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type AdminView, type CostBreakdown, type Me, type MemberCosts, type RobotPanel } from '@mr-robot/protocol'
import { Admin } from '../src/components/Admin.tsx'
import { Panel } from '../src/components/Panel.tsx'
import { Profile } from '../src/components/Profile.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const breakdown: CostBreakdown = { model: { robot: 1.2, review: 0.1, subagent: 0.3, memory: 0 }, browser: 0.09, box: 0.05, services: 0.25, total: 1.99 }
const identity = { name: 'Sales', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const summary = { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false } as const
const usage = { month: '2026-10', inputTokens: 1000, outputTokens: 100, costUsd: 1.99, breakdown, limit: { limit: { kind: 'usd', amount: 5 }, from: 'robot' } } as const
const panel = {
  summary,
  settings: { identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [], contextBudget: 128000, codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants, notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'space' }, spaceSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, spaceReviewer: null, subagentModels: [] },
  tasks: [], screen: null, usage, canEdit: true, takeover: null,
} as unknown as RobotPanel
const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, space: 'Space', timeZone: 'UTC', timeZonePinned: false, detectedTimeZone: 'UTC', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeSpace: false, drawer: false }, acceptTasksFrom: [] } as unknown as Me
const costs: MemberCosts = { month: '2026-10', breakdown, limit: { kind: 'usd', amount: 50 }, byRobot: [{ robotId: 'r-1', name: 'Sales', breakdown }] }

/** The rows of a breakdown table as [label, amount]. */
const rowsOf = (table: HTMLElement) => within(table).getAllByRole('row').map((row) => [within(row).getByRole('rowheader').textContent, row.querySelector('td')?.textContent])

const EXPECTED = [['Model', '$1.60'], ['Robot', '$1.20'], ['Auto review', '$0.10'], ['Subagents', '$0.30'], ['Browser', '$0.09'], ['Box', '$0.05'], ['Services', '$0.25'], ['Total', '$1.99']]

describe('cost by source in the PWA (ao-zbld, ao-ef5t, ao-ypas)', () => {
  it('the Robot panel shows each source and the total', () => {
    render(<Panel panel={panel} onOpenTask={vi.fn()} onEditProfile={vi.fn()} onOpenScreen={vi.fn()} onAdvanced={vi.fn()} onTrajectory={vi.fn()} onFiles={vi.fn()} onClose={vi.fn()} />)
    expect(rowsOf(screen.getByRole('table', { name: 'Cost in 2026-10' }))).toEqual(EXPECTED)
  })

  it('the Profile shows the Member\'s own month by source, the limit and each Robot', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('fetch', vi.fn(async (input: string | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname
      return path === '/api/me/costs' ? Response.json(costs) : Response.json(path === '/api/providers' ? { mine: [], shared: [], models: [], defaultModel: { provider: 'deepseek', model: 'deepseek-chat', effort: 'medium' }, workersAiEnabled: true } : [])
    }))
    render(<RegistryProvider><Profile me={me} /></RegistryProvider>)
    expect(rowsOf(await screen.findByRole('table', { name: 'Your cost in 2026-10' }))).toEqual(EXPECTED)
    expect(screen.getByText('Limit: $50.00 a month')).toBeTruthy()
    expect(screen.getByText(/^Sales: \$1\.99/)).toBeTruthy()
  })

  it('Admin shows the total and the sources of each Robot and Member', async () => {
    const view = {
      fleet: [{ ...summary, grants: emptyGrants, model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, usage }],
      robotsToMigrate: 0,
      members: [{ id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, usage: { ...usage, limit: { limit: { kind: 'none' }, from: 'space' } } }],
      skills: [], skillRepository: null, providers: [],
      settings: { defaultModel: { provider: 'deepseek', model: 'deepseek-flash', effort: 'off' }, workersAiEnabled: true, defaultBrowserBackend: 'browser-run', robotSpendLimit: { kind: 'none' }, memberSpendLimit: { kind: 'none' }, defaultReviewer: null, models: [] },
    } as unknown as AdminView
    vi.stubGlobal('fetch', vi.fn(async (input: string | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname
      return path === '/api/admin' ? Response.json(view) : path === '/api/space-memory' ? Response.json({ content: '' }) : Response.json([])
    }))
    render(<RegistryProvider><Admin /></RegistryProvider>)
    const lines = await screen.findAllByText('model $1.60 · browser $0.09 · box $0.05 · services $0.25')
    expect(lines).toHaveLength(2)
    expect(screen.getAllByText('$1.99')).toHaveLength(2)
  })
})
