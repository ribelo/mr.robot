import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatItem } from '@mr-robot/protocol'
import { ChatView } from '../src/components/ChatView.tsx'
import { FallbackList, fallbacksOf } from '../src/dsh/RobotTrajectory.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-20T10:00:00Z')

describe('a say in the chat (v1.15, gb-ekga)', () => {
  const items: ChatItem[] = [
    {
      kind: 'reply', id: 'say-1', seq: 1, at, text: 'Here is the report.',
      attachments: [
        { name: 'chart.png', path: 'out/chart.png', size: 4_096, contentType: 'image/png' },
        { name: 'shot.png', path: 'screen:2026-10-20T10-00-00-000Z.png', size: 2_048, contentType: 'image/png' },
        { name: 'report.pdf', path: 'out/report 1.pdf', size: 2_300_000, contentType: 'application/pdf' },
      ],
    },
    { kind: 'reply', id: 'say-2', seq: 2, at, text: 'No files here.' },
  ]

  it('shows an image inside the message and any other file as a card to open or download', () => {
    const { container } = render(<ChatView items={items} meId="m-1" working={false} canAnswer={false} now={at} robotId="r-1" />)
    const images = [...container.querySelectorAll('img.reply-image')].map((image) => [image.getAttribute('alt'), image.getAttribute('src')])
    expect(images).toEqual([
      ['chart.png', '/api/robots/r-1/raw?path=out%2Fchart.png'],
      ['shot.png', '/api/robots/r-1/attachments/screen%3A2026-10-20T10-00-00-000Z.png'],
    ])
    const card = screen.getByText('📎 report.pdf')
    expect(card.getAttribute('href')).toBe('/api/robots/r-1/raw?path=out%2Freport%201.pdf')
    expect(screen.getByText('2.2 MB')).toBeTruthy()
    expect(screen.getByLabelText('Download report.pdf').getAttribute('href')).toBe('/api/robots/r-1/raw?path=out%2Freport%201.pdf&download=1')
    // A say without files has none.
    expect(screen.getByText('No files here.').closest('.bubble')!.querySelector('.attachments')).toBeNull()
  })
})

describe('the Trajectory marks a fallback reply (v1.15 ticket 02, gb-7jqy)', () => {
  const say = (seq: number, data: Record<string, unknown>) => ({ seq, type: 'plugin:mr-robot/say', time: seq, data })

  it('lists only the replies the platform showed in place of a say', () => {
    const events = [
      say(3, { id: 'say-call-1', text: 'Said by the Robot.', attachments: [] }),
      say(9, { id: 'fallback-12', text: 'The flat on Prosta is still free.', attachments: [], fallback: true }),
    ]
    expect(fallbacksOf(events as never)).toEqual([{ seq: 9, text: 'The flat on Prosta is still free.' }])
    render(<FallbackList fallbacks={fallbacksOf(events as never)} />)
    expect(screen.getByText('Fallback replies · 1')).toBeTruthy()
    expect(screen.getByText(/The Turn ended without a say; its last assistant text was shown as the reply: “The flat on Prosta is still free.”/)).toBeTruthy()
  })

  it('shows nothing when every reply was a say', () => {
    const { container } = render(<FallbackList fallbacks={fallbacksOf([say(3, { id: 'say-1', text: 'Hi', attachments: [] })] as never)} />)
    expect(container.textContent).toBe('')
  })
})
