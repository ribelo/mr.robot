import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RegistryProvider } from '@effect/atom-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionView, PluginView } from '@mr-robot/protocol'
import { Connections } from '../src/components/Connections.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const field = (key: string, label: string) => ({ key, label, description: null, kind: 'secret' as const, options: [], required: true })
const base: PluginView = { name: 'slack', title: 'Slack', description: 'A Slack workspace.', icon: 'slack', group: 'connector', enabled: true, fields: [], values: {}, secretsSet: [], setupNeeded: null, guide: null, connectors: [] }
const slack: PluginView = { ...base, connectors: [{ kind: 'slack', way: 'As you', actsAsPerson: true, connect: { method: 'paste', fields: [field('token', 'Token (xoxc-…)'), field('cookie', 'Cookie d (xoxd-…)')], instructions: 'Copy the token and the cookie by hand.' } }] }
const warning = 'Discord forbids automating a user account and may close it. You take that risk.'
const discord: PluginView = {
  ...base, name: 'discord', title: 'Discord', description: 'As a bot, or as you.', icon: 'discord',
  connectors: [
    { kind: 'discord', way: 'As a bot', actsAsPerson: false, connect: { method: 'paste', fields: [field('token', 'Bot token')], instructions: 'Paste the bot token.' } },
    { kind: 'discord-user', way: 'As you', actsAsPerson: true, connect: { method: 'paste', fields: [field('token', 'User token')], instructions: 'Copy the token from Discord in the browser.', warning } },
  ],
}
const connection = (kind: ConnectionView['kind'], overrides: Partial<ConnectionView> = {}): ConnectionView => ({
  id: `c-${kind}`, kind, label: 'Anna', account: 'acme.slack.com', ownerId: 'm-anna', ownerName: 'Anna', shared: false, mine: true, isDefault: true,
  services: [], status: 'connected', statusNote: null, setupLink: null, setupLabel: null, createdAt: 1, ...overrides,
})

function serve(plugins: PluginView[], connections: ConnectionView[] = [], refuse = false) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    const raw = init?.body
    calls.push({ method, path, body: raw === undefined || raw === null ? undefined : JSON.parse(ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)) })
    if (path === '/api/plugins') return Response.json(plugins)
    if (path === '/api/connections' && method === 'GET') return Response.json(connections)
    if (path === '/api/connections/notes') return Response.json([])
    if (method === 'POST') return refuse ? Response.json({ error: 'Slack refused the session' }, { status: 400 }) : Response.json(connection('slack'))
    return Response.json({ ok: true })
  }))
  return calls
}

const posts = (calls: Array<{ method: string; path: string; body: unknown }>) => calls.filter((call) => call.method === 'POST')
const bridge = (connectThroughSignIn: (kind: string) => Promise<unknown>) => vi.stubGlobal('mrRobotHost', { connectThroughSignIn })

