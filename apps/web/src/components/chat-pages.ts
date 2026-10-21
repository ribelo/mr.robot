/**
 * The chat as pages (v1.19, ec-n0uh): the newest page, which the app reads again whenever the Robot changes, and the older pages the
 * reader scrolled back to, by the cursor each page gives. The Conversation reads as one: a fresh newest page replaces the items from
 * its first item on, and an older page goes before the first item kept.
 */
import { useCallback, useRef, useState } from 'react'
import type { ChatItem, Conversation } from '@mr-robot/protocol'

export interface ChatPages {
  readonly items: readonly ChatItem[]
  /** The cursor of the page before the first item kept; null at the Conversation's start. */
  readonly before: string | null
  /** How many items came from older pages: they are not new to the reader. */
  readonly prepended: number
}

/** The newest page arrived: it replaces what is kept from its first item on; one that does not meet what is kept starts again. */
export function withNewest(kept: ChatPages | undefined, page: Conversation): ChatPages {
  const fresh: ChatPages = { items: page.items, before: page.before ?? null, prepended: 0 }
  const first = page.items[0]
  if (kept === undefined || first === undefined) return fresh
  const at = kept.items.findIndex((item) => item.id === first.id)
  if (at < 0) return fresh
  return { items: [...kept.items.slice(0, at), ...page.items], before: at === 0 ? page.before ?? null : kept.before, prepended: kept.prepended }
}

/** An older page arrived: its items go before the first one kept. */
export function withOlder(kept: ChatPages, page: Conversation): ChatPages {
  const known = new Set(kept.items.map((item) => item.id))
  const added = page.items.filter((item) => !known.has(item.id))
  return { items: [...added, ...kept.items], before: page.before ?? null, prepended: kept.prepended + added.length }
}

/** The pages of one chat; older() loads the page before the first item kept, once at a time, and gives the pages then (undefined: none loaded). */
export function useChatPages(newest: Conversation, load: (before: string) => Promise<Conversation | undefined>): ChatPages & { readonly older: () => Promise<ChatPages | undefined> } {
  const [kept, setKept] = useState<ChatPages>(() => withNewest(undefined, newest))
  const seen = useRef(newest)
  let current = kept
  if (seen.current !== newest) {
    seen.current = newest
    current = withNewest(kept, newest)
    setKept(current)
  }
  const latest = useRef(current)
  latest.current = current
  const loading = useRef(false)
  const older = useCallback(async () => {
    const before = latest.current.before
    if (before === null || loading.current) return undefined
    loading.current = true
    try {
      const page = await load(before)
      if (page === undefined || latest.current.before !== before) return undefined
      const next = withOlder(latest.current, page)
      latest.current = next
      setKept(next)
      return next
    } finally {
      loading.current = false
    }
  }, [load])
  return { ...current, older }
}
