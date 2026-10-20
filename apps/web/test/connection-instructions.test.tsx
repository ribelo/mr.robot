import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RegistryProvider } from '@effect/atom-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionView, PluginView } from '@mr-robot/protocol'
import { Connections } from '../src/components/Connections.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const slack: PluginView = {
  name: 'slack', title: 'Slack', description: 'Read a Slack workspace.', icon: 'slack', group: 'connector', enabled: true,
  fields: [], values: {}, secretsSet: [], setupNeeded: null, guide: null,
  connectors: [{ kind: 'slack', way: 'As you', actsAsPerson: true, connect: { method: 'paste', fields: [{ key: 'token', label: 'Token', description: null, kind: 'secret', options: [], required: true }], instructions: 'Paste the Slack session.' } }],
}
const connection = (id: string, label: string, extra: Partial<ConnectionView> = {}): ConnectionView => ({
  id, kind: 'slack', label, account: `${label.toLowerCase()}-account`, ownerId: 'm-anna', ownerName: 'Anna', shared: false, mine: true, isDefault: true,
  services: [], status: 'connected', statusNote: null, setupLink: null, setupLabel: null, createdAt: 1, ...extra,
})

function serve(connections: ConnectionView[]) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname
    const raw = init?.body
    calls.push({ method: init?.method ?? 'GET', path, body: raw === undefined || raw === null ? undefined : JSON.parse(ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)) })
    if (path === '/api/plugins') return Response.json([slack])
    if (path === '/api/connections') return Response.json(connections)
    if (path === '/api/connections/notes') return Response.json([])
    return Response.json(connections[0])
  }))
  return calls
}

describe('Connection instructions (gb-wzl9)', () => {
  it("shows the owner's instructions in the Connection's settings and saves a change", async () => {
    const calls = serve([connection('c-1', 'Acme', { instructions: 'Answer in threads.' })])
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Manage'))
    const field = screen.getByLabelText('Instructions for Acme') as HTMLTextAreaElement
    expect(field.value).toBe('Answer in threads.')
    const save = screen.getByRole('button', { name: 'Save instructions' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'Answer in threads. Post in #ops only.' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PATCH' && call.path === '/api/connections/c-1')).toBe(true))
    expect(calls.find((call) => call.method === 'PATCH')!.body).toEqual({ instructions: 'Answer in threads. Post in #ops only.' })
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })

  it('has an empty field for a Connection without instructions, and can clear them', async () => {
    const calls = serve([connection('c-1', 'Acme', { instructions: 'Old.' }), connection('c-2', 'Beta', { isDefault: false })])
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Manage'))
    expect((screen.getByLabelText('Instructions for Beta') as HTMLTextAreaElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('Instructions for Acme'), { target: { value: '' } })
    fireEvent.click(within(screen.getByLabelText('Instructions for Acme').closest('.connection-instructions') as HTMLElement).getByRole('button', { name: 'Save instructions' }))
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(calls.find((call) => call.method === 'PATCH')!.body).toEqual({ instructions: '' })
  })

  it("shows another Member's instructions on a shared Connection, read-only", async () => {
    serve([connection('c-9', 'Bot', { mine: false, ownerName: 'Ben', shared: true, instructions: 'Reply in the channel it came from.' })])
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Manage'))
    expect(screen.getByText('Instructions: Reply in the channel it came from.')).toBeTruthy()
    expect(screen.queryByLabelText('Instructions for Bot')).toBeNull()
  })
})
