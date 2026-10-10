import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type ChatItem, type ProposalView } from '@mr-robot/protocol'
import { ChatView } from '../src/components/ChatView.tsx'
import { AskBar } from '../src/components/AskBar.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-06T18:00:00Z')
const me = { kind: 'member' as const, memberId: 'm-1', name: 'Anna' }

const proposal: ProposalView = {
  id: 'p-1', kind: 'setup', revision: 2, status: 'open', purpose: 'Watch listings daily',
  grants: { ...emptyGrants, tools: { web: 'allow', routines: 'allow' } }, file: null, skill: null,
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

  it('names Mr. Robot on a Routine card he made for this Robot (cd-n9pi)', () => {
    render(<ChatView items={[{ kind: 'routine', id: 'g', seq: 1, at, action: 'created', name: 'Weekly digest', by: 'Mr. Robot' }]} meId="m-1" working={false} canAnswer={false} now={at} />)
    expect(screen.getByText('Routine created by Mr. Robot')).toBeTruthy()
    expect(screen.getByText('Weekly digest')).toBeTruthy()
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

  it('lets the owner approve all, some or none of a review in one answer; the decided card shows counts (cd-dt2x, cd-ueft)', () => {
    const review: ProposalView = {
      id: 'p-9', kind: 'review', revision: 1, status: 'open', purpose: 'Replies to send', grants: null, file: null, skill: null,
      review: { title: 'Replies to send', items: [
        { id: 'm1', title: 'Reply to Ola', body: 'Thanks, see you Friday.', action: 'Send' },
        { id: 'm2', title: 'Reply to Piotr', body: 'Not this week.' },
        { id: 'm3', title: 'Reply to Kasia', body: 'Yes.' },
      ] },
    }
    const onAnswer = vi.fn()
    const { rerender } = render(<AskBar asks={[review]} onAnswer={onAnswer} onReplyInstead={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect((screen.getByText('Approve selected') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    fireEvent.click(screen.getAllByRole('checkbox')[2]!)
    fireEvent.click(screen.getByText('Approve selected'))
    expect(onAnswer).toHaveBeenLastCalledWith(review, true, ['m1', 'm3'])
    fireEvent.click(screen.getByText('Approve all'))
    expect(onAnswer).toHaveBeenLastCalledWith(review, true, ['m1', 'm2', 'm3'])
    fireEvent.click(screen.getByText('Reject'))
    expect(onAnswer).toHaveBeenLastCalledWith(review, false)

    const decided: ProposalView = { ...review, status: 'approved', review: { ...review.review!, decision: { approved: ['m1', 'm3'], rejected: ['m2'] } } }
    rerender(<ChatView items={[{ kind: 'question', id: 'q', seq: 1, at, proposal: decided }]} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Review: Replies to send · 2 approved, 1 rejected')).toBeTruthy()
  })

  it('starts the next review with nothing selected, even when its item ids repeat (cd-ueft)', () => {
    const first: ProposalView = {
      id: 'p-1', kind: 'review', revision: 1, status: 'open', purpose: 'Batch 1', grants: null, file: null, skill: null,
      review: { title: 'Batch 1', items: [{ id: 'm1', title: 'One', body: 'a' }, { id: 'm2', title: 'Two', body: 'b' }] },
    }
    const second: ProposalView = { ...first, id: 'p-2', purpose: 'Batch 2', review: { ...first.review!, title: 'Batch 2' } }
    const { rerender } = render(<AskBar asks={[first, second]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    expect((screen.getByText('Approve selected') as HTMLButtonElement).disabled).toBe(false)
    rerender(<AskBar asks={[second]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} />)
    expect(screen.getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked)).toBe(true)
    expect((screen.getByText('Approve selected') as HTMLButtonElement).disabled).toBe(true)
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

describe('Thread Asks and the Thread card (ch-vrl7, ch-hikl, ch-iy16)', () => {
  const invitation: ProposalView = {
    id: 'p-t', kind: 'thread', revision: 1, status: 'open', purpose: 'Ben\'s Mr. Robot wants to talk about "Dinner on Friday"', grants: null, file: null, skill: null,
    thread: { id: 'th-1', phase: 'invitation-in', topic: 'Dinner on Friday', other: 'Ben\'s Mr. Robot', scope: '' },
  }

  it('shows the topic and an editable scope; accepting answers with the edited text (ch-hikl)', () => {
    const onAnswer = vi.fn()
    render(<AskBar asks={[invitation]} onAnswer={onAnswer} onReplyInstead={vi.fn()} />)
    expect(screen.getByText('Thread invitation')).toBeTruthy()
    expect(screen.getByText(/wants to talk about "Dinner on Friday"/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/In this Thread you may use/), { target: { value: 'my food preferences' } })
    fireEvent.click(screen.getByText('Accept'))
    expect(onAnswer).toHaveBeenLastCalledWith(invitation, true, undefined, 'my food preferences')
    fireEvent.click(screen.getByText('Decline'))
    expect(onAnswer).toHaveBeenLastCalledWith(invitation, false)
  })

  it('starts the outgoing invitation with the scope the chief proposed (ch-vrl7)', () => {
    const out: ProposalView = { ...invitation, thread: { ...invitation.thread!, phase: 'invitation-out', scope: 'my calendar for Friday' } }
    render(<AskBar asks={[out]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} />)
    expect((screen.getByLabelText(/In this Thread you may use/) as HTMLTextAreaElement).value).toBe('my calendar for Friday')
  })

  it('shows a labelled Thread message and the Thread card with state and count (ch-iy16)', () => {
    const thread = {
      id: 'th-1', topic: 'Dinner on Friday', state: 'open' as const, self: { robotId: 'r-1', label: 'Anna\'s Mr. Robot', avatarColor: '#5ec4b6' },
      other: { robotId: 'r-2', label: 'Ben\'s Mr. Robot', ownerName: 'Ben' }, scope: 'my calendar', accepted: 'accepted' as const, messageCount: 3,
      createdAt: at, openedAt: at, closedAt: null, lastActivityAt: at, closedBy: null, summary: null,
    }
    const list: ChatItem[] = [
      { kind: 'thread', id: 'c', seq: 1, at, event: 'opened', thread },
      { kind: 'message', id: 'm', seq: 2, at, sender: { kind: 'robot', robotId: 'r-2', name: 'Ben\'s Mr. Robot', avatarColor: '#5ec4b6' }, text: 'Friday works.', attachments: [], reaction: null, thread: { id: 'th-1', topic: 'Dinner on Friday' } },
    ]
    render(<ChatView items={list} meId="m-1" working={false} canAnswer={false} now={at} />)
    expect(screen.getByText('Thread opened')).toBeTruthy()
    expect(screen.getByText('Dinner on Friday')).toBeTruthy()
    expect(screen.getByText('3 messages', { exact: false })).toBeTruthy()
    expect(screen.getAllByText("Ben's Mr. Robot", { exact: false }).length).toBeGreaterThan(1)
    expect(screen.getByText('Friday works.')).toBeTruthy()
  })
})

describe('tool-call Ask (sk-hx8j)', () => {
  const long = 'x'.repeat(400)
  const ask: ProposalView = {
    id: 'p-call', kind: 'tool-call', revision: 1, status: 'open', purpose: 'gmail_send: Tell Ben the meeting moved', grants: null, file: null, skill: null,
    toolCall: {
      robot: 'Inbox', tool: 'gmail_send', reason: 'Tell Ben the meeting moved', note: null,
      arguments: [{ name: 'to', value: 'ben@example.com' }, { name: 'token', value: '[secret:gmail]' }, { name: 'body', value: long }],
    },
  }

  it('shows the Robot, the tool, the arguments line by line with long values cut, and the reason', () => {
    const { container } = render(<AskBar asks={[ask]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} />)
    expect(screen.getByText('Inbox wants to use gmail_send')).toBeTruthy()
    const terms = [...container.querySelectorAll('.tool-call-args dt')].map((node) => node.textContent)
    const values = [...container.querySelectorAll('.tool-call-args dd')].map((node) => node.textContent ?? '')
    expect(terms).toEqual(['to', 'token', 'body'])
    expect(values[0]).toBe('ben@example.com')
    expect(values[1]).toBe('[secret:gmail]')
    expect(values[2]!.length).toBeLessThan(long.length)
    expect(values[2]!.endsWith('…')).toBe(true)
    expect(container.querySelector('.tool-call-reason')?.textContent).toBe('Why: Tell Ben the meeting moved')
  })

  it('approves without a note and rejects with the owner\'s text', () => {
    const onAnswer = vi.fn()
    const { rerender } = render(<AskBar asks={[ask]} onAnswer={onAnswer} onReplyInstead={vi.fn()} />)
    fireEvent.click(screen.getByText('Approve'))
    expect(onAnswer).toHaveBeenLastCalledWith(ask, true, undefined, undefined, undefined)
    const other = { ...ask, id: 'p-call-2' }
    rerender(<AskBar asks={[other]} onAnswer={onAnswer} onReplyInstead={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Note for the Robot'), { target: { value: ' Not today ' } })
    fireEvent.click(screen.getByText('Reject'))
    expect(onAnswer).toHaveBeenLastCalledWith(other, false, undefined, undefined, 'Not today')
  })

  it('shows the answer and the note in the Conversation once decided', () => {
    const decided: ProposalView = { ...ask, status: 'rejected', toolCall: { ...ask.toolCall!, note: 'Not today' } }
    render(<AskBar asks={[decided]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} />)
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.getByText('Your note: Not today')).toBeTruthy()
    expect(screen.getByText('Rejected')).toBeTruthy()
  })
})
