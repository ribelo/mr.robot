import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ProposalView } from '@mr-robot/protocol'
import { AskBar } from '../src/components/AskBar.tsx'
import { ChatView } from '../src/components/ChatView.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-06T18:00:00Z')

const help: ProposalView = {
  id: 'h-1', kind: 'help', revision: 1, status: 'open', purpose: 'The VAT number of the new company',
  grants: null, file: null, skill: null,
  help: { doing: 'Filing the VAT return', tried: 'Looked in the shared folder', need: 'The VAT number of the new company', urgent: false, created: at, answeredBy: 'none', answer: null, escalated: false, override: null },
}

describe('help card (sk-fcr1)', () => {
  it('shows what the Robot is doing, tried and needs, and sends the typed answer as text', () => {
    const onHelp = vi.fn()
    render(<AskBar asks={[help]} onAnswer={vi.fn()} onHelp={onHelp} onReplyInstead={vi.fn()} />)
    expect(screen.getByText('Asks for help')).toBeTruthy()
    expect(screen.getByText('Filing the VAT return')).toBeTruthy()
    expect(screen.getByText('Looked in the shared folder')).toBeTruthy()
    expect(screen.getAllByText('The VAT number of the new company')).toHaveLength(1)
    expect(screen.queryByText('Urgent')).toBeNull()
    // There is no Approve or Reject: a help request is answered in words.
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Reject')).toBeNull()

    const send = screen.getByText('Send') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '  PL 123-45-67-890  ' } })
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(onHelp).toHaveBeenCalledWith(help, 'PL 123-45-67-890')
  })

  it('marks an urgent request', () => {
    const urgent: ProposalView = { ...help, help: { ...help.help!, urgent: true } }
    render(<AskBar asks={[urgent]} onAnswer={vi.fn()} onHelp={vi.fn()} onReplyInstead={vi.fn()} />)
    expect(screen.getByText('Asks for help (urgent)')).toBeTruthy()
    expect(screen.getByText('Urgent')).toBeTruthy()
  })

  it('keeps one line while open and the whole exchange once answered', () => {
    const item = (proposal: ProposalView): ChatItem[] => [{ kind: 'question', id: 'q', seq: 1, at, proposal }]
    const { rerender } = render(<ChatView items={item(help)} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Asks for help · answer below')).toBeTruthy()
    expect(screen.queryByLabelText('Your answer')).toBeNull()

    const answered: ProposalView = { ...help, status: 'done', help: { ...help.help!, answeredBy: 'owner', answer: 'It is PL 123-45-67-890.' } }
    rerender(<ChatView items={item(answered)} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Filing the VAT return')).toBeTruthy()
    expect(screen.getByText('You answered:')).toBeTruthy()
    expect(screen.getByText(/It is PL 123-45-67-890\./)).toBeTruthy()
    expect(screen.queryByLabelText('Your answer')).toBeNull()

    const byChief: ProposalView = { ...answered, help: { ...answered.help!, answeredBy: 'mr-robot' } }
    rerender(<ChatView items={item(byChief)} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Mr. Robot answered:')).toBeTruthy()
  })

  it('says that Mr. Robot has been asked while the request is open (sk-35i9)', () => {
    const escalated: ProposalView = { ...help, help: { ...help.help!, escalated: true } }
    render(<AskBar asks={[escalated]} onAnswer={vi.fn()} onHelp={vi.fn()} onReplyInstead={vi.fn()} />)
    expect(screen.getByText('Mr. Robot has been asked')).toBeTruthy()
  })

  it('lets the owner answer once more after Mr. Robot, and shows both answers (sk-q86i)', () => {
    const item = (proposal: ProposalView): ChatItem[] => [{ kind: 'question', id: 'q', seq: 1, at, proposal }]
    const onHelp = vi.fn()
    const byChief: ProposalView = { ...help, status: 'done', help: { ...help.help!, answeredBy: 'mr-robot', answer: 'Use the old number.' } }
    const { rerender } = render(<ChatView items={item(byChief)} meId="m-1" working={false} canAnswer={true} onHelp={onHelp} now={at} />)
    expect(screen.getByText('Mr. Robot answered:')).toBeTruthy()
    const send = screen.getByText('Send') as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: ' No: use 777 ' } })
    fireEvent.click(send)
    expect(onHelp).toHaveBeenCalledWith(byChief, 'No: use 777')

    const overridden: ProposalView = { ...byChief, help: { ...byChief.help!, override: 'No: use 777' } }
    rerender(<ChatView items={item(overridden)} meId="m-1" working={false} canAnswer={true} onHelp={onHelp} now={at} />)
    expect(screen.getByText('Mr. Robot answered:')).toBeTruthy()
    expect(screen.getByText('You answered afterwards:')).toBeTruthy()
    expect(screen.getByText(/No: use 777/)).toBeTruthy()
    expect(screen.queryByLabelText('Your answer')).toBeNull()
  })

  it('offers no override to someone who cannot answer, or after the owner answered', () => {
    const item = (proposal: ProposalView): ChatItem[] => [{ kind: 'question', id: 'q', seq: 1, at, proposal }]
    const byChief: ProposalView = { ...help, status: 'done', help: { ...help.help!, answeredBy: 'mr-robot', answer: 'Use the old number.' } }
    const { rerender } = render(<ChatView items={item(byChief)} meId="m-1" working={false} canAnswer={false} now={at} />)
    expect(screen.queryByLabelText('Your answer')).toBeNull()
    const byOwner: ProposalView = { ...help, status: 'done', help: { ...help.help!, answeredBy: 'owner', answer: 'It is 123.' } }
    rerender(<ChatView items={item(byOwner)} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.queryByLabelText('Your answer')).toBeNull()
  })
})
