import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type BoxView, type RobotPanel } from '@mr-robot/protocol'
import { Panel } from '../src/components/Panel.tsx'

afterEach(cleanup)

const identity = { name: 'Analyst', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const panelWith = (box?: BoxView): RobotPanel => ({
  summary: { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false },
  settings: { identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [], contextBudget: 128000, codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants, notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'home' }, spaceSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, spaceReviewer: null, subagentModels: [] },
  tasks: [], screen: null, canEdit: true, takeover: null,
  usage: { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0.2, boxMinutes: 12.5, breakdown: { model: { robot: 0, review: 0, subagent: 0 }, browser: 0, box: 0.2, services: 0, total: 0.2 }, limit: { limit: { kind: 'none' }, from: 'home' } },
  ...(box === undefined ? {} : { box }),
})
const handlers = { onOpenTask: vi.fn(), onEditProfile: vi.fn(), onOpenScreen: vi.fn(), onAdvanced: vi.fn(), onTrajectory: vi.fn(), onFiles: vi.fn(), onClose: vi.fn() }

describe('the Box section of the panel (ao-9q18)', () => {
  it('shows the state; Stop while it runs calls the stop', () => {
    const onStopBox = vi.fn()
    render(<Panel panel={panelWith({ state: 'running', since: Date.parse('2026-10-19T10:00:00Z'), lastCommandAt: Date.parse('2026-10-19T10:05:00Z') })} {...handlers} onStopBox={onStopBox} />)
    const section = screen.getByRole('region', { name: 'Box' })
    expect(within(section).getByText(/^Running · since /)).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: 'Stop' }))
    expect(onStopBox).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/12\.5 Box min/)).toBeTruthy()
  })

  it('lists the jobs that run, each with Stop (gb-66kh)', () => {
    const onStopJob = vi.fn()
    const now = Date.parse('2026-10-19T10:30:00Z')
    render(<Panel panel={panelWith({ state: 'running', since: now - 40 * 60_000, lastCommandAt: now - 30 * 60_000, jobs: [{ id: 'j-1', command: 'python3 train.py --epochs 50', startedAt: now - 12 * 60_000 }, { id: 'j-2', command: 'python3 -m http.server', startedAt: now - 20_000 }] })} {...handlers} onStopBox={vi.fn()} onStopJob={onStopJob} now={now} />)
    const jobs = within(screen.getByRole('list', { name: 'Jobs' })).getAllByRole('listitem')
    expect(jobs.map((job) => job.textContent)).toEqual(['python3 train.py --epochs 50 · 12 minStop', 'python3 -m http.server · just nowStop'])
    fireEvent.click(screen.getByRole('button', { name: 'Stop job python3 -m http.server' }))
    expect(onStopJob).toHaveBeenCalledWith('j-2')
  })

  it('shows no job list when none runs', () => {
    render(<Panel panel={panelWith({ state: 'running', since: 1, lastCommandAt: 1 })} {...handlers} onStopBox={vi.fn()} onStopJob={vi.fn()} />)
    expect(screen.queryByRole('list', { name: 'Jobs' })).toBeNull()
  })

  it('has no Stop when off, and no section without the grant', () => {
    const { rerender } = render(<Panel panel={panelWith({ state: 'off', since: null, lastCommandAt: null })} {...handlers} onStopBox={vi.fn()} />)
    const section = screen.getByRole('region', { name: 'Box' })
    expect(within(section).getByText('Off')).toBeTruthy()
    expect(within(section).queryByRole('button', { name: 'Stop' })).toBeNull()
    rerender(<Panel panel={panelWith()} {...handlers} onStopBox={vi.fn()} />)
    expect(screen.queryByRole('region', { name: 'Box' })).toBeNull()
  })
})
