import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatItem, RobotSummary } from '@mr-robot/protocol'
import { ChatView } from '../src/components/ChatView.tsx'
import { RobotList } from '../src/components/RobotList.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-06T18:00:00Z')

describe('search, filter and files (v1.3 ticket 07)', () => {
  it('marks the search match and links attachments for preview and download (pl-8594, pl-ojbr)', () => {
    const items: ChatItem[] = [
      { kind: 'message', id: 'a', seq: 1, at, sender: { kind: 'member', memberId: 'm-1', name: 'Anna' }, text: 'here is the invoice', attachments: [{ name: 'invoice.pdf', path: 'attachments/2026-10-06/invoice.pdf', size: 10, contentType: 'application/pdf' }], reaction: null },
      { kind: 'reply', id: 'b', seq: 2, at, text: 'The total is 1 200 PLN.' },
    ]
    const { container } = render(<ChatView items={items} meId="m-1" robotId="r-1" highlight="b" working={false} canAnswer={false} now={at} />)
    expect(container.querySelector('.search-hit')?.textContent).toContain('1 200 PLN')
    const links = [...container.querySelectorAll('.attachment a')].map((link) => link.getAttribute('href'))
    expect(links).toEqual(['/api/robots/r-1/raw?path=attachments%2F2026-10-06%2Finvoice.pdf', '/api/robots/r-1/raw?path=attachments%2F2026-10-06%2Finvoice.pdf&download=1'])
  })

  it('filters the robot list by name (pl-4nfk)', () => {
    const robot = (id: string, name: string): RobotSummary => ({ id, identity: { name, title: '', description: '', avatarColor: '#888' }, ownerId: 'm-1', kind: 'robot', status: 'active', fleetState: 'sleeping', lastLine: '', lastAt: at, unread: false } as unknown as RobotSummary)
    const noop = () => undefined
    render(<RobotList robots={[robot('1', 'Flat Watcher'), robot('2', 'Gym Buddy'), robot('3', 'Invoice clerk')]} selected={undefined} meName="Anna" isAdmin={false}
      onSelect={noop} onCreate={noop} onAdmin={noop} onProfile={noop} onListPref={noop} onEditProfile={noop} onAdvanced={noop} onFiles={noop} />)
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'gym' } })
    expect([...document.querySelectorAll('.robot-name')].map((name) => name.textContent)).toEqual(['Gym Buddy'])
  })
})
