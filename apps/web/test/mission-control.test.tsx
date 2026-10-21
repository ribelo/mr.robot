import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Me, MissionView, RobotPanel, RobotSummary, TaskView } from '@mr-robot/protocol'
import { WindowedTable } from '../src/components/WindowedTable.tsx'

const now = Date.now()
const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, space: 'Space', timeZone: 'Europe/Warsaw', timeZonePinned: false, detectedTimeZone: 'Europe/Warsaw', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeSpace: false, drawer: false }, acceptTasksFrom: [] } as Me
const identity = (name: string) => ({ name, title: '', description: '', avatarColor: '#f4a03a', avatarSeed: name })
const robot = (id: string, name: string, extra: Partial<RobotSummary> = {}): RobotSummary => ({ id, ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity: identity(name), lastLine: '', lastAt: 0, unread: false, ...extra })
const task = (id: string, title: string, extra: Partial<TaskView> = {}): TaskView => ({
  id, title, instructions: '', createdBy: { kind: 'member', memberId: 'm-1', name: 'Anna' }, assignee: { kind: 'member', memberId: 'm-1' }, parentId: null,
  timing: { kind: 'unscheduled', deadline: null }, remind: { kind: 'none' }, state: 'open', external: null, createdAt: 0, updatedAt: 0, attempts: [], children: 0, overdue: false, ...extra,
})
const shopper = robot('r-1', 'Shopper', {
  fleetState: 'working', lastLine: 'Looking for milk.',
  turn: { wakeup: { kind: 'task', from: 'schedule' }, task: { id: 't-1', title: 'Shopping' }, activity: 'browser_open', since: now - 12 * 60_000 },
})
let view: MissionView = {
  fleet: [shopper, robot('r-2', 'Accountant', { lastWakeup: { wakeup: { kind: 'member', from: 'Anna' }, task: null }, lastLine: 'Invoices sent.' })],
  fleetNext: null,
  tasks: [
    task('t-1', 'Shopping', { assignee: { kind: 'robot', robotId: 'r-1' } }),
    task('t-2', 'Call mum', { overdue: true, timing: { kind: 'scheduled', at: now - 3_600_000, deadline: null } }),
    task('t-3', 'Water plants', { assignee: { kind: 'nobody' } }),
  ],
  tasksNext: null,
  counts: { robots: 2, working: 1, waiting: 0, openTasks: 3 },
}

const chief = robot('mr-1', 'Mr. Robot', { kind: 'mr-robot' })

interface Call { readonly method: string; readonly path: string; readonly body: unknown }
let calls: Call[]

