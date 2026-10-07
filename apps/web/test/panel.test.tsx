import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RobotPanel } from '@mr-robot/protocol'
import { Panel } from '../src/components/Panel.tsx'
import { EditProfileSheet, RoutineSheet } from '../src/components/RobotSheets.tsx'

afterEach(cleanup)

const panel: RobotPanel = {
  summary: {
    id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping',
    identity: { name: 'Sales Outbound', title: 'Sales', description: 'Works the pipeline overnight.', avatarColor: '#f4a03a' },
    lastLine: 'Done.', lastAt: 0, unread: false,
  },
  settings: {
    identity: { name: 'Sales Outbound', title: 'Sales', description: 'Works the pipeline overnight.', avatarColor: '#f4a03a' },
    sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, contextBudget: 128000,
    codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: { tools: [], skills: [], recipients: [], secrets: [] },
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimitUsd: null,
  },
  routines: [{
    id: 'rt-1', robotId: 'r-1', name: 'Overnight outbound', prompt: 'Work the queue', schedule: { kind: 'weekly', time: '02:00', weekdays: [7] },
    timeZone: 'Europe/Warsaw', summary: 'Sundays at 02:00', nextRun: Date.parse('2026-10-11T00:00:00Z'), lastRun: null,
    paused: false, cron: 'CRON_TZ=Europe/Warsaw 0 2 * * 0', runs: [{ at: Date.parse('2026-10-04T00:00:00Z'), outcome: 'done', summary: 'Queue worked: 12 leads.' }],
  }],
  screen: { path: 'screens/last.png', url: '/api/robots/r-1/screen', at: 0 },
  usage: { month: '2026-10', inputTokens: 12000, outputTokens: 3000, costUsd: 0.42, limitUsd: 5 },
  canEdit: true,
  takeover: null,
}

const handlers = () => ({
  onOpenRoutine: vi.fn(), onEditProfile: vi.fn(), onOpenScreen: vi.fn(), onAdvanced: vi.fn(), onTrajectory: vi.fn(), onClose: vi.fn(),
})

describe('Panel (robot-z3ud)', () => {
  it('shows the screen and the Routines; a Routine opens its detail, ⚙ opens the profile', () => {
    const on = handlers()
    render(<Panel panel={panel} {...on} />)
    expect(screen.getByText('Sales Outbound’s screen')).toBeTruthy()
    expect(screen.getByText('Sundays at 02:00')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    fireEvent.click(screen.getByText('Overnight outbound'))
    expect(on.onOpenRoutine).toHaveBeenCalledWith('rt-1')
    fireEvent.click(screen.getByLabelText('Edit profile'))
    expect(on.onEditProfile).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText("Sales Outbound's screen"))
    expect(on.onOpenScreen).toHaveBeenCalled()
  })

  it('hides editing from a Member who only shares the Robot', () => {
    render(<Panel panel={{ ...panel, canEdit: false }} {...handlers()} />)
    expect(screen.queryByLabelText('Edit profile')).toBeNull()
  })
})

describe('Robot sheets (robot-lulc, robot-l3gr, robot-qhll)', () => {
  const serve = () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
      if (path.endsWith('/panel')) return Response.json(panel)
      return Response.json({ ok: true })
    }))
    return calls
  }

  it('the routine detail shows schedule, cron, status, instructions and runs, and pauses', async () => {
    const calls = serve()
    render(<RoutineSheet robotId="r-1" routineId="rt-1" canEdit onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(await screen.findByText('Work the queue')).toBeTruthy()
    expect(screen.getByText('CRON_TZ=Europe/Warsaw 0 2 * * 0')).toBeTruthy()
    expect(screen.getByText('Queue worked: 12 leads.')).toBeTruthy()
    fireEvent.click(screen.getByText('Pause'))
    await vi.waitFor(() => expect(calls.some((call) => call.path === '/api/robots/r-1/routines/rt-1/pause')).toBe(true))
    expect(calls.find((call) => call.path.endsWith('/pause'))!.body).toEqual({ paused: true })
    vi.unstubAllGlobals()
  })

  it('edit profile saves name and notifications together', async () => {
    const calls = serve()
    const changed = vi.fn()
    render(<EditProfileSheet robotId="r-1" onClose={vi.fn()} onChanged={changed} onOpenRoutine={vi.fn()} />)
    fireEvent.change(await screen.findByDisplayValue('Sales Outbound'), { target: { value: 'Outbound' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Notifications' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Wake on screen notifications' }))
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(calls.find((call) => call.method === 'PATCH')!.body).toMatchObject({ identity: { name: 'Outbound' }, notifications: { enabled: false }, wakeOnScreenNotifications: true })
    vi.unstubAllGlobals()
  })
})
