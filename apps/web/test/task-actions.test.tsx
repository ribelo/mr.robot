import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me, MissionView, RobotSummary, TaskView } from '@mr-robot/protocol'
import { MissionControl } from '../src/components/MissionControl.tsx'
import { TaskForm } from '../src/components/TaskSheets.tsx'

const now = Date.now()
const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, home: 'Space', timeZone: 'Europe/Warsaw', timeZonePinned: false, detectedTimeZone: 'Europe/Warsaw', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeSpace: false, drawer: false }, acceptTasksFrom: [] } as Me
const robot = (id: string, name: string, extra: Partial<RobotSummary> = {}): RobotSummary => ({ id, ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity: { name, title: '', description: '', avatarColor: '#f4a03a', avatarSeed: name }, lastLine: '', lastAt: 0, unread: false, ...extra })
const task = (id: string, title: string, extra: Partial<TaskView> = {}): TaskView => ({
  id, title, instructions: '', createdBy: { kind: 'member', memberId: 'm-1', name: 'Anna' }, assignee: { kind: 'robot', robotId: 'r-2' }, parentId: null,
  timing: { kind: 'unscheduled', deadline: null }, remind: { kind: 'none' }, state: 'open', external: null, createdAt: 0, updatedAt: 0, attempts: [], children: 0, overdue: false, ...extra,
})
const busy = robot('r-1', 'Shopper', { fleetState: 'working', turn: { wakeup: { kind: 'member', from: 'Anna' }, task: { id: 't-1', title: 'Shopping' }, activity: null, since: now } })
const view: MissionView = {
  fleet: [busy, robot('r-2', 'Accountant')], fleetNext: null,
  tasks: [task('t-1', 'Shopping', { assignee: { kind: 'robot', robotId: 'r-1' } }), task('t-2', 'Invoices', { timing: { kind: 'recurring', schedule: { kind: 'daily', time: '09:00' }, timeZone: 'Europe/Warsaw', next: now + 3_600_000, paused: false } })],
  tasksNext: null, counts: { robots: 2, working: 1, waiting: 0, openTasks: 2 },
}

interface Call { readonly method: string; readonly path: string; readonly body: unknown }
let calls: Call[]
let refuse: string | undefined

beforeEach(() => {
  calls = []
  refuse = undefined
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    const raw = init?.body
    const text = raw === undefined || raw === null ? undefined : ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname, body: text === undefined ? undefined : JSON.parse(text) })
    if (url.pathname === '/api/mission') return Response.json(view)
    if (url.pathname === '/api/members') return Response.json([{ id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' } }, { id: 'm-2', email: 'b@example.com', name: 'Ben', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' } }])
    if (url.pathname === '/api/robots') return Response.json(view.fleet)
    if (url.pathname === '/api/tasks' && method === 'GET') return Response.json({ tasks: view.tasks, next: null })
    if (url.pathname === '/api/tasks' && refuse !== undefined) return Response.json({ error: refuse }, { status: 400 })
    if (url.pathname.startsWith('/api/tasks')) return Response.json(view.tasks.find((entry) => url.pathname.includes(entry.id)) ?? view.tasks[1])
    return Response.json({ ok: true })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const posted = (path: string) => calls.filter((call) => call.method !== 'GET' && call.path === path)

describe('Mission Control row actions (v1.13 ticket 07, mc-m0jj, mc-n1aa, mc-n2bb)', () => {
  it('interrupts a working Robot from its row', async () => {
    render(<RegistryProvider><MissionControl me={me} /></RegistryProvider>)
    const fleet = await screen.findByRole('table', { name: 'Fleet' })
    fireEvent.click(within(fleet).getByRole('button', { name: 'Interrupt' }))
    await waitFor(() => expect(posted('/api/robots/r-1/interrupt')).toHaveLength(1))
    expect(location.hash).not.toContain('/r/r-1')
  })

  it('marks done, pauses, runs and assigns a Task from its menu; a Task a Robot works on can be neither run nor assigned', async () => {
    render(<RegistryProvider><MissionControl me={me} /></RegistryProvider>)
    await screen.findByRole('table', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Actions of Invoices' }))
    let menu = screen.getByRole('menu', { name: 'Actions of Invoices' })
    fireEvent.click(within(menu).getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(posted('/api/tasks/t-2/pause')[0]?.body).toEqual({ paused: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions of Invoices' }))
    menu = screen.getByRole('menu', { name: 'Actions of Invoices' })
    fireEvent.click(within(menu).getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(posted('/api/tasks/t-2/run')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Actions of Invoices' }))
    menu = screen.getByRole('menu', { name: 'Actions of Invoices' })
    await within(menu).findByRole('option', { name: 'Ben' })
    fireEvent.change(within(menu).getByRole('combobox', { name: 'Assign to' }), { target: { value: 'member:m-2' } })
    await waitFor(() => expect(posted('/api/tasks/t-2/assign')[0]?.body).toEqual({ assignee: { kind: 'member', memberId: 'm-2' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions of Invoices' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Actions of Invoices' })).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(posted('/api/tasks/t-2/done')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Actions of Shopping' }))
    menu = screen.getByRole('menu', { name: 'Actions of Shopping' })
    expect(within(menu).queryByRole('button', { name: 'Run now' })).toBeNull()
    expect((within(menu).getByRole('combobox', { name: 'Assign to' }) as HTMLSelectElement).disabled).toBe(true)
  })
})

describe('the Task form (v1.13 ticket 07, mc-n3cc)', () => {
  const form = () => render(<RegistryProvider><TaskForm onClose={() => {}} /></RegistryProvider>)

  it('offers a deadline for none and at but not for every, and a reminder only for a person with a moment', async () => {
    form()
    await screen.findByRole('option', { name: 'Ben' })
    expect(screen.getByLabelText('Deadline (optional)')).toBeTruthy()
    expect(screen.queryByLabelText('Remind')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Every' }))
    expect(screen.queryByLabelText('Deadline (optional)')).toBeNull()
    expect(screen.getByLabelText('Repeats')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'At' }))
    expect(screen.getByLabelText('Deadline (optional)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Doer'), { target: { value: 'robot:r-2' } })
    expect(screen.queryByLabelText('Remind')).toBeNull()
    fireEvent.change(screen.getByLabelText('Doer'), { target: { value: 'member:m-2' } })
    expect(screen.getByLabelText('Remind')).toBeTruthy()
  })

  it('sends what was chosen, and shows the server\'s refusal', async () => {
    form()
    await screen.findByRole('option', { name: 'Ben' })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Call mum' } })
    fireEvent.change(screen.getByLabelText('Doer'), { target: { value: 'member:m-1' } })
    fireEvent.click(screen.getByRole('radio', { name: 'At' }))
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-01-11T18:00' } })
    fireEvent.change(screen.getByLabelText('Deadline (optional)'), { target: { value: '2030-01-11T17:00' } })
    fireEvent.change(screen.getByLabelText('Remind'), { target: { value: '15' } })
    refuse = 'The deadline is before the start. Give a deadline at or after the moment the Task starts.'
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', refuse)
    expect(posted('/api/tasks')[0]!.body).toEqual({
      title: 'Call mum', instructions: '', assignee: { kind: 'member', memberId: 'm-1' }, parentId: null,
      timing: { kind: 'scheduled', at: new Date('2030-01-11T18:00').getTime(), deadline: new Date('2030-01-11T17:00').getTime() }, remind: { kind: 'before', minutes: 15 },
    })
  })
})
