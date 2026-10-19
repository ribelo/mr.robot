import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, Conversation, Me, MissionView, RobotSummary, SubagentView } from '@mr-robot/protocol'
import { ChatView } from '../src/components/ChatView.tsx'
import { SubagentPage } from '../src/components/SubagentPage.tsx'
import { SubagentsControl } from '../src/components/SubagentsControl.tsx'
import { DelegationList } from '../src/dsh/RobotTrajectory.tsx'

const now = Date.now()
const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, home: 'Home', timeZone: 'UTC', timeZonePinned: false, detectedTimeZone: 'UTC', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeHome: false, drawer: false }, acceptTasksFrom: [] } as Me
const identity = { name: 'Researcher', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const robot: RobotSummary = { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'working', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false, subagents: [{ id: 'sa-1', label: 'Read the pages', since: now - 5 * 60_000, activity: 'web_fetch' }] }
const children: SubagentView[] = [
  { id: 'sa-1', label: 'Read the pages', mode: 'spawn', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'off' }, status: 'running', startedAt: now - 5 * 60_000, finishedAt: null, result: null, activity: 'web_fetch' },
  { id: 'sa-2', label: 'Sum the invoices', mode: 'fork', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' }, status: 'done', startedAt: now - 60 * 60_000, finishedAt: now - 50 * 60_000, result: 'Total: 1 234 PLN.', activity: null },
]
const childChat: Conversation = { robotId: 'r-1', working: true, items: [{ kind: 'message', id: 'm-1', seq: 1, at: now, sender: { kind: 'robot', robotId: 'r-1', name: 'Researcher', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }, text: 'Read the three pages.', attachments: [], reaction: null }] }

interface Call { readonly method: string; readonly path: string }
let calls: Call[]

class FakeSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  constructor(readonly url: string) {}
  send(): void {}
  close(): void {}
}

beforeEach(() => {
  calls = []
  window.location.hash = ''
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname
    calls.push({ method: init?.method ?? 'GET', path })
    if (path === '/api/robots/r-1/subagents') return Response.json(children)
    if (path === '/api/robots/r-1/subagents/sa-1/conversation') return Response.json(childChat)
    if (path === '/api/mission') return Response.json({ fleet: [robot], fleetNext: null, tasks: [], tasksNext: null, counts: { robots: 1, working: 1, waiting: 0, openTasks: 0 } } satisfies MissionView)
    if (path === '/api/robots') return Response.json([robot])
    if (path === '/api/members') return Response.json([])
    if (path === '/api/tasks') return Response.json({ tasks: [], next: null })
    return Response.json({ ok: true })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('Subagents in the PWA (ao-ce55, ao-15ui, ao-i3q9, ao-j8t9)', () => {
  it('the header says how many run and lists them; one opens #/r/:id/subagents/:child', async () => {
    render(<RegistryProvider><SubagentsControl robotId="r-1" now={now} /></RegistryProvider>)
    fireEvent.click(await screen.findByRole('button', { name: '1 Subagent' }))
    const items = within(screen.getByRole('menu', { name: 'Subagents' })).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Read the pages · deepseek-flash · working · 5 min', 'Sum the invoices · deepseek-flash · done · 1 h'])
    fireEvent.click(items[0]!)
    expect(window.location.hash).toBe('#/r/r-1/subagents/sa-1')
  })

  it('the Subagent view shows its Chat with Stop and no composer; Stop calls the interrupt', async () => {
    render(<RegistryProvider><SubagentPage robotId="r-1" child="sa-1" tab="chat" robot={robot} me={me} /></RegistryProvider>)
    expect(await screen.findByText('Read the three pages.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Trajectory' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/api/robots/r-1/subagents/sa-1/interrupt' }))
  })

  it('the Chat has one card per delegation; the Trajectory has one entry per delegation that opens the Subagent', async () => {
    const card: ChatItem = { kind: 'delegation', id: 'delegation-sa-2', seq: 4, at: now, subagentId: 'sa-2', label: 'Sum the invoices', mode: 'fork', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' }, status: 'done', result: 'Total: 1 234 PLN.' }
    render(<ChatView items={[card]} meId="m-1" robotId="r-1" working={false} canAnswer={false} />)
    const shown = screen.getByLabelText('Subagent Sum the invoices')
    expect(shown.textContent).toBe('Forked: Sum the invoices · deepseek-flash · doneTotal: 1 234 PLN.')
    expect(within(shown).getByRole('link').getAttribute('href')).toBe('#/r/r-1/subagents/sa-2')
    cleanup()

    render(<RegistryProvider><DelegationList robotId="r-1" /></RegistryProvider>)
    const entries = within(await screen.findByRole('list', { name: 'Delegations' })).getAllByRole('link')
    expect(entries.map((entry) => [entry.textContent, entry.getAttribute('href')])).toEqual([
      ['Read the pages', '#/r/r-1/subagents/sa-1/trajectory'],
      ['Sum the invoices', '#/r/r-1/subagents/sa-2/trajectory'],
    ])
  })

  it('the Fleet row says working · 1 Subagent and opens a line per Subagent with Interrupt', async () => {
    const { MissionControl } = await import('../src/components/MissionControl.tsx')
    render(<RegistryProvider><MissionControl me={me} /></RegistryProvider>)
    const fleet = await screen.findByRole('table', { name: 'Fleet' })
    fireEvent.click(await within(fleet).findByRole('button', { name: '· 1 Subagent' }))
    const line = within(screen.getByRole('list', { name: 'Subagents of Researcher' })).getByRole('listitem')
    expect(line.textContent).toContain('Read the pages')
    expect(line.textContent).toContain('web_fetch')
    fireEvent.click(within(line).getByRole('button', { name: 'Interrupt' }))
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/api/robots/r-1/subagents/sa-1/interrupt' }))
  })
})