describe('Slack and Discord as you in the desktop app (ux-taxm, ux-66a4, ux-wgok, ux-jpwz, ux-j7m1)', () => {
  it('Slack: "Sign in to Slack" runs the window and posts the returned values as the paste form would; they are never shown', async () => {
    const calls = serve([slack])
    const open = vi.fn(async () => ({ values: { token: 'xoxc-secret-token', cookie: 'xoxd-secret-cookie' } }))
    bridge(open)
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Connect'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }))
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(open).toHaveBeenCalledWith('slack')
    expect(posts(calls)[0]).toMatchObject({ path: '/api/connections/slack', body: { shared: false, values: { token: 'xoxc-secret-token', cookie: 'xoxd-secret-cookie' } } })
    expect(await screen.findByText('Connected acme.slack.com.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('xoxc-secret-token')
    expect(document.body.textContent).not.toContain('xoxd-secret-cookie')
  })

  it('keeps the paste form under "Paste a session instead", and it still posts', async () => {
    const calls = serve([slack])
    bridge(async () => ({ cancelled: true }))
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Connect'))
    const fallback = screen.getByText('Paste a session instead').closest('details') as HTMLDetailsElement
    expect(fallback.open).toBe(false)
    expect(within(fallback).getByText('Copy the token and the cookie by hand.')).toBeTruthy()
    fireEvent.change(within(fallback).getByLabelText(/Token/), { target: { value: 'xoxc-by-hand' } })
    fireEvent.change(within(fallback).getByLabelText(/Cookie/), { target: { value: 'xoxd-by-hand' } })
    fireEvent.click(within(fallback).getByText('Connect'))
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0]!.body).toEqual({ shared: false, values: { token: 'xoxc-by-hand', cookie: 'xoxd-by-hand' } })
  })

  it('says the window is open while it waits, and the button stays off', async () => {
    serve([slack])
    let finish: (answer: unknown) => void = () => undefined
    bridge(() => new Promise((done) => { finish = done }))
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Connect'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }))
    expect(await screen.findByText(/The sign-in window is open/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sign in to Slack' }) as HTMLButtonElement).disabled).toBe(true)
    finish({ cancelled: true })
    expect(await screen.findByText(/The sign-in window was closed/)).toBeTruthy()
  })

  it.each([
    ['timed out', { timedOut: true }, /within 10 minutes/],
    ['closed by the person', { cancelled: true }, /window was closed\. Nothing was connected/],
    ['failed in the app', { error: 'A sign-in window is already open.' }, /Signing in failed: A sign-in window is already open\./],
    ['without every field', { values: { token: 'xoxc-only' } }, /did not give everything/],
  ])('%s: tells the person and posts nothing', async (_name, answer, text) => {
    const calls = serve([slack])
    bridge(async () => answer)
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Connect'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }))
    expect(await screen.findByText(text)).toBeTruthy()
    expect(posts(calls)).toHaveLength(0)
  })

  it('says so when the server refuses the values', async () => {
    const calls = serve([slack], [], true)
    bridge(async () => ({ values: { token: 'xoxc-a', cookie: 'xoxd-b' } }))
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Connect'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }))
    expect(await screen.findByText(/Signing in worked, but connecting failed/)).toBeTruthy()
    expect(posts(calls)).toHaveLength(1)
    expect(document.body.textContent).not.toContain('xoxc-a')
  })

  it('Discord as you: the sign-in button and warning sit on that way; the bot way keeps the paste form only', async () => {
    const calls = serve([discord])
    bridge(async () => ({ values: { token: 'discord-secret' } }))
    render(<RegistryProvider><Connections /></RegistryProvider>)
    await screen.findByText('Discord')
    fireEvent.click(screen.getByRole('button', { name: 'Connect Discord as a bot' }))
    expect(screen.queryByRole('button', { name: 'Sign in to Discord' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connect Discord as you' }))
    expect(screen.getAllByText(warning).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Discord' }))
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0]).toMatchObject({ path: '/api/connections/discord-user', body: { shared: false, values: { token: 'discord-secret' } } })
  })

  it('"Sign in again" on a refused connection runs the same window and posts again', async () => {
    const calls = serve([discord], [connection('discord-user', { status: 'rejected', statusNote: 'Discord refused the token' })])
    const open = vi.fn(async () => ({ values: { token: 'fresh-token' } }))
    bridge(open)
    render(<RegistryProvider><Connections /></RegistryProvider>)
    await screen.findByText('Discord')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Discord as you' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(open).toHaveBeenCalledWith('discord-user')
    expect(posts(calls)[0]).toMatchObject({ path: '/api/connections/discord-user', body: { shared: false, values: { token: 'fresh-token' } } })
  })

  it('an older desktop app without the command also shows only the paste form', async () => {
    serve([slack])
    vi.stubGlobal('mrRobotHost', { nativeNotifications: true })
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Connect'))
    expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull()
    expect(screen.getByText('Copy the token and the cookie by hand.')).toBeTruthy()
  })
})
