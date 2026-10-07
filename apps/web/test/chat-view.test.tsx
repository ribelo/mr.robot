import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ProposalView } from '@mr-robot/protocol'
import { ChatView } from '../src/components/ChatView.tsx'
import { AskBar } from '../src/components/AskBar.tsx'

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
    // Robot replies are Markdown (pl-6bop).
    expect(container.querySelector('.bubble-robot strong')?.textContent).toBe('Salesforce')
    expect(screen.getByText('Created routine')).toBeTruthy()
    expect(screen.getByText('Overnight outbound')).toBeTruthy()
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.getByText('Approve these Grants to finish setup · waiting for the owner')).toBeTruthy()
  })

  it('keeps one line of an ask in the stream; the ask itself is answered in place of the composer (rb-dat4)', () => {
    render(<ChatView items={items} meId="m-1" working={true} canAnswer={true} now={at} />)
    expect(screen.getByText('Approve these Grants to finish setup · answer below')).toBeTruthy()
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.getByLabelText('working')).toBeTruthy()
  })

  it('shows several asks one at a time with a count, answers with the revision, and can reply instead (rb-f5um, rb-r0oj)', () => {
    const onAnswer = vi.fn()
    const onReplyInstead = vi.fn()
    const second = { ...proposal, id: 'p-2', purpose: 'Second ask' }
    const { rerender } = render(<AskBar asks={[proposal, second]} onAnswer={onAnswer} onReplyInstead={onReplyInstead} />)
    expect(screen.getByText('1/2')).toBeTruthy()
    expect(screen.getByText('web')).toBeTruthy()
    fireEvent.click(screen.getByText('Approve'))
    expect(onAnswer).toHaveBeenCalledWith(proposal, true)
    rerender(<AskBar asks={[second]} onAnswer={onAnswer} onReplyInstead={onReplyInstead} />)
    expect(screen.getByText('2/2')).toBeTruthy()
    fireEvent.click(screen.getByText('Reply instead'))
    expect(onReplyInstead).toHaveBeenCalled()
  })

  it("shows another Member's message as theirs, not mine", () => {
    const other: ChatItem = { kind: 'message', id: 'x', seq: 1, at, sender: { kind: 'member', memberId: 'm-2', name: 'Ben' }, text: 'hello', attachments: [], reaction: null }
    const { container } = render(<ChatView items={[other]} meId="m-1" working={false} canAnswer={false} now={at} />)
    expect(container.querySelector('.bubble-own')).toBeNull()
    expect(screen.getByText('Ben')).toBeTruthy()
  })

  it('shows one activity line at Compact and DSH tool cards with thinking at Detailed (pl-s0hp, pl-etps)', () => {
    const worked: ChatItem[] = [
      { kind: 'thinking', id: 'th', seq: 1, at, text: 'I should read the notes first.' },
      { kind: 'activity', id: 'ac', seq: 2, at, tools: ['read'], calls: [{ id: 'c1', name: 'read', args: '{"file_path": "notes.md"}', result: 'hello', error: false, inner: [] }] },
      { kind: 'reply', id: 'r', seq: 3, at, text: '| a | b |\n|---|---|\n| 1 | 2 |\n\n[site](https://example.com)' },
    ]
    const compact = render(<ChatView items={worked} meId="m-1" working={false} canAnswer={false} now={at} workDetails="compact" />)
    expect(compact.container.textContent).toContain('Used read')
    expect(compact.container.textContent).not.toContain('Thought')
    expect(compact.container.querySelector('.bubble-robot table')).not.toBeNull()
    expect(compact.container.querySelector('.bubble-robot a')?.getAttribute('href')).toBe('https://example.com')
    cleanup()
    const detailed = render(<ChatView items={worked} meId="m-1" working={false} canAnswer={false} now={at} workDetails="detailed" />)
    expect(detailed.container.textContent).toContain('read notes.md')
    expect(detailed.container.textContent).toContain('Thought')
    expect(detailed.container.textContent).not.toContain('Used read')
    cleanup()
    const live = render(<ChatView items={[]} meId="m-1" working={true} canAnswer={false} now={at} stream={{ text: 'Half of the ans', thinking: '' }} />)
    expect(live.container.textContent).toContain('Half of the ans')
  })
})
