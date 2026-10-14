import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, FleetState, Me, RobotPanel, RobotSummary } from '@mr-robot/protocol'
import { RobotConversation } from '../src/App.tsx'
import { Avatar } from '../src/components/Avatar.tsx'
import { ChatView } from '../src/components/ChatView.tsx'
import { RobotList } from '../src/components/RobotList.tsx'
import { TOKENS } from '../src/theme/theme-css.ts'

afterEach(cleanup)

const at = Date.parse('2026-10-06T18:00:00Z')
const me = { id: 'm-1', name: 'Anna', role: 'admin', workDetails: 'compact', theme: 'system' } as Me
const robot = (id: string, fleetState: FleetState): RobotSummary => ({
  id, ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState,
  identity: { name: `Robot ${id}`, title: '', description: '', avatarColor: '#f4a03a', avatarSeed: id }, lastLine: 'ok', lastAt: 0, unread: false,
}) as RobotSummary

describe('Robot message tint (ap-yzs4)', () => {
  const items: ChatItem[] = [
    { kind: 'reply', id: 'a', seq: 1, at, text: 'My own words' },
    { kind: 'message', id: 'b', seq: 2, at, sender: { kind: 'robot', robotId: 'r-2', name: 'Chief', avatarColor: '#8b5cf6', avatarSeed: 'r-2' }, text: 'From another Robot', attachments: [], reaction: null },
    { kind: 'message', id: 'c', seq: 3, at, sender: { kind: 'member', memberId: 'm-1', name: 'Anna' }, text: 'Mine', attachments: [], reaction: null },
  ]

  it("mixes the Robot's colour into the surface for its replies, and the sender's colour for other Robots' messages", () => {
    const { container } = render(<ChatView items={items} meId="m-1" working={false} canAnswer={false} now={at} robotColor="#f4a03a" />)
    const background = (text: string) => (screen.getByText(text).closest('.bubble') as HTMLElement).getAttribute('style') ?? ''
    expect(background('My own words')).toContain('color-mix(in oklab, #f4a03a var(--tint), var(--surface))')
    expect(background('From another Robot')).toContain('color-mix(in oklab, #8b5cf6 var(--tint), var(--surface))')
    // My own bubble and the text colour come from the theme, not from a Robot colour.
    expect(container.querySelector('.bubble-own')?.getAttribute('style') ?? '').toBe('')
    expect(background('My own words')).not.toMatch(/(^|;)\s*color:/)
  })

  it('keeps the tint within the strengths set for each theme', () => {
    expect(TOKENS.tint.dark).toBeGreaterThanOrEqual(10)
    expect(TOKENS.tint.dark).toBeLessThanOrEqual(14)
    expect(TOKENS.tint.light).toBeGreaterThanOrEqual(8)
    expect(TOKENS.tint.light).toBeLessThanOrEqual(10)
  })
})

describe('state avatar (ap-bxt2)', () => {
  it.each([
    ['working', 'avatar-working'], ['waiting for you', 'avatar-waiting'], ['blocked', 'avatar-blocked'],
    ['paused', 'avatar-paused'], ['sleeping', 'avatar-idle'], ['setup', 'avatar-idle'],
  ] as const)('gives a %s Robot the class %s', (state, className) => {
    const { container } = render(<Avatar seed="r-1" color="#5ec4b6" state={state} />)
    expect(container.querySelector('.avatar')?.classList.contains(className)).toBe(true)
  })

  it('marks a waiting Robot with a ring and a blocked one with a mark', () => {
    const waiting = render(<Avatar seed="r-1" color="#5ec4b6" state="waiting for you" />)
    expect(waiting.container.querySelector('.avatar-ring')).not.toBeNull()
    cleanup()
    const blocked = render(<Avatar seed="r-1" color="#5ec4b6" state="blocked" />)
    expect(blocked.container.querySelector('.avatar-mark')).not.toBeNull()
  })

  it('shows the state in the robot list and in the conversation header', () => {
    const robots = [robot('1', 'working'), robot('2', 'waiting for you'), robot('3', 'sleeping')]
    const list = render(<RegistryProvider><RobotList robots={robots} selected={undefined} meName="Anna" meAvatar={{ kind: 'initials', color: '#6c63ff' }} isAdmin={false} onSelect={() => {}} onCreate={() => {}} onAdmin={() => {}} onProfile={() => {}} onListPref={() => {}} onEditProfile={() => {}} onAdvanced={() => {}} onFiles={() => {}} /></RegistryProvider>)
    expect([...list.container.querySelectorAll('.robot-row .avatar')].map((node) => node.className)).toEqual(['avatar avatar-working', 'avatar avatar-waiting', 'avatar avatar-idle'])
    cleanup()
    const panel = { summary: robot('1', 'working'), canEdit: true } as unknown as RobotPanel
    const header = render(<RegistryProvider><RobotConversation route={{ page: 'robot', id: '1', panel: false }} me={me} robot={robot('1', 'working')} conversation={{ robotId: '1', items: [], working: true }} panel={panel} stream={null} onSheet={() => {}} /></RegistryProvider>)
    expect(header.container.querySelector('.conversation-head .avatar')?.classList.contains('avatar-working')).toBe(true)
  })

  it('turns every avatar animation off under reduced motion', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/styles.css'), 'utf8')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.avatar-face, \.avatar-ring[^{]*\{ animation: none; \}/)
  })
})
