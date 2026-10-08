import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RegistryProvider } from '@effect/atom-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionView, PluginView } from '@mr-robot/protocol'
import { PluginDetail, PluginsPage } from '../src/components/Plugins.tsx'
import { Connections } from '../src/components/Connections.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// A connector the web app has never heard of: its row, page and connect form come from the description.
const newcomer: PluginView = {
  name: 'notion', title: 'Notion', description: 'Pages and databases.', icon: 'notion', group: 'connector', enabled: true,
  fields: [{ key: 'workspace', label: 'Workspace name', description: 'As shown in Notion.', kind: 'text', options: [], required: true }, { key: 'apiKey', label: 'Integration secret', description: null, kind: 'secret', options: [], required: true }],
  values: { workspace: 'Home' }, secretsSet: ['apiKey'], setupNeeded: null, guide: null,
  connector: { kind: 'slack', connect: { method: 'paste', fields: [{ key: 'token', label: 'Token', description: null, kind: 'secret', options: [], required: true }], instructions: 'Paste the token from Notion.' } },
}
const files: PluginView = { ...newcomer, name: 'files', title: 'Files', description: 'Workspace files.', icon: 'folder', group: 'capability', fields: [], values: {}, secretsSet: [], connector: null }

function serve(plugins: PluginView[], connections: ConnectionView[] = []) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname
    const raw = init?.body
    calls.push({ method: init?.method ?? 'GET', path, body: raw === undefined || raw === null ? undefined : JSON.parse(ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)) })
    if (path === '/api/plugins') return Response.json(plugins)
    if (path === '/api/connections') return Response.json(connections)
    if (path.endsWith('/settings')) return Response.json(plugins[0])
    return Response.json({ ok: true })
  }))
  return calls
}

describe('plugins from their descriptions (cn-dbm9, cn-s1pd)', () => {
  it('lists every plugin with its switch, grouped, and switches one off for the admin', async () => {
    const calls = serve([files, newcomer])
    render(<RegistryProvider><PluginsPage isAdmin /></RegistryProvider>)
    expect(await screen.findByText('Notion')).toBeTruthy()
    expect(screen.getByText('Built-in')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Notion on' }))
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.path === '/api/admin/plugins/notion')).toBe(true))
    expect(calls.find((call) => call.method === 'PUT')!.body).toEqual({ enabled: false })
  })

  it('renders the detail page form from the fields; a stored secret is not sent back unless typed', async () => {
    const calls = serve([newcomer])
    render(<RegistryProvider><PluginDetail name="notion" isAdmin /></RegistryProvider>)
    const workspace = await screen.findByDisplayValue('Home')
    expect((screen.getByLabelText(/Integration secret/) as HTMLInputElement).placeholder).toBe('Stored: type to replace')
    fireEvent.change(workspace, { target: { value: 'Office' } })
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(calls.some((call) => call.path === '/api/admin/plugins/notion/settings')).toBe(true))
    expect(calls.find((call) => call.path.endsWith('/settings'))!.body).toEqual({ values: { workspace: 'Office' } })
  })

  it('gives a connector a settings row with Connect and its paste form (reference 11)', async () => {
    const calls = serve([files, newcomer])
    render(<RegistryProvider><Connections /></RegistryProvider>)
    expect(await screen.findByText('Not connected')).toBeTruthy()
    expect(screen.queryByText('Files')).toBeNull()
    fireEvent.click(screen.getByText('Connect'))
    expect(screen.getByText('Paste the token from Notion.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Token/), { target: { value: 'secret-token' } })
    fireEvent.click(screen.getAllByText('Connect').at(-1)!)
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/api/connections/slack')).toBe(true))
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({ shared: false, values: { token: 'secret-token' } })
  })
})
