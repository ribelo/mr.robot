/**
 * Spend limit forms (v1.12 ticket 05): segmented choices in Home settings (No limit / Amount) and in a
 * Robot's Advanced settings (Home's / No limit / Amount), the amount field only for Amount, and the
 * Robot's limit in effect.
 */
import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type AdminView, type FleetRow, type RobotPanel, type SettingsCatalog, type SettingsPatch } from '@mr-robot/protocol'
import { Admin } from '../src/components/Admin.tsx'
import { AdvancedSettings } from '../src/components/AdvancedSettings.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const identity = { name: 'Sales Outbound', title: 'Sales', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const summary = { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false } as const
const usage = (limit: FleetRow['usage']['limit']) => ({ month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0, breakdown: { model: { robot: 0, review: 0, subagent: 0 }, browser: 0, box: 0, services: 0, total: 0 }, limit })

const segmentOf = (name: string) => screen.getByRole('radiogroup', { name }).querySelector('[aria-checked="true"]')?.textContent
const choose = (group: string, segment: string) => fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: segment }))

describe('Home spend limits in Admin (ux-dbx4, ux-en86)', () => {
  const view: AdminView = {
    fleet: [
      { ...summary, grants: emptyGrants, model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, usage: usage({ limit: { kind: 'usd', amount: 20 }, from: 'home' }) },
      { ...summary, id: 'r-2', identity: { ...identity, name: 'Ledger' }, grants: emptyGrants, model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, usage: usage({ limit: { kind: 'usd', amount: 50 }, from: 'robot' }) },
      { ...summary, id: 'r-3', identity: { ...identity, name: 'Free' }, grants: emptyGrants, model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, usage: usage({ limit: { kind: 'none' }, from: 'robot' }) },
    ],
    robotsToMigrate: 0, members: [], skills: [], skillRepository: null, providers: [],
    settings: { defaultModel: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, workersAiEnabled: true, defaultBrowserBackend: 'browser-run', robotSpendLimit: { kind: 'usd', amount: 20 }, memberSpendLimit: { kind: 'none' }, defaultReviewer: null, models: [] },
  }
  const patches: unknown[] = []
  const openAdmin = async () => {
    patches.length = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : undefined
      const method = request?.method ?? init?.method ?? 'GET'
      const path = new URL(request?.url ?? String(input), 'http://localhost').pathname
      if (path === '/api/admin') return Response.json(view)
      if (path === '/api/home-memory') return Response.json({ content: '' })
      if (method === 'PATCH' && path === '/api/admin/settings') {
        const body = JSON.parse(request === undefined ? (ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : String(init?.body)) : await request.clone().text()) as Record<string, unknown>
        patches.push(body)
        return Response.json({ ...view.settings, ...body })
      }
      return Response.json([])
    }))
    render(<RegistryProvider><Admin /></RegistryProvider>)
    await screen.findByRole('radiogroup', { name: 'Spend limit per Robot' })
  }
  const actions = () => screen.getByRole('radiogroup', { name: 'Spend limit per Member' }).closest('.form')!.nextElementSibling as HTMLElement
  const save = () => fireEvent.click(within(actions()).getByRole('button', { name: 'Save' }))

  it('shows No limit or Amount, with the amount field only for Amount, and saves typed limits', async () => {
    await openAdmin()
    expect(segmentOf('Spend limit per Robot')).toBe('Amount')
    expect((screen.getByLabelText('Spend limit per Robot, USD per month') as HTMLInputElement).value).toBe('20')
    expect(segmentOf('Spend limit per Member')).toBe('No limit')
    expect(screen.queryByLabelText('Spend limit per Member, USD per month')).toBeNull()
    expect(within(screen.getByRole('radiogroup', { name: 'Spend limit per Member' })).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['No limit', 'Amount'])

    choose('Spend limit per Member', 'Amount')
    fireEvent.change(screen.getByLabelText('Spend limit per Member, USD per month'), { target: { value: '75' } })
    choose('Spend limit per Robot', 'No limit')
    expect(screen.queryByLabelText('Spend limit per Robot, USD per month')).toBeNull()
    save()
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toMatchObject({ robotSpendLimit: { kind: 'none' }, memberSpendLimit: { kind: 'usd', amount: 75 }, defaultReviewer: null })
  })

  it('does not send an amount below 1 or with cents, and says what it must be', async () => {
    await openAdmin()
    for (const typed of ['0', '2.5', '']) {
      fireEvent.change(screen.getByLabelText('Spend limit per Robot, USD per month'), { target: { value: typed } })
      expect(screen.getByText('The amount is whole dollars, at least 1.')).toBeTruthy()
      save()
      // Refused at once: the button is back at Save.
      await waitFor(() => within(actions()).getByRole('button', { name: 'Save' }))
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(patches).toEqual([])
  })

  it('shows the limit in effect in the fleet table', async () => {
    await openAdmin()
    const rows = screen.getAllByRole('row').slice(1).map((row) => row.querySelectorAll('td')[6]?.textContent)
    expect(rows.slice(0, 3)).toEqual(['$20 (Home)', '$50', 'no limit'])
  })
})

describe("a Robot's spend limit in Advanced settings (ux-q8ve, ux-en86)", () => {
  const panel: RobotPanel = {
    summary,
    settings: {
      identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }], contextBudget: 128000,
      codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants,
      notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'home' }, homeSpendLimit: { kind: 'usd', amount: 20 }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, homeReviewer: null, subagentModels: [],
    },
    tasks: [], screen: null, usage: usage({ limit: { kind: 'usd', amount: 20 }, from: 'home' }), canEdit: true, takeover: null,
  }
  const catalog: SettingsCatalog = { toolGroups: [], skills: [], robots: [], secrets: [], models: [], workersAiEnabled: true }

  it("offers Home's, No limit and Amount, shows the limit in effect, and saves the choice", async () => {
    const saved: SettingsPatch[] = []
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
    render(<RegistryProvider><AdvancedSettings panel={panel} catalog={catalog} onSave={async (patch) => { saved.push(patch); return true }} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
    const group = screen.getByRole('radiogroup', { name: 'Monthly spend limit' })
    expect(within(group).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(["Home's", 'No limit', 'Amount'])
    expect(segmentOf('Monthly spend limit')).toBe("Home's")
    expect(screen.queryByLabelText('Monthly spend limit, USD per month')).toBeNull()
    expect(screen.getByText('In effect: $20 (Home)')).toBeTruthy()

    choose('Monthly spend limit', 'No limit')
    expect(screen.getByText('In effect: no limit')).toBeTruthy()
    choose('Monthly spend limit', 'Amount')
    fireEvent.change(screen.getByLabelText('Monthly spend limit, USD per month'), { target: { value: '50' } })
    expect(screen.getByText('In effect: $50')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.spendLimit).toEqual({ kind: 'usd', amount: 50 })

    fireEvent.change(screen.getByLabelText('Monthly spend limit, USD per month'), { target: { value: '0' } })
    expect(screen.getByText('The amount is whole dollars, at least 1.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(saved).toHaveLength(1)
  })
})
