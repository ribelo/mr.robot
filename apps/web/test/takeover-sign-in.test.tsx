import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RegistryProvider } from '@effect/atom-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionView, PluginView } from '@mr-robot/protocol'
import { Connections } from '../src/components/Connections.tsx'

// v1.12 ticket 11: in the PWA, Slack and Discord as you connect by signing in under a Takeover of
// Mr. Robot's browser (ux-8pek, ux-wgok, ux-j7m1, ux-jpwz).
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

const field = (key: string, label: string) => ({ key, label, description: null, kind: 'secret' as const, options: [], required: true })
const slack: PluginView = {
  name: 'slack', title: 'Slack', description: 'A Slack workspace.', icon: 'slack', group: 'connector', enabled: true, fields: [], values: {}, secretsSet: [], setupNeeded: null, guide: null,
  connectors: [{ kind: 'slack', way: 'As you', actsAsPerson: true, connect: { method: 'paste', fields: [field('token', 'Token (xoxc-…)'), field('cookie', 'Cookie d (xoxd-…)')], instructions: 'Copy the token and the cookie by hand.' } }],
}
const TITLE = "Sign in through your Robot's browser"

/** The Robot's socket as the Takeover opens it: records what the page sends; the test plays the Robot. */
class FakeSocket {
  static readonly OPEN = 1
  static readonly opened: FakeSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
    queueMicrotask(() => { this.readyState = 1; this.onopen?.() })
  }
  send(message: string): void { this.sent.push(message) }
  close(): void { this.readyState = 3 }
  robotSays(message: Record<string, unknown>): void { this.onmessage?.({ data: JSON.stringify(message) }) }
}

type Answers = { start: { status: number; body: unknown }; capture?: unknown; end: unknown }

function serve(answers: Answers) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    const raw = init?.body
    calls.push({ method, path, body: raw === undefined || raw === null ? undefined : JSON.parse(ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)) })
    if (path === '/api/plugins') return Response.json([slack])
    if (path === '/api/connections' && method === 'GET') return Response.json([] satisfies ConnectionView[])
    if (path === '/api/connections/notes') return Response.json([])
    if (path === '/api/connections/slack/browser-start') return Response.json(answers.start.body, { status: answers.start.status })
    if (path === '/api/connections/slack/browser') return Response.json(answers.capture ?? { state: 'waiting', kind: 'slack', deadline: 0 })
    if (path === '/api/connections/slack/browser-end') return Response.json(answers.end)
    return Response.json({ error: 'unexpected' }, { status: 500 })
  }))
  return calls
}

const STARTED = { status: 200, body: { robotId: 'r-chief', robotName: 'Mr. Robot' } }

async function openSignIn() {
  render(<RegistryProvider><Connections /></RegistryProvider>)
  fireEvent.click(await screen.findByText('Connect'))
  fireEvent.click(screen.getByRole('button', { name: TITLE }))
}

describe('Slack in the PWA through Mr. Robot\'s browser', () => {
  it('shows the Takeover of the sign-in page and, after hand-back, the connected account; nothing is pasted or shown', async () => {
    const calls = serve({ start: STARTED, end: { state: 'connected', kind: 'slack', account: 'acme.slack.com' } })
    render(<RegistryProvider><Connections /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Connect'))
    // The paste form stays as the fallback, folded.
    const fallback = screen.getByText('Paste a session instead').closest('details') as HTMLDetailsElement
    expect(fallback.open).toBe(false)
    expect(within(fallback).getByText('Copy the token and the cookie by hand.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: TITLE }))

    const browser = await screen.findByRole('dialog', { name: "Mr. Robot's browser" })
    expect(within(browser).getByText(/Sign in to Slack/)).toBeTruthy()
    expect(screen.getByText(/browser is open on the Slack sign-in page/)).toBeTruthy()
    expect(calls.some((call) => call.method === 'POST' && call.path === '/api/connections/slack/browser-start')).toBe(true)
    // The socket the window holds open now (the atom may open it again as it mounts).
    const socket = () => FakeSocket.opened.filter((opened) => opened.url.endsWith('/api/robots/r-chief/ws') && opened.readyState !== 3).at(-1)!
    await vi.waitFor(() => expect(socket()).toBeTruthy())
    fireEvent.click(within(browser).getByRole('button', { name: 'Take over' }))
    await vi.waitFor(() => expect(socket().sent.map((sent) => JSON.parse(sent))).toContainEqual({ type: 'claim' }))
    act(() => socket().robotSays({ type: 'claimed' }))
    fireEvent.click(await within(browser).findByRole('button', { name: 'Hand back' }))

    expect(await screen.findByText('Connected acme.slack.com.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: "Mr. Robot's browser" })).toBeNull()
    expect(calls.some((call) => call.method === 'POST' && call.path === '/api/connections/slack/browser-end')).toBe(true)
    // The server connected the session itself: the page never posts values.
    expect(calls.some((call) => call.method === 'POST' && call.path === '/api/connections/slack')).toBe(false)
  })

  it('closes the Takeover and says so when the server ends the attempt after ten minutes (ux-wgok)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve({ start: STARTED, capture: { state: 'timedOut', kind: 'slack' }, end: { state: 'timedOut', kind: 'slack' } })
    await openSignIn()
    await screen.findByRole('dialog', { name: "Mr. Robot's browser" })
    await act(async () => { await vi.advanceTimersByTimeAsync(3500) })
    expect(await screen.findByText(/No one signed in within 10 minutes, so the sign-in ended\. Nothing was connected/)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: "Mr. Robot's browser" })).toBeNull()
  })

  it('tells the person when the browser cannot open, and shows no Takeover', async () => {
    serve({ start: { status: 409, body: { error: 'Mr. Robot is working in its browser; try again when it has finished' } }, end: { state: 'none' } })
    await openSignIn()
    expect(await screen.findByText('Signing in failed: Mr. Robot is working in its browser; try again when it has finished. You can paste a session instead.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('handing back before signing in connects nothing and says why', async () => {
    serve({ start: STARTED, end: { state: 'failed', kind: 'slack', message: 'no signed-in Slack session was found in the browser' } })
    await openSignIn()
    const browser = await screen.findByRole('dialog', { name: "Mr. Robot's browser" })
    fireEvent.click(within(browser).getByRole('button', { name: 'Close and hand back' }))
    expect(await screen.findByText('Signing in failed: No signed-in Slack session was found in the browser. You can paste a session instead.')).toBeTruthy()
  })
})
