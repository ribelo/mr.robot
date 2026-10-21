import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RegistryProvider } from '@effect/atom-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionNote, ConnectionView, PluginView } from '@mr-robot/protocol'
import { PluginDetail, PluginsPage } from '../src/components/Plugins.tsx'
import { Connections } from '../src/components/Connections.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// A connector the web app has never heard of: its row, page and connect form come from the description.
const newcomer: PluginView = {
  name: 'notion', title: 'Notion', description: 'Pages and databases.', icon: 'notion', group: 'connector', enabled: true,
  fields: [{ key: 'workspace', label: 'Workspace name', description: 'As shown in Notion.', kind: 'text', options: [], required: true }, { key: 'apiKey', label: 'Integration secret', description: null, kind: 'secret', options: [], required: true }],
  values: { workspace: 'Space' }, secretsSet: ['apiKey'], setupNeeded: null, guide: null,
  connectors: [{ kind: 'slack', way: 'As you', actsAsPerson: false, connect: { method: 'paste', fields: [{ key: 'token', label: 'Token', description: null, kind: 'secret', options: [], required: true }], instructions: 'Paste the token from Notion.' } }],
}
const files: PluginView = { ...newcomer, name: 'files', title: 'Files', description: 'Workspace files.', icon: 'folder', group: 'capability', fields: [], values: {}, secretsSet: [], connectors: [] }

function serve(plugins: PluginView[], connections: ConnectionView[] = [], notes: ConnectionNote[] = []) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname
    const raw = init?.body
    calls.push({ method: init?.method ?? 'GET', path, body: raw === undefined || raw === null ? undefined : JSON.parse(ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)) })
    if (path === '/api/plugins') return Response.json(plugins)
    if (path === '/api/connections') return Response.json(connections)
    if (path === '/api/connections/notes' && (init?.method ?? 'GET') === 'GET') return Response.json(notes)
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
    const workspace = await screen.findByDisplayValue('Space')
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

describe('person connections are never shared (ux-bk91, ux-cop2, ux-ro7d)', () => {
  const tokenField = { key: 'token', label: 'Token', description: null, kind: 'secret' as const, options: [], required: true }
  const slack: PluginView = { ...newcomer, name: 'slack', title: 'Slack', description: 'A Slack workspace.', icon: 'slack', fields: [], values: {}, secretsSet: [], connectors: [{ kind: 'slack', way: 'As you', actsAsPerson: true, connect: { method: 'paste', fields: [tokenField], instructions: 'Paste the Slack session.' } }] }
  const google: PluginView = { ...newcomer, name: 'google', title: 'Google', description: 'Gmail and more.', icon: 'google', fields: [], values: {}, secretsSet: [], connectors: [{ kind: 'google', way: 'As you', actsAsPerson: true, connect: { method: 'oauth', services: [{ value: 'gmail', label: 'Gmail' }] } }] }
  const discord: PluginView = { ...newcomer, name: 'discord', title: 'Discord', description: 'A Discord bot.', icon: 'discord', fields: [], values: {}, secretsSet: [], connectors: [{ kind: 'discord', way: 'As a bot', actsAsPerson: false, connect: { method: 'paste', fields: [tokenField], instructions: 'Paste the bot token.' } }] }
  const connection = (id: string, kind: ConnectionView['kind'], label: string): ConnectionView => ({
    id, kind, label, account: `${label.toLowerCase()}-account`, ownerId: 'm-anna', ownerName: 'Anna', shared: false, mine: true, isDefault: true,
    services: [], status: 'connected', statusNote: null, setupLink: null, setupLabel: null, createdAt: 1,
  })
  const rowOf = (title: string) => screen.getByText(title).closest('.connector-row') as HTMLElement

  it('shows no "Shared with the Space" for Slack and Google, in the row or the connect form; a Discord bot keeps it', async () => {
    serve([slack, google, discord], [connection('c-slack', 'slack', 'Acme'), connection('c-bot', 'discord', 'Bot')])
    render(<RegistryProvider><Connections /></RegistryProvider>)
    await screen.findByText('Slack')
    for (const title of ['Slack', 'Discord']) fireEvent.click(within(rowOf(title)).getByText('Manage'))
    fireEvent.click(within(rowOf('Google')).getByText('Connect'))
    expect(within(rowOf('Slack')).getByText('Acme')).toBeTruthy()
    expect(within(rowOf('Slack')).getByText('Paste the Slack session.')).toBeTruthy()
    expect(within(rowOf('Slack')).queryByText('Shared with the Space')).toBeNull()
    expect(within(rowOf('Google')).getByText('Gmail')).toBeTruthy()
    expect(within(rowOf('Google')).queryByText('Shared with the Space')).toBeNull()
    expect((within(rowOf('Google')).getByText('Connect Google') as HTMLAnchorElement).href).toContain('shared=0')
    // The Discord bot: one checkbox on its row and one in its connect form.
    expect(within(rowOf('Discord')).getAllByText('Shared with the Space')).toHaveLength(2)
  })

  it('shows the note on what the update unshared and which Robots lost it, until dismissed', async () => {
    const calls = serve([slack], [connection('c-slack', 'slack', 'Acme')], [{ id: 'n-1', kind: 'slack', label: 'Acme', account: 'acme.slack.com', robots: [{ name: 'Helper', ownerName: 'Ben' }], createdAt: 1 }])
    render(<RegistryProvider><Connections /></RegistryProvider>)
    expect(await screen.findByText(/Robots of other Members lost it: Helper \(Ben\)\./)).toBeTruthy()
    expect(screen.getByText(/acts as you, so it is no longer shared with the Space/)).toBeTruthy()
    fireEvent.click(screen.getByText('Dismiss'))
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'DELETE' && call.path === '/api/connections/notes/n-1')).toBe(true))
  })
})

