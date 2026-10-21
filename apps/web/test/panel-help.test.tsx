import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type RobotPanel } from '@mr-robot/protocol'
import { ageText, Panel } from '../src/components/Panel.tsx'

afterEach(cleanup)

const now = Date.parse('2026-10-10T12:00:00Z')

const panel: RobotPanel = {
  summary: {
    id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'waiting for you', turn: null, lastWakeup: null,
    identity: { name: 'Accountant', title: 'Books', description: 'Keeps the books.', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }, lastLine: '', lastAt: 0, unread: false,
  },
  settings: {
    identity: { name: 'Accountant', title: 'Books', description: 'Keeps the books.', avatarColor: '#f4a03a', avatarSeed: 'seed-1' },
    sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }], contextBudget: 128000,
    codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants,
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'home' }, spaceSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, spaceReviewer: null, subagentModels: [],
  },
  tasks: [], screen: null, usage: { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0, breakdown: { model: { robot: 0, review: 0, subagent: 0 }, browser: 0, box: 0, services: 0, total: 0 }, limit: { limit: { kind: 'none' }, from: 'home' } }, canEdit: true, takeover: null,
}

const handlers = () => ({ onOpenTask: vi.fn(), onEditProfile: vi.fn(), onOpenScreen: vi.fn(), onAdvanced: vi.fn(), onTrajectory: vi.fn(), onFiles: vi.fn(), onClose: vi.fn() })

describe('open requests for help in the Panel (sk-fmvh)', () => {
  it('lists each with its text, age, urgency and whether Mr. Robot was asked; a click opens its card', () => {
    const on = { ...handlers(), onOpenHelp: vi.fn() }
    const help = [
      { id: 'h-1', text: 'The VAT number of the new company', urgent: false, created: now - 12 * 60_000, escalated: false },
      { id: 'h-2', text: 'Which bank account to use', urgent: true, created: now - 3 * 3_600_000, escalated: true },
    ]
    render(<Panel panel={{ ...panel, help }} now={now} {...on} />)
    expect(screen.getByText('Needs help')).toBeTruthy()
    expect(screen.getByText('12 min ago · Mr. Robot not asked yet')).toBeTruthy()
    expect(screen.getByText('3 h ago · urgent · Mr. Robot asked')).toBeTruthy()
    fireEvent.click(screen.getByText('Which bank account to use'))
    expect(on.onOpenHelp).toHaveBeenCalledWith('h-2')
  })

  it('shows no section when nothing waits', () => {
    render(<Panel panel={{ ...panel, help: [] }} now={now} {...handlers()} />)
    expect(screen.queryByText('Needs help')).toBeNull()
  })

  it('counts ages in the largest whole unit', () => {
    expect(ageText(10_000)).toBe('just now')
    expect(ageText(59 * 60_000)).toBe('59 min ago')
    expect(ageText(60 * 60_000)).toBe('1 h ago')
    expect(ageText(49 * 3_600_000)).toBe('2 d ago')
  })
})
