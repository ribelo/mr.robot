import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem } from '@mr-robot/protocol'
import { ChatScroll } from '../src/components/ChatScroll.tsx'
import { ChatView } from '../src/components/ChatView.tsx'

// jsdom lays nothing out: the scroll container's geometry is a fake the tests move around.
const geometry = { scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 }
const descriptors = {
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
}
beforeEach(() => {
  Object.assign(geometry, { scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 })
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => geometry.scrollHeight })
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => geometry.clientHeight })
  Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get: () => geometry.scrollTop, set: (value: number) => { geometry.scrollTop = Math.min(value, geometry.scrollHeight - geometry.clientHeight) } })
})
afterEach(() => {
  cleanup()
  for (const [name, descriptor] of Object.entries(descriptors)) if (descriptor !== undefined) Object.defineProperty(Element.prototype, name, descriptor)
})

const at = Date.parse('2026-10-06T18:00:00Z')
const reply = (n: number): ChatItem => ({ kind: 'reply', id: `i-${n}`, seq: n, at, text: `line ${n}` })
const items = (count: number): ChatItem[] => Array.from({ length: count }, (_, n) => reply(n))

function Page({ count, streamed = 0 }: { count: number; streamed?: number }) {
  return (
    <ChatScroll itemCount={count} growth={streamed}>
      {(scrollRef, following) => <ChatView items={items(count)} meId="m-1" working={streamed > 0} canAnswer={false} now={at} scrollRef={scrollRef} following={following} {...(streamed > 0 ? { stream: { text: 'x'.repeat(streamed), thinking: '' } } : {})} />}
    </ChatScroll>
  )
}
const scrollUp = (container: HTMLElement) => {
  geometry.scrollTop = 200
  fireEvent.scroll(container.querySelector('.chat-scroll')!)
}

describe('stick to bottom (ap-iyej, ap-8rui, ap-oe45)', () => {
  it('follows stream growth at the bottom and leaves the view alone when scrolled up (ap-iyej)', () => {
    const { container, rerender } = render(<Page count={5} streamed={10} />)
    expect(geometry.scrollTop).toBe(1500)
    geometry.scrollHeight = 2400
    rerender(<Page count={5} streamed={80} />)
    expect(geometry.scrollTop).toBe(1900)

    scrollUp(container)
    geometry.scrollHeight = 3000
    rerender(<Page count={5} streamed={200} />)
    expect(geometry.scrollTop).toBe(200)
  })

  it('stops following on a small scroll up inside the threshold (ap-iyej)', () => {
    const { container, rerender } = render(<Page count={5} streamed={10} />)
    geometry.scrollTop = 1470
    fireEvent.scroll(container.querySelector('.chat-scroll')!)
    geometry.scrollHeight = 2400
    rerender(<Page count={5} streamed={80} />)
    expect(geometry.scrollTop).toBe(1470)
    // Back down by hand: following again.
    geometry.scrollTop = 1880
    fireEvent.scroll(container.querySelector('.chat-scroll')!)
    geometry.scrollHeight = 2600
    rerender(<Page count={5} streamed={160} />)
    expect(geometry.scrollTop).toBe(2100)
  })

  it('counts new messages on a button while scrolled up, and hides it at the bottom (ap-8rui)', () => {
    const { container, rerender } = render(<Page count={5} />)
    expect(screen.queryByTitle('Jump to latest')).toBeNull()
    scrollUp(container)
    rerender(<Page count={5} />)
    expect(screen.getByTitle('Jump to latest').textContent).toBe('↓ Latest')
    geometry.scrollHeight = 2300
    rerender(<Page count={7} />)
    expect(screen.getByTitle('Jump to latest').textContent).toBe('↓ 2 new')
    expect(geometry.scrollTop).toBe(200)

    // Scrolling back by hand reaches the bottom: the button goes and following resumes (ap-oe45).
    geometry.scrollTop = geometry.scrollHeight - geometry.clientHeight - 10
    fireEvent.scroll(container.querySelector('.chat-scroll')!)
    expect(screen.queryByTitle('Jump to latest')).toBeNull()
    geometry.scrollHeight = 2600
    rerender(<Page count={8} />)
    expect(geometry.scrollTop).toBe(2100)
  })

  it('jumps to the bottom from the button and follows again (ap-8rui, ap-oe45)', () => {
    const { container, rerender } = render(<Page count={5} />)
    scrollUp(container)
    geometry.scrollHeight = 2300
    rerender(<Page count={6} />)
    fireEvent.click(screen.getByTitle('Jump to latest'))
    expect(geometry.scrollTop).toBe(1800)
    expect(screen.queryByTitle('Jump to latest')).toBeNull()
    geometry.scrollHeight = 2500
    rerender(<Page count={7} />)
    expect(geometry.scrollTop).toBe(2000)
  })

  it('works on a 2000-item conversation, which renders through the row window', () => {
    geometry.scrollHeight = 130_000
    geometry.scrollTop = 129_500
    const { container, rerender } = render(<Page count={2000} streamed={10} />)
    expect(container.querySelectorAll('[data-item]').length).toBeLessThan(200)
    expect(geometry.scrollTop).toBe(129_500)
    scrollUp(container)
    geometry.scrollHeight = 130_100
    rerender(<Page count={2001} streamed={500} />)
    expect(geometry.scrollTop).toBe(200)
    expect(screen.getByTitle('Jump to latest').textContent).toBe('↓ 1 new')
    fireEvent.click(screen.getByTitle('Jump to latest'))
    expect(geometry.scrollTop).toBe(129_600)
  })
})
