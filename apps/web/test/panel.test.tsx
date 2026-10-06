import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RobotPanel } from '@mr-robot/protocol'
import { Panel } from '../src/components/Panel.tsx'

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
    codeMode: true, compactionInstruction: '', grants: { tools: [], skills: [], recipients: [], secrets: [] },
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimitUsd: null,
  },
  routines: [{
    id: 'rt-1', robotId: 'r-1', name: 'Overnight outbound', prompt: 'Work the queue', schedule: { kind: 'weekly', time: '02:00', weekdays: [7] },
    timeZone: 'Europe/Warsaw', summary: 'Sundays at 02:00', nextRun: Date.parse('2026-10-11T00:00:00Z'), lastRun: null,
  }],
  screen: { path: 'screens/last.png', url: '/api/robots/r-1/screen', at: 0 },
  usage: { month: '2026-10', inputTokens: 12000, outputTokens: 3000, costUsd: 0.42, limitUsd: 5 },
  canEdit: true,
}

const handlers = () => ({
  onDeleteRoutine: vi.fn(), onSave: vi.fn(), onOpenScreen: vi.fn(), onAdvanced: vi.fn(), onTrajectory: vi.fn(), onClose: vi.fn(),
})

describe('Panel (robot-z3ud)', () => {
  it('shows the screen, the Routines with their next run, and lets the owner delete one', () => {
    const on = handlers()
    render(<Panel panel={panel} {...on} />)
    expect(screen.getByText('Sales Outbound’s screen')).toBeTruthy()
    expect(screen.getByText('Overnight outbound')).toBeTruthy()
    expect(screen.getByText('Sundays at 02:00')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Delete Overnight outbound'))
    expect(on.onDeleteRoutine).toHaveBeenCalledWith('rt-1')
    fireEvent.click(screen.getByLabelText("Sales Outbound's screen"))
    expect(on.onOpenScreen).toHaveBeenCalled()
  })

  it('edits the simple settings and switches notifications off (robot-r2uz)', () => {
    const on = handlers()
    render(<Panel panel={panel} {...on} />)
    fireEvent.click(screen.getByLabelText('Settings'))
    const name = screen.getByDisplayValue('Sales Outbound')
    fireEvent.change(name, { target: { value: 'Outbound' } })
    fireEvent.blur(name)
    expect(on.onSave).toHaveBeenCalledWith({ identity: expect.objectContaining({ name: 'Outbound' }) })
    fireEvent.click(screen.getByRole('switch', { name: 'Notifications' }))
    expect(on.onSave).toHaveBeenCalledWith({ notifications: { enabled: false, members: [], channels: ['pwa'] } })
  })

  it('hides editing from a Member who only shares the Robot', () => {
    render(<Panel panel={{ ...panel, canEdit: false }} {...handlers()} />)
    expect(screen.queryByLabelText('Settings')).toBeNull()
    expect(screen.queryByLabelText('Delete Overnight outbound')).toBeNull()
  })
})
