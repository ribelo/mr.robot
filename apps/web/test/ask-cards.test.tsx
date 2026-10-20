import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ProposalView } from '@mr-robot/protocol'
import { AskBar } from '../src/components/AskBar.tsx'
import { ChatView, entryNameFor } from '../src/components/ChatView.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-20T10:00:00Z')
const base = { revision: 1, grants: null, file: null, skill: null } as const

const question: ProposalView = {
  ...base, id: 'q-1', kind: 'question', status: 'open', purpose: 'Which one should I order?',
  question: {
    prompt: 'Which one should I order?', help: 'Both are in stock.', allowCustom: true, dismissOnMoveOn: false, urgent: false, answer: null,
    options: [
      { label: 'Order the red one', value: 'red', description: 'Ships Friday, 129 zł', style: 'primary' },
      { label: 'Order the blue one', value: 'blue', description: null, style: 'default' },
      { label: 'Cancel the order', value: 'cancel', description: null, style: 'danger' },
    ],
  },
}

describe('the question Ask (gb-k88x)', () => {
  it('shows the prompt, help and an option button per option with its style and description', () => {
    const { container } = render(<AskBar asks={[question]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} onReply={vi.fn()} />)
    expect(screen.getByText('Which one should I order?', { selector: '.question-prompt' })).toBeTruthy()
    expect(screen.getByText('Both are in stock.')).toBeTruthy()
    const buttons = [...container.querySelectorAll('.question-option')]
    expect(buttons.map((button) => button.querySelector('span')?.textContent)).toEqual(['Order the red one', 'Order the blue one', 'Cancel the order'])
    expect(buttons.map((button) => button.className.includes('button-primary') ? 'primary' : button.className.includes('button-danger') ? 'danger' : 'default')).toEqual(['primary', 'default', 'danger'])
    expect(screen.getByText('Ships Friday, 129 zł')).toBeTruthy()
    expect(screen.queryByText('Approve')).toBeNull()
  })

  it('one tap on an option answers with its value; the custom field sends the owner\'s words; Dismiss dismisses', () => {
    const onReply = vi.fn()
    render(<AskBar asks={[question]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} onReply={onReply} />)
    fireEvent.click(screen.getByText('Order the blue one'))
    expect(onReply).toHaveBeenLastCalledWith(question, { kind: 'option', value: 'blue' })
    const send = screen.getByText('Send') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your own answer'), { target: { value: '  the green one  ' } })
    fireEvent.click(send)
    expect(onReply).toHaveBeenLastCalledWith(question, { kind: 'custom', text: 'the green one' })
    fireEvent.click(screen.getByText('Dismiss'))
    expect(onReply).toHaveBeenLastCalledWith(question, { kind: 'dismiss' })
  })

  it('has no text field when the Robot did not allow one', () => {
    const closed: ProposalView = { ...question, question: { ...question.question!, allowCustom: false } }
    render(<AskBar asks={[closed]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} onReply={vi.fn()} />)
    expect(screen.queryByLabelText('Your own answer')).toBeNull()
  })

  it('keeps one line while open, and the answer in the Conversation after', () => {
    const item = (proposal: ProposalView): ChatItem[] => [{ kind: 'proposal', id: 'q', seq: 1, at, proposal }]
    const { rerender } = render(<ChatView items={item(question)} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Which one should I order? · answer below')).toBeTruthy()
    expect(screen.queryByText('Order the red one')).toBeNull()

    const chosen: ProposalView = { ...question, status: 'approved', question: { ...question.question!, answer: { kind: 'option', value: 'red', label: 'Order the red one' } } }
    rerender(<ChatView items={item(chosen)} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('You chose: Order the red one')).toBeTruthy()
    expect(screen.queryByText('Dismiss')).toBeNull()

    const wrote: ProposalView = { ...question, status: 'approved', question: { ...question.question!, answer: { kind: 'custom', text: 'the green one' } } }
    rerender(<ChatView items={item(wrote)} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('You answered: the green one')).toBeTruthy()

    const moved: ProposalView = { ...question, status: 'rejected', question: { ...question.question!, answer: { kind: 'dismissed', reason: 'moved-on' } } }
    rerender(<ChatView items={item(moved)} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Dismissed: you moved on')).toBeTruthy()
  })

  it('marks an urgent question in its title', () => {
    const urgent: ProposalView = { ...question, question: { ...question.question!, urgent: true } }
    render(<ChatView items={[{ kind: 'proposal', id: 'q', seq: 1, at, proposal: urgent }]} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Urgent: Which one should I order? · answer below')).toBeTruthy()
  })
})

const login: ProposalView = {
  ...base, id: 'c-1', kind: 'credential', status: 'open', purpose: 'mBank: login',
  credential: { credential: 'login', service: 'mBank', why: 'To read the statements for the VAT return.', websites: ['online.mbank.pl'], scope: 'read statements, never pay', entry: null, declined: false },
}
const secret: ProposalView = { ...login, id: 'c-2', credential: { ...login.credential!, credential: 'secret', service: 'OpenAI API', websites: [], scope: null } }

describe('the credential Ask (gb-1g9w)', () => {
  it('shows the Login form pre-filled with what the Robot gave, and sends the entry on save', () => {
    const onReply = vi.fn()
    render(<AskBar asks={[login]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} onReply={onReply} />)
    expect(screen.getByText('Asks for a login for mBank')).toBeTruthy()
    expect(screen.getByText(/To read the statements for the VAT return\./)).toBeTruthy()
    expect((screen.getByLabelText('Entry name') as HTMLInputElement).value).toBe('mbank')
    expect((screen.getByLabelText('Websites') as HTMLInputElement).value).toBe('online.mbank.pl')
    expect((screen.getByLabelText('Notes') as HTMLInputElement).value).toBe('Allowed: read statements, never pay')
    const save = screen.getByText('Save and give access') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'anna' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(onReply).toHaveBeenCalledWith(login, { kind: 'save', entry: { name: 'mbank', username: 'anna', password: 'hunter2', websites: ['online.mbank.pl'], notes: 'Allowed: read statements, never pay', allowRead: false, shared: false } })
  })

  it('shows the secret form: a value, no username and no websites, readable by the Robot', () => {
    const onReply = vi.fn()
    render(<AskBar asks={[secret]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} onReply={onReply} />)
    expect(screen.getByText('Asks for a secret for OpenAI API')).toBeTruthy()
    expect(screen.queryByLabelText('Username')).toBeNull()
    expect(screen.queryByLabelText('Websites')).toBeNull()
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk-123' } })
    fireEvent.click(screen.getByText('Save and give access'))
    expect(onReply).toHaveBeenCalledWith(secret, { kind: 'save', entry: expect.objectContaining({ name: 'openai-api', username: '', password: 'sk-123', websites: [], allowRead: true }) })
  })

  it('Decline refuses; the saved and declined requests say so in the Conversation', () => {
    const onReply = vi.fn()
    render(<AskBar asks={[login]} onAnswer={vi.fn()} onReplyInstead={vi.fn()} onReply={onReply} />)
    fireEvent.click(screen.getByText('Decline'))
    expect(onReply).toHaveBeenCalledWith(login, { kind: 'decline' })
    cleanup()
    const item = (proposal: ProposalView): ChatItem[] => [{ kind: 'proposal', id: 'q', seq: 1, at, proposal }]
    const { rerender } = render(<ChatView items={item({ ...login, status: 'approved', credential: { ...login.credential!, entry: 'mbank' } })} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Saved as mbank and given to the Robot')).toBeTruthy()
    rerender(<ChatView items={item({ ...login, status: 'rejected', credential: { ...login.credential!, declined: true } })} meId="m-1" working={false} canAnswer={true} now={at} />)
    expect(screen.getByText('Declined')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('makes an entry name out of the service', () => {
    expect(entryNameFor('mBank online')).toBe('mbank-online')
    expect(entryNameFor('  Ąę OpenAI API!! ')).toBe('openai-api')
  })
})
