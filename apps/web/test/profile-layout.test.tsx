import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Profile } from '../src/components/Profile.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, space: 'Space', timeZone: 'Europe/Warsaw', timeZonePinned: false, detectedTimeZone: 'Europe/Warsaw', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeSpace: false, drawer: false }, acceptTasksFrom: [] }

const DESKTOP_SENTENCE = 'The Mr. Robot app shows notifications on this computer; quiet hours hold them until morning.'

interface Call { readonly method: string; readonly path: string; readonly body: string }

/** The profile's API with empty lists: every section can render. */
function stubFetch(calls: Call[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const path = new URL(request?.url ?? String(input), 'http://localhost').pathname
    const body = request === undefined ? (ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : typeof init?.body === 'string' ? init.body : '') : await request.clone().text()
    calls.push({ method: request?.method ?? init?.method ?? 'GET', path, body })
    if (path === '/api/providers') return Response.json({ mine: [], shared: [], models: [], defaultModel: { provider: 'deepseek', model: 'deepseek-flash', effort: 'off' }, workersAiEnabled: true })
    if (path === '/api/secrets' || path === '/api/hosts' || path === '/api/connections' || path === '/api/connections/notes' || path === '/api/plugins') return Response.json([])
    if (path.startsWith('/api/me/files/')) return Response.json({ name: decodeURIComponent(path.slice('/api/me/files/'.length)), content: '' })
    return Response.json({})
  }))
}

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
/** Whether `first` comes before `second` in the page. */
const before = (first: Element, second: Element) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('profile layout (ux-ag0j, ux-etwn, ux-bune, ux-i8ff)', () => {
  it('reads You, Costs, Appearance, Providers, Connections, Logins, Shared Pages, Hosts, the Member files and Reset everything last', async () => {
    stubFetch()
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    await screen.findByRole('heading', { name: 'Providers' })
    expect(headings()).toEqual(['You', 'Costs this month', 'Appearance', 'Providers', 'Connections', 'Logins', 'Shared Pages', 'Hosts', 'What your Robots know about you', 'Reset everything'])
    // You holds the name, the nickname, the zone, quiet hours and the notifications of this device, in that order.
    const fields = [screen.getByLabelText('Name'), screen.getByLabelText('Nickname (optional)'), screen.getByLabelText('Time zone'), screen.getByLabelText('Quiet from'), screen.getByText(/This browser cannot receive push notifications/)]
    fields.slice(1).forEach((field, index) => expect(before(fields[index]!, field)).toBe(true))
    expect(before(fields.at(-1)!, screen.getByRole('heading', { name: 'Appearance' }))).toBe(true)
    // Appearance holds the theme and the work details.
    expect(before(screen.getByRole('heading', { name: 'Appearance' }), screen.getByRole('radiogroup', { name: 'Theme' }))).toBe(true)
    expect(before(screen.getByRole('radiogroup', { name: 'Work details' }), screen.getByRole('heading', { name: 'Providers' }))).toBe(true)
    expect(screen.queryByText(DESKTOP_SENTENCE)).toBeNull()
  })

  it('in the desktop app shows one sentence under quiet hours instead of the notifications card', async () => {
    stubFetch()
    vi.stubGlobal('mrRobotHost', { nativeNotifications: true })
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    const sentence = screen.getByText(DESKTOP_SENTENCE)
    expect(before(screen.getByLabelText('until'), sentence)).toBe(true)
    expect(before(sentence, screen.getByRole('heading', { name: 'Appearance' }))).toBe(true)
    expect(screen.queryByRole('switch', { name: 'Notifications on this device' })).toBeNull()
    expect(screen.queryByText(/push notifications/)).toBeNull()
    expect(screen.queryByText(/Notifications on this computer/)).toBeNull()
  })

  it('saves the nickname with the rest of You and shows the stored one', async () => {
    const calls: Call[] = []
    stubFetch(calls)
    const view = render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    const field = screen.getByLabelText('Nickname (optional)') as HTMLInputElement
    expect(field.value).toBe('')
    expect(document.getElementById(field.getAttribute('aria-describedby')!)!.textContent).toBe('How your Robots address you.')
    fireEvent.change(field, { target: { value: 'Ania' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    const updates = () => calls.filter((call) => call.method === 'PATCH' && call.path === '/api/me')
    await waitFor(() => expect(updates()).toHaveLength(1))
    expect(JSON.parse(updates()[0]!.body)).toMatchObject({ name: 'Anna', nickname: 'Ania' })
    view.unmount()

    render(<RegistryProvider><Profile me={{ ...me, nickname: 'Ania' } as never} /></RegistryProvider>)
    expect((screen.getByLabelText('Nickname (optional)') as HTMLInputElement).value).toBe('Ania')
  })
})
