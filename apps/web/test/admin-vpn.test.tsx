import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminView } from '@mr-robot/protocol'
import { Admin } from '../src/components/Admin.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const settings = {
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'off' },
  workersAiEnabled: true,
  defaultBrowserBackend: 'browser-run',
  robotSpendLimit: { kind: 'none' },
  memberSpendLimit: { kind: 'none' }, defaultReviewer: null,
  models: [{ provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextWindow: 128_000 }],
} as const
const base: AdminView = { fleet: [], robotsToMigrate: 0, members: [], skills: [], skillRepository: null, providers: [], settings }

function stubApi(view: AdminView): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request) => {
    const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname
    if (path === '/api/admin') return Response.json(view)
    if (path === '/api/home-memory') return Response.json({ content: '' })
    return Response.json([])
  }))
}

describe('the Proton VPN card in Admin (ux-t4wi)', () => {
  it('shows endpoint, server and country of the stored configuration', async () => {
    stubApi({ ...base, vpnSummary: { endpoint: '185.246.208.66:51820', serverName: 'PL#45', country: 'PL' } })
    render(<RegistryProvider><Admin /></RegistryProvider>)
    const card = within(await screen.findByRole('table', { name: 'Stored VPN' }))
    expect(card.getAllByRole('row').map((row) => row.textContent)).toEqual(['Endpoint185.246.208.66:51820', 'ServerPL#45', 'CountryPoland (PL)'])
    expect(screen.getByText('A WireGuard configuration is stored. Paste a new one to replace it.')).toBeTruthy()
  })

  it('asks for a configuration when none is stored', async () => {
    stubApi(base)
    render(<RegistryProvider><Admin /></RegistryProvider>)
    expect(await screen.findByText(/Paste the WireGuard configuration of a Proton VPN server/)).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Stored VPN' })).toBeNull()
  })
})
