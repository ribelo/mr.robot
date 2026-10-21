import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RobotSummary } from '@mr-robot/protocol'
import { Profile } from '../src/components/Profile.tsx'
import { RobotList } from '../src/components/RobotList.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const robot: RobotSummary = {
  id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null,
  identity: { name: 'Bills', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }, lastLine: '', lastAt: 0, unread: false,
}

function list() {
  const calls: Array<{ method: string; path: string; body: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const body = request === undefined ? (ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : typeof init?.body === 'string' ? init.body : '') : await request.clone().text()
    calls.push({ method: request?.method ?? init?.method ?? 'GET', path: new URL(request?.url ?? String(input), 'http://localhost').pathname, body })
    return Response.json({ ok: true })
  }))
  render(
    <RegistryProvider>
      <RobotList robots={[robot]} selected={undefined} meName="Anna" meAvatar={{ kind: 'initials', color: '#6c63ff' }} isAdmin={false} meId="m-1" onSelect={vi.fn()} onCreate={vi.fn()} onAdmin={vi.fn()} onProfile={vi.fn()} groups={[]} onGroupChange={async () => true} onListPref={vi.fn()} onEditProfile={vi.fn()} onAdvanced={vi.fn()} onFiles={vi.fn()} />
    </RegistryProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Bills menu' }))
  return calls
}

describe('Clear history and Start over in the robot list (sk-8won)', () => {
  it('offers both; Start over says what is reset, needs the typed name and has no memory option', async () => {
    const calls = list()
    expect(screen.getByRole('menuitem', { name: 'Clear history…' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start over…' }))
    const dialog = screen.getByRole('dialog', { name: 'Start Bills over' })
    expect(within(dialog).getByText(/every file in its workspace goes back to the templates/)).toBeTruthy()
    expect(within(dialog).getByText(/Its settings, grants, connections and Tasks stay/)).toBeTruthy()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    const action = within(dialog).getByRole('button', { name: 'Start over' }) as HTMLButtonElement
    expect(action.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Bills' } })
    expect(action.disabled).toBe(false)
    fireEvent.click(action)
    await waitFor(() => expect(calls.find((call) => call.path === '/api/robots/r-1/start-over')).toBeTruthy())
    expect(JSON.parse(calls.find((call) => call.path === '/api/robots/r-1/start-over')!.body)).toEqual({ confirm: 'Bills' })
  })

  it('Clear history clears the Conversation only: its files stay, and there is no memory option', async () => {
    const calls = list()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear history…' }))
    const dialog = screen.getByRole('dialog', { name: "Clear Bills's history" })
    expect(within(dialog).getByText(/all its files stay/)).toBeTruthy()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Bills' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear history' }))
    await waitFor(() => expect(calls.find((call) => call.path === '/api/robots/r-1/clear')).toBeTruthy())
    expect(JSON.parse(calls.find((call) => call.path === '/api/robots/r-1/clear')!.body)).toEqual({ confirm: 'Bills' })
  })
})

describe('Reset everything dialog (sk-gf2e)', () => {
  it('says what is kept: logins, Provider accounts, Hosts, the skill library and Space settings', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, home: 'Space', timeZone: 'UTC', timeZonePinned: false, detectedTimeZone: 'UTC', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeSpace: false, drawer: false }, acceptTasksFrom: [] }
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Reset everything…' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset everything' })
    expect(within(dialog).getByText('Kept: logins, Provider accounts, Hosts, the skill library and Space settings.')).toBeTruthy()
  })
})