describe('Discord as you on the Discord row (ux-s8rx, ux-gdg3, ux-bk91, ux-cbo3)', () => {
  const tokenField = { key: 'token', label: 'Token', description: null, kind: 'secret' as const, options: [], required: true }
  const warning = 'Discord forbids automating a user account and may close it. You take that risk.'
  const discord: PluginView = {
    ...newcomer, name: 'discord', title: 'Discord', description: 'As a bot, or as you.', icon: 'discord', fields: [], values: {}, secretsSet: [],
    connectors: [
      { kind: 'discord', way: 'As a bot', actsAsPerson: false, connect: { method: 'paste', fields: [tokenField], instructions: 'Paste the bot token.' } },
      { kind: 'discord-user', way: 'As you', actsAsPerson: true, connect: { method: 'paste', fields: [{ ...tokenField, label: 'User token' }], instructions: 'Copy the token from Discord in the browser.', warning } },
    ],
  }
  const rowOf = () => screen.getByText('Discord').closest('.connector-row') as HTMLElement
  const wayOf = (way: string) => within(rowOf()).getByText(way).closest('.connector-way') as HTMLElement

  it('shows both ways with their own Connect; the as-you form carries the warning and no "Shared with the Space"', async () => {
    const calls = serve([discord])
    render(<RegistryProvider><Connections /></RegistryProvider>)
    await screen.findByText('Discord')
    expect(within(rowOf()).getAllByText('Not connected')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Connect Discord as a bot' }))
    expect(within(wayOf('As a bot')).getByText('Paste the bot token.')).toBeTruthy()
    expect(within(wayOf('As a bot')).getByText('Shared with the Space')).toBeTruthy()
    expect(within(wayOf('As a bot')).queryByText(warning)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connect Discord as you' }))
    const asYou = wayOf('As you')
    expect(within(asYou).getByText('Copy the token from Discord in the browser.')).toBeTruthy()
    // The sign-in way and the folded paste form both carry it.
    expect(within(asYou).getAllByText(warning).length).toBeGreaterThan(0)
    expect(within(asYou).queryByText('Shared with the Space')).toBeNull()
    fireEvent.change(within(asYou).getByLabelText(/User token/), { target: { value: 'user-token' } })
    fireEvent.click(within(asYou).getAllByText('Connect').at(-1)!)
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/api/connections/discord-user')).toBe(true))
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({ shared: false, values: { token: 'user-token' } })
  })

  it('a refused as-you connection says "Sign in again"; a refused bot says "Paste again"', async () => {
    const refused = (id: string, kind: ConnectionView['kind'], label: string): ConnectionView => ({
      id, kind, label, account: label.toLowerCase(), ownerId: 'm-anna', ownerName: 'Anna', shared: false, mine: true, isDefault: true,
      services: [], status: 'rejected', statusNote: 'Discord refused the token', setupLink: null, setupLabel: null, createdAt: 1,
    })
    serve([discord], [refused('c-me', 'discord-user', 'Anna'), refused('c-bot', 'discord', 'Bot')])
    render(<RegistryProvider><Connections /></RegistryProvider>)
    await screen.findByText('Discord')
    expect(within(wayOf('As you')).getByText('Sign in again')).toBeTruthy()
    expect(within(wayOf('As a bot')).getByText('Paste again')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage Discord as you' }))
    expect(within(wayOf('As you')).getByText('Sign in again: Discord refused the token')).toBeTruthy()
    expect(within(wayOf('As you')).queryByText('Shared with the Space')).toBeNull()
  })
})
