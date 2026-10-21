import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

/** Within this many pixels of the bottom the reader counts as being at the bottom. */
export const FOLLOW_THRESHOLD_PX = 80
/** Within this many pixels of the top the page before is loaded. */
export const TOP_THRESHOLD_PX = 400

/**
 * The scrolling area around a Conversation (ap-iyej, ap-8rui, ap-oe45): it follows new items and
 * streamed text only while the reader is at the bottom. Scrolled up, it leaves the view alone and
 * shows a "↓ N new" button that scrolls down and follows again. Scrolling back to the bottom by hand
 * follows again too. Any scroll up by the reader stops following, even inside the threshold, so a
 * stream cannot pull a slowly scrolling reader back down. The row window of a long Conversation
 * follows by the same decision (the second argument of children).
 */
export function ChatScroll({ itemCount, growth, pinSignal = 0, prepended = 0, onTop, children }: {
  /** Items in the Conversation; items added while the reader is away are counted. */
  readonly itemCount: number
  /** Items of older pages put before the first one (v1.19): the view stays where the reader is, and they are not new. */
  readonly prepended?: number
  /** The reader came near the top: the page before can be loaded (v1.19, ec-n0uh). */
  readonly onTop?: () => void
  /** Changes whenever the content under the last item grows (streamed text, the working marker). */
  readonly growth: number
  /** Changing it jumps to the bottom and follows again (the reader sent a message). */
  readonly pinSignal?: number
  readonly children: (scrollRef: RefObject<HTMLDivElement | null>, following: RefObject<boolean>) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  /** The pane at the previous scroll event or pin, to tell a scroll up from content that shrank. */
  const last = useRef({ top: 0, height: 0 })
  const remember = (pane: HTMLDivElement) => { last.current = { top: pane.scrollTop, height: pane.scrollHeight } }
  const latestCount = useRef(itemCount - prepended)
  latestCount.current = itemCount - prepended
  /** The item count at the moment the reader scrolled away; undefined while following. */
  const [awayAt, setAwayAt] = useState<number>()

  const toBottom = useCallback(() => {
    const pane = ref.current
    if (pane !== null) { pane.scrollTop = pane.scrollHeight; remember(pane) }
    following.current = true
    setAwayAt(undefined)
  }, [])

  const scrolled = () => {
    const pane = ref.current
    if (pane === null) return
    const distance = pane.scrollHeight - pane.clientHeight - pane.scrollTop
    const movedUp = pane.scrollTop < last.current.top - 1 && pane.scrollHeight >= last.current.height
    remember(pane)
    const atBottom = distance <= FOLLOW_THRESHOLD_PX && !(movedUp && distance > 1)
    following.current = atBottom
    setAwayAt((current) => (atBottom ? undefined : current ?? latestCount.current))
    if (pane.scrollTop <= TOP_THRESHOLD_PX) onTop?.()
  }

  // Older items went in above: the same content stays in view.
  const seenPrepended = useRef(prepended)
  useLayoutEffect(() => {
    const pane = ref.current
    if (prepended > seenPrepended.current && pane !== null) {
      pane.scrollTop = pane.scrollTop + (pane.scrollHeight - last.current.height)
      remember(pane)
    }
    seenPrepended.current = prepended
  }, [prepended])

  useLayoutEffect(() => {
    const pane = ref.current
    if (following.current && pane !== null) { pane.scrollTop = pane.scrollHeight; remember(pane) }
  }, [itemCount, growth])

  const firstPin = useRef(true)
  useLayoutEffect(() => {
    if (firstPin.current) { firstPin.current = false; return }
    toBottom()
  }, [pinSignal, toBottom])

  const fresh = awayAt === undefined ? 0 : Math.max(0, itemCount - prepended - awayAt)
  return (
    <div className="chat-frame">
      <div className="chat-scroll" ref={ref} onScroll={scrolled}>{children(ref, following)}</div>
      {awayAt === undefined ? null : (
        <button type="button" className="jump-latest" title="Jump to latest" onClick={toBottom}>{fresh > 0 ? `↓ ${fresh} new` : '↓ Latest'}</button>
      )}
    </div>
  )
}
