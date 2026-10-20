import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ProposalView } from '@mr-robot/protocol'
import { AskBar } from '../src/components/AskBar.tsx'
import { ChatView } from '../src/components/ChatView.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-20T10:00:00Z')
const draft: ProposalView = {
  id: 'p-mail', kind: 'tool-call', revision: 1, status: 'open', purpose: 'gmail_send: Ben asked', grants: null, file: null, skill: null,
  toolCall: {
    robot: 'Inbox', tool: 'gmail_send', reason: 'Ben asked when dinner is', note: null, alwaysAllow: [{ kind: 'connection', name: 'c-1:write' }],
    arguments: [{ name: 'to', value: '["ben@example.com"]' }, { name: 'subject', value: 'Dinner' }, { name: 'body', value: 'Dinner is at **seven**.' }],
    draft: { medium: 'email', recipients: [{ label: 'To', value: 'ben@example.com' }], subject: 'Dinner', body: 'Dinner is at **seven**.', attachments: ['notes/menu.md'], revisions: [] },
  },
}

describe('the draft card (dp-si4p, dp-qbt7, dp-wd2q)', () => {
  it('reads as a message: recipients, subject, the body as Markdown, attachments; no raw arguments', () => {
    const { container } = render(<AskBar asks={[draft]} onAnswer={vi.fn()} onReply={vi.fn()} onReplyInstead={vi.fn()} />)
    expect(screen.getByText('Inbox wrote an e-mail for you to check')).toBeTruthy()
    expect(screen.getByText('ben@example.com')).toBeTruthy()
    expect(screen.getByText('Dinner')).toBeTruthy()
    expect(container.querySelector('.draft-body strong')?.textContent).toBe('seven')
    expect(screen.getByText('📎 menu.md')).toBeTruthy()
    expect(container.querySelector('.tool-call-args')).toBeNull()
  })

  it('Send without an edit sends as stored; an edit of body and subject goes with Send', () => {
    const onReply = vi.fn()
    render(<AskBar asks={[draft]} onAnswer={vi.fn()} onReply={onReply} onReplyInstead={vi.fn()} />)
    fireEvent.click(screen.getByText('Send'))
    expect(onReply).toHaveBeenLastCalledWith(draft, { kind: 'send' })
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Dinner is at eight.' } })
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Dinner tonight' } })
    fireEvent.click(screen.getByText('Send'))
    expect(onReply).toHaveBeenLastCalledWith(draft, { kind: 'send', edit: { body: 'Dinner is at eight.', subject: 'Dinner tonight' } })
  })

  it('Discard asks why and rejects with that reason', () => {
    const onAnswer = vi.fn()
    render(<AskBar asks={[draft]} onAnswer={onAnswer} onReply={vi.fn()} onReplyInstead={vi.fn()} />)
    fireEvent.click(screen.getByText('Discard'))
    fireEvent.change(screen.getByLabelText('Why not'), { target: { value: ' I will call him ' } })
    fireEvent.click(screen.getAllByText('Discard').at(-1)!)
    expect(onAnswer).toHaveBeenCalledWith(draft, false, undefined, undefined, 'I will call him')
  })

  it('"This Robot sends on its own" confirms first, then sends with the grant raised (dp-ef0p)', () => {
    const onReply = vi.fn()
    render(<AskBar asks={[draft]} onAnswer={vi.fn()} onReply={onReply} onReplyInstead={vi.fn()} />)
    fireEvent.click(screen.getByText('This Robot sends on its own'))
    expect(onReply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Yes, this Robot sends on its own'))
    expect(onReply).toHaveBeenCalledWith(draft, { kind: 'send', alone: true })
  })

  it('shows the words added and removed against the version before, and the history (dp-o3st)', () => {
    const revised: ProposalView = { ...draft, revision: 3, toolCall: { ...draft.toolCall!, draft: { ...draft.toolCall!.draft!, body: 'Dinner is at eight, at home.', revisions: [
      { seq: 1, body: 'Dinner is at seven, at the pub.', subject: 'Dinner', at, by: 'robot' },
      { seq: 2, body: 'Dinner is at eight, at home.', subject: 'Dinner', at, by: 'robot' },
    ] } } }
    const { container } = render(<AskBar asks={[revised]} onAnswer={vi.fn()} onReply={vi.fn()} onReplyInstead={vi.fn()} />)
    const added = [...container.querySelectorAll('.draft-diff ins')].map((node) => node.textContent?.trim())
    const removed = [...container.querySelectorAll('.draft-diff del')].map((node) => node.textContent?.trim())
    expect(added).toEqual(['eight', 'home'])
    expect(removed).toEqual(['seven', 'the pub'])
    expect(screen.getByText('2 versions')).toBeTruthy()
  })

  it('stays readable in the Conversation once sent; an Ask from before drafts keeps its arguments (dp-f0pp)', () => {
    const item = (proposal: ProposalView): ChatItem[] => [{ kind: 'proposal', id: 'q', seq: 1, at, proposal }]
    const { rerender, container } = render(<ChatView items={item({ ...draft, status: 'approved' })} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Sent')).toBeTruthy()
    expect(container.querySelector('.draft-body')).toBeTruthy()
    rerender(<AskBar asks={[{ ...draft, toolCall: { ...draft.toolCall!, draft: null, alwaysAllow: null } }]} onAnswer={vi.fn()} onReply={vi.fn()} onReplyInstead={vi.fn()} />)
    expect(screen.getByText('Inbox wants to use gmail_send')).toBeTruthy()
    expect(container.querySelector('.tool-call-args')).toBeTruthy()
    expect(screen.getByText('Approve')).toBeTruthy()
  })
})