beforeEach(() => {
  calls = []
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    const raw = init?.body
    const text = raw === undefined || raw === null ? undefined : ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)
    calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search, body: text === undefined ? undefined : JSON.parse(text) })
    if (url.pathname === '/api/mission') return Response.json(view)
    if (url.pathname === '/api/members') return Response.json([{ id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' } }])
    if (url.pathname === '/api/robots') return Response.json([...view.fleet, chief])
    if (url.pathname === '/api/robots/mr-1/conversation') return Response.json({ robotId: 'mr-1', items: [{ kind: 'reply', id: 'c-1', seq: 1, at: now, text: 'I added the task: call mum on Friday at six.' }], working: false })
    if (url.pathname.startsWith('/api/tasks/')) return Response.json(view.tasks.find((entry) => url.pathname.endsWith(entry.id)))
    if (url.pathname === '/api/tasks') return Response.json({ tasks: [], next: null })
    return Response.json({ ok: true })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function mission(person: Me = me) {
  const { MissionControl } = await import('../src/components/MissionControl.tsx')
  render(<RegistryProvider><MissionControl me={person} /></RegistryProvider>)
  return screen.findByRole('table', { name: 'Fleet' })
}

describe('WindowedTable (mc-m3cc)', () => {
  it('renders only the rows in the window plus a margin, and follows the scroll', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => `row ${index}`)
    render(<WindowedTable<string> label="Rows" rows={rows} rowKey={(row) => row} rowHeight={28} height={280} margin={5} columns="1fr" header={<span>Row</span>} renderRow={(row) => <span>{row}</span>} />)
    const table = screen.getByRole('table', { name: 'Rows' })
    expect(table.getAttribute('aria-rowcount')).toBe('1000')
    expect(table.querySelectorAll('.wt-row')).toHaveLength(15)
    const scroller = table.querySelector('.wt-scroll') as HTMLDivElement
    scroller.scrollTop = 28 * 500
    fireEvent.scroll(scroller)
    const shown = [...table.querySelectorAll('.wt-row')].map((row) => row.textContent)
    expect(shown[0]).toBe('row 495')
    expect(shown).toContain('row 509')
    expect(shown).not.toContain('row 0')
  })
})

describe('Mission Control (v1.13 ticket 06)', () => {
  it('shows in each Fleet row what woke the Robot, its Task, the tool and since when (mc-w1aa, mc-w2bb, mc-w6ff)', async () => {
    const fleet = await mission()
    const row = within(fleet).getByText('Shopper').closest('[role="row"]') as HTMLElement
    expect(within(row).getByText('task · schedule')).toBeTruthy()
    expect(within(row).getByText('Shopping')).toBeTruthy()
    expect(within(row).getByText('browser_open')).toBeTruthy()
    expect(within(row).getByText('12 min')).toBeTruthy()
    const idle = within(fleet).getByText('Accountant').closest('[role="row"]') as HTMLElement
    expect(within(idle).getByText('message · Anna')).toBeTruthy()
  })

  it('groups the Tasks by doer, then by time when asked, and remembers it; the state filter asks the server (mc-m5ee, mc-m6ff)', async () => {
    await mission()
    const tasks = screen.getByRole('table', { name: 'Tasks' })
    expect(await within(tasks).findByText('Anna · 1')).toBeTruthy()
    expect(await within(tasks).findByText('Shopper · 1')).toBeTruthy()
    expect(within(tasks).getByText('nobody · 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'By time' }))
    await waitFor(() => expect(within(tasks).getByText('Overdue · 1')).toBeTruthy())
    expect(calls.find((call) => call.method === 'PATCH' && call.path === '/api/me')!.body).toEqual({ mission: { group: 'time' } })
    expect((within(tasks).getByText('Call mum').closest('[role="row"]') as HTMLElement).className).toContain('wt-overdue')
    fireEvent.click(screen.getByRole('radio', { name: 'Done' }))
    await waitFor(() => expect(calls.some((call) => call.path.startsWith('/api/mission') && call.path.includes('state=done'))).toBe(true))
  })

  it('shows Whole Space only to the admin, who widens both tables with it (mc-m7gg)', async () => {
    await mission()
    expect(screen.queryByRole('switch', { name: 'Whole Space' })).toBeNull()
    cleanup()
    await mission({ ...me, role: 'admin' })
    fireEvent.click(screen.getByRole('switch', { name: 'Whole Space' }))
    await waitFor(() => expect(calls.some((call) => call.path.startsWith('/api/mission') && call.path.includes('scope=space'))).toBe(true))
  })

  it('opens a Task row in place and a Fleet row as the Robot, marked as opened from here (mc-m8hh, mc-m9ii)', async () => {
    history.replaceState(null, '', '#/mission')
    const fleet = await mission()
    fireEvent.click(within(screen.getByRole('table', { name: 'Tasks' })).getByText('Water plants'))
    expect(await screen.findByRole('dialog', { name: 'Water plants' })).toBeTruthy()
    fireEvent.click(within(fleet).getByText('Accountant'))
    await waitFor(() => expect(location.hash).toBe('#/r/r-2?from=mission'))
  })

  it('Back from a Robot opened from Mission Control goes there, also with no earlier entry in this tab (mc-m8hh)', async () => {
    history.replaceState(null, '', '#/r/r-1?from=mission')
    const { RobotConversation } = await import('../src/App.tsx')
    const conversation: Conversation = { robotId: 'r-1', items: [], working: false }
    const panel = { summary: shopper, canEdit: true } as unknown as RobotPanel
    render(<RegistryProvider><RobotConversation route={{ page: 'robot', id: 'r-1', panel: false, from: 'mission' }} me={me} robot={shopper} conversation={conversation} panel={panel} stream={null} onSheet={() => {}} /></RegistryProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(location.hash).toBe('#/mission'))
  })

  it('opens Mr. Robot in a side drawer with his Conversation and Composer, and remembers it (mc-n4dd)', async () => {
    await mission({ ...me, mission: { ...me.mission, drawer: true } })
    const drawer = await screen.findByRole('complementary', { name: 'Mr. Robot' })
    expect(await within(drawer).findByText('I added the task: call mum on Friday at six.')).toBeTruthy()
    expect(within(drawer).getByPlaceholderText('Message Mr. Robot')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mr. Robot', pressed: true }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Mr. Robot' })).toBeNull())
    expect(calls.find((call) => call.method === 'PATCH' && call.path === '/api/me')!.body).toEqual({ mission: { drawer: false } })
  })
})

describe('focus changes reach the Fleet (ao-cvpx)', () => {
  it('a working row shows the new Task once the registry has it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const before = view
    try {
      const fleet = await mission()
      await within(fleet).findByText('Shopping')
      view = { ...view, fleet: [{ ...shopper, turn: { ...shopper.turn!, task: { id: 't-9', title: 'Invoice' } } }, ...view.fleet.slice(1)] }
      await vi.advanceTimersByTimeAsync(10_000)
      await within(fleet).findByText('Invoice')
      expect(within(fleet).queryByText('Shopping')).toBeNull()
    } finally {
      view = before
      vi.useRealTimers()
    }
  })
})
