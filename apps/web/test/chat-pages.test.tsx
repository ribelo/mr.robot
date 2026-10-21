import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, Conversation, Me, RobotPanel } from '@mr-robot/protocol'
import { RobotConversation } from '../src/App.tsx'

// The chat a page at a time (v1.19 ticket 03, ec-n0uh): the newest page comes with the Robot; older pages by their cursor.
const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, home: 'Home', timeZone: 'Europe/Warsaw', timeZonePinned: false, detectedTimeZone: 'Europe/Warsaw', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeHome: false, drawer: false }, acceptTasksFrom: [] } as Me
const identity = { name: 'Sales', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'seed-1' }
const summary = { id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null, identity, lastLine: '', lastAt: 0, unread: false } as const
const panel = { summary, canEdit: true } as unknown as RobotPanel
const route = { page: 'robot', id: 'r-1', panel: false } as const
const at = Date.parse('2026-10-06T18:00:00Z')
const reply = (n: number, text = `line ${n}`): ChatItem => ({ kind: 'reply', id: `i-${n}`, seq: n, at, text })
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => reply(from + index))

/** Three pages over two chapters: the oldest page holds the word searched for; cursors as the Worker gives them. */
const pages: Record<string, Conversation> = {
  '2.0': { robotId: 'r-1', working: false, items: range(50, 100), before: '1.40' },
  '1.40': { robotId: 'r-1', working: false, items: range(10, 50), before: '1.0' },
  '1.0': { robotId: 'r-1', working: false, items: [reply(0, 'the zeppelin invoice'), ...range(1, 10)], before: null },
}
const newest: Conversation = { robotId: 'r-1', working: false, items: range(100, 150), before: '2.0' }

const geometry = { scrollHeight: 5000, clientHeight: 500, scrollTop: 4500 }
const descriptors = {
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
}
let asked: string[]

beforeEach(() => {
  asked = []
  Object.assign(geometry, { scrollHeight: 5000, clientHeight: 500, scrollTop: 4500 })
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => geometry.scrollHeight })
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => geometry.clientHeight })
  Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get: () => geometry.scrollTop, set: (value: number) => { geometry.scrollTop = value } })
  // jsdom has no scrolling: a search match is brought into view with scrollTo.
  Element.prototype.scrollTo = () => {}
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/robots/r-1/conversation') {
      const before = url.searchParams.get('before') ?? ''
      asked.push(before)
      // The older page will render above: the content grows by its height.
      if (pages[before] !== undefined) geometry.scrollHeight += 4000
      return Response.json(pages[before] ?? newest)
    }
    return Response.json({})
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const [name, descriptor] of Object.entries(descriptors)) if (descriptor !== undefined) Object.defineProperty(Element.prototype, name, descriptor)
})

const view = () => <RegistryProvider><RobotConversation route={route} me={me} robot={summary as never} conversation={newest} panel={panel} stream={null} onSheet={() => {}} /></RegistryProvider>

describe('the chat scrolls back across chapters (ec-n0uh)', () => {
  it('loads the page before at the top by its cursor, keeps the reader where they were, and counts nothing as new', async () => {
    const { container } = render(view())
    const pane = container.querySelector('.chat-scroll')!
    geometry.scrollTop = 100
    fireEvent.scroll(pane)
    await waitFor(() => expect(asked).toEqual(['2.0']))
    // The older page went in above: the view moved down by its height, so the reader sees what they saw.
    await waitFor(() => expect(geometry.scrollTop).toBe(4100))
    expect(screen.getByTitle('Jump to latest').textContent).toBe('↓ Latest')
    // Near the top again: the next page back, in the first chapter.
    geometry.scrollTop = 50
    fireEvent.scroll(pane)
    await waitFor(() => expect(asked).toEqual(['2.0', '1.40']))
  })

  it('searches back through older pages until it finds the word, to the start of the Conversation', async () => {
    render(view())
    fireEvent.click(screen.getByLabelText('Search this conversation'))
    fireEvent.change(screen.getByPlaceholderText('Search this conversation'), { target: { value: 'zeppelin' } })
    expect(screen.getByText('none loaded')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Previous match'))
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeTruthy())
    expect(asked).toEqual(['2.0', '1.40', '1.0'])
  })
})
