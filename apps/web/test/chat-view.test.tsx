import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ProposalView } from '@mr-robot/protocol'
import { ChatView } from '../src/components/ChatView.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-06T18:00:00Z')
const me = { kind: 'member' as const, memberId: 'm-1', name: 'Anna' }

const proposal: ProposalView = {
  id: 'p-1', kind: 'setup', revision: 2, status: 'open', purpose: 'Watch listings daily',
  grants: { tools: ['web', 'routines'], skills: [], recipients: [], secrets: [] }, file: null, skill: null,
}

const items: ChatItem[] = [
  { kind: 'message', id: 'a', seq: 1, at, sender: { kind: 'robot', robotId: 'r-2', name: 'Account Manager', avatarColor: '#8b5cf6' }, text: 'sent over the threads', attachments: [], reaction: null },
  { kind: 'message', id: 'b', seq: 2, at, sender: { kind: 'robot', robotId: 'r-3', name: 'Chief', avatarColor: '#5ec4b6' }, text: 'flagged the accounts', attachments: [], reaction: null },
  { kind: 'reply', id: 'c', seq: 3, at, text: '✓ **Salesforce** → list pulled' },
  { kind: 'message', id: 'd', seq: 4, at, sender: me, text: 'Send it. Run this every week.', attachments: [], reaction: '👍' },
  { kind: 'routine', id: 'e', seq: 5, at, action: 'created', name: 'Overnight outbound' },
  { kind: 'question', id: 'f', seq: 6, at, proposal },
]

describe('ChatView (robot-q4b2)', () => {
  it('renders bubbles, the reaction, the routine card and robot senders', () => {
    const { container } = render(<ChatView items={items} meId="m-1" working={false} canAnswer={false} now={at} />)
    expect(screen.getByTestId('robot-messages-header').textContent).toBe('Messages from  Account Manager and  Chief')
    expect(container.querySelector('.bubble-own')?.textContent).toBe('Send it. Run this every week.')
    expect(screen.getByLabelText('reacted 👍')).toBeTruthy()
    expect(container.querySelector('b')?.textContent).toBe('Salesforce')
    expect(screen.getByText('Created routine')).toBeTruthy()
    expect(screen.getByText('Overnight outbound')).toBeTruthy()
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.getByText('Waiting for the owner')).toBeTruthy()
  })

  it('lets the owner answer a Grant proposal with its revision', () => {
    const onAnswer = vi.fn()
    render(<ChatView items={items} meId="m-1" working={true} canAnswer={true} onAnswer={onAnswer} now={at} />)
    expect(screen.getByText('web')).toBeTruthy()
    fireEvent.click(screen.getByText('Approve'))
    expect(onAnswer).toHaveBeenCalledWith(proposal, true)
    expect(screen.getByLabelText('working')).toBeTruthy()
  })

  it("shows another Member's message as theirs, not mine", () => {
    const other: ChatItem = { kind: 'message', id: 'x', seq: 1, at, sender: { kind: 'member', memberId: 'm-2', name: 'Ben' }, text: 'hello', attachments: [], reaction: null }
    const { container } = render(<ChatView items={[other]} meId="m-1" working={false} canAnswer={false} now={at} />)
    expect(container.querySelector('.bubble-own')).toBeNull()
    expect(screen.getByText('Ben')).toBeTruthy()
  })
})
