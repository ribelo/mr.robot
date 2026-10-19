import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type ComputerView, type RobotPanel } from '@mr-robot/protocol'
import { Panel } from '../src/components/Panel.tsx'

afterEach(cleanup)

const identity = { name: 'Analyst', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const panelWith = (computer?: ComputerView): RobotPanel => ({
  summary: { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false },
  settings: { identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [], contextBudget: 128000, codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants, notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'home' }, homeSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, homeReviewer: null, subagentModels: [] },
  tasks: [], screen: null, canEdit: true, takeover: null,
  usage: { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0.2, computerMinutes: 12.5, breakdown: { model: { robot: 0, review: 0, subagent: 0 }, browser: 0, computer: 0.2, services: 0, total: 0.2 }, limit: { limit: { kind: 'none' }, from: 'home' } },
  ...(computer === undefined ? {} : { computer }),
})
const handlers = { onOpenTask: vi.fn(), onEditProfile: vi.fn(), onOpenScreen: vi.fn(), onAdvanced: vi.fn(), onTrajectory: vi.fn(), onFiles: vi.fn(), onClose: vi.fn() }

describe('the Computer section of the panel (ao-9q18)', () => {
  it('shows the state; Stop while it runs calls the stop', () => {
    const onStopComputer = vi.fn()
    render(<Panel panel={panelWith({ state: 'running', since: Date.parse('2026-10-19T10:00:00Z'), lastCommandAt: Date.parse('2026-10-19T10:05:00Z') })} {...handlers} onStopComputer={onStopComputer} />)
    const section = screen.getByRole('region', { name: 'Computer' })
    expect(within(section).getByText(/^Running · since /)).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: 'Stop' }))
    expect(onStopComputer).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/12\.5 computer min/)).toBeTruthy()
  })

  it('has no Stop when off, and no section without the grant', () => {
    const { rerender } = render(<Panel panel={panelWith({ state: 'off', since: null, lastCommandAt: null })} {...handlers} onStopComputer={vi.fn()} />)
    const section = screen.getByRole('region', { name: 'Computer' })
    expect(within(section).getByText('Off')).toBeTruthy()
    expect(within(section).queryByRole('button', { name: 'Stop' })).toBeNull()
    rerender(<Panel panel={panelWith()} {...handlers} onStopComputer={vi.fn()} />)
    expect(screen.queryByRole('region', { name: 'Computer' })).toBeNull()
  })
})
