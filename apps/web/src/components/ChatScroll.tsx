import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

/** Within this many pixels of the bottom the reader counts as being at the bottom. */
export const FOLLOW_THRESHOLD_PX = 80

/**
 * The scrolling area around a Conversation (ap-iyej, ap-8rui, ap-oe45): it follows new items and
 * streamed text only while the reader is at the bottom. Scrolled up, it leaves the view alone and
 * shows a "↓ N new" button that scrolls down and follows again. Scrolling back to the bottom by hand
 * follows again too.
 */
export function ChatScroll({ itemCount, growth, pinSignal = 0, children }: {
  /** Items in the Conversation; items added while the reader is away are counted. */
  readonly itemCount: number
  /** Changes whenever the content under the last item grows (streamed text, the working marker). */
  readonly growth: number
  /** Changing it jumps to the bottom and follows again (the reader sent a message). */
  readonly pinSignal?: number
  readonly children: (scrollRef: RefObject<HTMLDivElement | null>) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const latestCount = useRef(itemCount)
  latestCount.current = itemCount
  /** The item count at the moment the reader scrolled away; undefined while following. */
  const [awayAt, setAwayAt] = useState<number>()

  const toBottom = useCallback(() => {
    const pane = ref.current
    if (pane !== null) pane.scrollTop = pane.scrollHeight
    following.current = true
    setAwayAt(undefined)
  }, [])

  const scrolled = () => {
    const pane = ref.current
    if (pane === null) return
    const atBottom = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= FOLLOW_THRESHOLD_PX
    following.current = atBottom
    setAwayAt((current) => (atBottom ? undefined : current ?? latestCount.current))
  }

  useLayoutEffect(() => {
    const pane = ref.current
    if (following.current && pane !== null) pane.scrollTop = pane.scrollHeight
  }, [itemCount, growth])

  const firstPin = useRef(true)
  useLayoutEffect(() => {
    if (firstPin.current) { firstPin.current = false; return }
    toBottom()
  }, [pinSignal, toBottom])

  const fresh = awayAt === undefined ? 0 : Math.max(0, itemCount - awayAt)
  return (
    <div className="chat-frame">
      <div className="chat-scroll" ref={ref} onScroll={scrolled}>{children(ref)}</div>
      {awayAt === undefined ? null : (
        <button type="button" className="jump-latest" title="Jump to latest" onClick={toBottom}>{fresh > 0 ? `↓ ${fresh} new` : '↓ Latest'}</button>
      )}
    </div>
  )
}
