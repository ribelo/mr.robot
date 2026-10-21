import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { Profile } from '../src/components/Profile.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, home: 'Space', timeZone: 'America/New_York', timeZonePinned: false, detectedTimeZone: 'America/New_York', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeSpace: false, drawer: false }, acceptTasksFrom: [] }

interface Call { readonly method: string; readonly path: string; readonly body: string; readonly zone: string | null }

function stubFetch(calls: Call[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const url = request?.url ?? String(input)
    const headers = new Headers(request?.headers ?? init?.headers)
    const body = request === undefined ? (ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : typeof init?.body === 'string' ? init.body : '') : await request.clone().text()
    calls.push({ method: request?.method ?? init?.method ?? 'GET', path: new URL(url, 'http://localhost').pathname, body, zone: headers.get('x-time-zone') })
    return Response.json({})
  }))
}
const updates = (calls: Call[]) => calls.filter((call) => call.method === 'PATCH' && call.path === '/api/me')

describe('time zone on the profile (sk-vpxv, sk-y38c)', () => {
  it('sends the zone of the app with the request for the person', async () => {
    const calls: Call[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : undefined
      const headers = new Headers(request?.headers ?? init?.headers)
      const path = new URL(request?.url ?? String(input), 'http://localhost').pathname
      calls.push({ method: 'GET', path, body: '', zone: headers.get('x-time-zone') })
      return Response.json(path === '/api/me' ? me : path === '/api/robots' ? [] : {})
    }))
    render(<RegistryProvider><App /></RegistryProvider>)
    await waitFor(() => expect(calls.some((call) => call.path === '/api/me')).toBe(true))
    expect(calls.find((call) => call.path === '/api/me')!.zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('shows the detected zone and saves without pinning when the field was not touched', async () => {
    const calls: Call[] = []
    stubFetch(calls)
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    expect(screen.getByText(/This app reports America\/New_York/)).toBeTruthy()
    expect(screen.getByText(/Your zone follows the app/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: "Use the app's zone" })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(JSON.parse(updates(calls)[0]!.body)).not.toHaveProperty('timeZone')
  })

  it('a zone typed in the field is sent; a pinned zone offers "Use the app\'s zone"', async () => {
    const calls: Call[] = []
    stubFetch(calls)
    const view = render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Asia/Tokyo' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(JSON.parse(updates(calls)[0]!.body)).toMatchObject({ timeZone: 'Asia/Tokyo' })
    view.unmount()

    calls.length = 0
    render(<RegistryProvider><Profile me={{ ...me, timeZone: 'Asia/Tokyo', timeZonePinned: true } as never} /></RegistryProvider>)
    expect(screen.getByText(/You set your zone by hand/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "Use the app's zone" }))
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(JSON.parse(updates(calls)[0]!.body)).toEqual({ useDetectedTimeZone: true })
    await waitFor(() => expect((screen.getByLabelText('Time zone') as HTMLInputElement).value).toBe('America/New_York'))
  })
})
