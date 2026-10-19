import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Me, RobotPanel } from '@mr-robot/protocol'
import { RobotConversation } from '../src/App.tsx'

const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, home: 'Home', timeZone: 'Europe/Warsaw', timeZonePinned: false, detectedTimeZone: 'Europe/Warsaw', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeHome: false, drawer: false }, acceptTasksFrom: [] } as Me
const identity = { name: 'Sales', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const summary = { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false } as const
const panel = { summary, canEdit: true } as unknown as RobotPanel
const at = Date.parse('2026-10-06T18:00:00Z')
const earlier = { kind: 'reply', id: 'e-1', seq: 1, at, text: 'Hello.' } as const
const conversation = (...items: Conversation['items'][number][]): Conversation => ({ robotId: 'r-1', items: [earlier, ...items], working: false })
const route = { page: 'robot', id: 'r-1', panel: false } as const

interface Post { readonly text: string; readonly clientId: string }
let posts: Post[]
let answers: Array<() => Response | Promise<Response>>

beforeEach(() => {
  posts = []
  answers = []
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname
    if (path === '/api/robots/r-1/messages' && init?.method === 'POST') {
      posts.push(JSON.parse(new TextDecoder().decode(init.body as Uint8Array)) as Post)
      return (answers.shift() ?? (() => Response.json({ wakeup: 1 })))()
    }
    return Response.json({})
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const view = (conv: Conversation) => (
  <RegistryProvider><RobotConversation route={route} me={me} robot={summary as never} conversation={conv} panel={panel} stream={null} onSheet={() => {}} /></RegistryProvider>
)
const type = (text: string) => {
  const box = screen.getByPlaceholderText('Message Sales') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
  return box
}

describe('optimistic send (ap-3si6, ap-ceqx, ap-7b3p)', () => {
  it('shows the message at once with a clock, empties the composer, and drops the mark when the Conversation holds it', async () => {
    let release: (response: Response) => void = () => {}
    answers.push(() => new Promise<Response>((resolve) => { release = resolve }))
    const { container, rerender } = render(view(conversation()))
    const box = type('  Send the report  ')
    // The server has not answered: the message is already in the chat, pending, and the Composer is empty.
    expect(box.value).toBe('')
    expect(container.querySelector('.pending-send .bubble-own')?.textContent).toBe('Send the report')
    expect(screen.getByRole('img', { name: 'sending' })).toBeTruthy()
    expect(screen.queryByText(/Not sent/)).toBeNull()
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ text: 'Send the report' })
    expect(posts[0]!.clientId).not.toBe('')

    release(Response.json({ wakeup: 1 }))
    rerender(view(conversation({ kind: 'message', id: 'm-9', seq: 2, at, sender: { kind: 'member', memberId: 'm-1', name: 'Anna' }, text: 'Send the report', attachments: [], reaction: null })))
    await waitFor(() => expect(container.querySelector('.pending-send')).toBeNull())
    expect(container.querySelectorAll('.bubble-own')).toHaveLength(1)
  })

  it('keeps a refused message marked "not sent" with the error, and Retry sends once more with the same client id (ap-ceqx)', async () => {
    answers.push(() => Response.json({ error: 'robot is paused' }, { status: 409 }))
    const { container } = render(view(conversation()))
    const box = type('Please retry me')
    expect(await screen.findByText(/Not sent: robot is paused/)).toBeTruthy()
    expect(box.value).toBe('')
    expect(container.querySelector('.pending-send.failed .bubble-own')?.textContent).toBe('Please retry me')
    expect(posts).toHaveLength(1)

    fireEvent.click(screen.getByText('Retry'))
    expect(screen.queryByText(/Not sent/)).toBeNull()
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toEqual(posts[0])
    expect(container.querySelectorAll('.pending-send')).toHaveLength(1)
  })

  it('confirms the send whose client id the Conversation carries, not an older one with the same text', async () => {
    answers.push(() => Response.json({ error: 'robot is paused' }, { status: 409 }))
    const { container, rerender } = render(view(conversation()))
    type('ok')
    expect(await screen.findByText(/Not sent/)).toBeTruthy()
    type('ok')
    await waitFor(() => expect(posts).toHaveLength(2))
    rerender(view(conversation({ kind: 'message', id: 'm-9', seq: 2, at, sender: { kind: 'member', memberId: 'm-1', name: 'Anna' }, text: 'ok', attachments: [], reaction: null, clientId: posts[1]!.clientId })))
    await waitFor(() => expect(container.querySelectorAll('.pending-send')).toHaveLength(1))
    expect(container.querySelector('.pending-send')?.getAttribute('data-state')).toBe('failed')
  })

  it('shows a message nobody could reach as not sent too', async () => {
    answers.push(() => { throw new TypeError('offline') })
    render(view(conversation()))
    type('Offline hello')
    expect(await screen.findByText(/Not sent: the server cannot be reached/)).toBeTruthy()
  })
})

describe('Ctrl+Enter sends a follow-up (ao-q2z4)', () => {
  it('Enter sends without the flag; Ctrl+Enter and Cmd+Enter send with followup', async () => {
    render(view(conversation()))
    const box = screen.getByPlaceholderText('Message Sales') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'now' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.change(box, { target: { value: 'later' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    fireEvent.change(box, { target: { value: 'later too' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(posts).toHaveLength(3))
    expect(posts.map((post) => [post.text, (post as Post & { followup?: boolean }).followup ?? false])).toEqual([['now', false], ['later', true], ['later too', true]])
  })
})
