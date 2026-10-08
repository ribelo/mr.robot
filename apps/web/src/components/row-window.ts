/**
 * Windowing for long lists with known row heights (fe-r2kx): which rows to render for the scroll
 * position, padding for the rest, scroll-to-index, follow the end while new rows arrive, and keep the
 * visible row in place when rows are added above it (older history loaded).
 */
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export interface WindowRow {
  readonly key: string | number
  readonly height: number
}

export interface RowRange {
  /** First rendered index (inclusive). */
  readonly start: number
  /** Last rendered index (exclusive). */
  readonly end: number
}

/** Start offset of each row, plus the total height as the last element. */
export function rowOffsets(rows: ReadonlyArray<WindowRow>): number[] {
  const offsets = new Array<number>(rows.length + 1)
  offsets[0] = 0
  for (let index = 0; index < rows.length; index += 1) offsets[index + 1] = offsets[index]! + rows[index]!.height
  return offsets
}

/** The index of the row containing offset y (binary search over the start offsets). */
export function rowAt(offsets: ReadonlyArray<number>, y: number): number {
  let low = 0
  let high = offsets.length - 2
  if (high < 0) return 0
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (offsets[middle]! <= y) low = middle
    else high = middle - 1
  }
  return low
}

/** Rows intersecting [top, top + viewport), widened by overscan rows on each side. */
export function visibleRange(offsets: ReadonlyArray<number>, top: number, viewport: number, overscan: number): RowRange {
  const count = offsets.length - 1
  if (count <= 0) return { start: 0, end: 0 }
  const first = rowAt(offsets, Math.max(0, top))
  const last = rowAt(offsets, Math.max(0, top + viewport - 1))
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) }
}

export interface RowWindow {
  readonly range: RowRange
  /** Space before the first rendered row and after the last one. */
  readonly paddingTop: number
  readonly paddingBottom: number
  readonly totalHeight: number
  scrollToIndex(index: number, options: { readonly align: 'start' | 'center'; readonly behavior: ScrollBehavior }): void
  scrollToEnd(): void
}

export function useRowWindow({ rows, scrollElement, enabled, overscan, margin, initialViewport, followThreshold }: {
  readonly rows: ReadonlyArray<WindowRow>
  readonly scrollElement: RefObject<HTMLElement | null>
  readonly enabled: boolean
  readonly overscan: number
  /** Content above the rows inside the scroll element (a "load older" row). */
  readonly margin: number
  readonly initialViewport: number
  /** Within this many pixels of the bottom, new rows keep the view at the end. */
  readonly followThreshold: number
}): RowWindow {
  const [viewport, setViewport] = useState({ top: 0, height: initialViewport })
  const offsets = rowOffsets(enabled ? rows : [])
  const totalHeight = offsets[offsets.length - 1] ?? 0

  // Track the scroll position and the pane's height.
  useLayoutEffect(() => {
    const pane = scrollElement.current
    if (pane === null || !enabled) return
    const read = () => setViewport({ top: pane.scrollTop - margin, height: pane.clientHeight || initialViewport })
    read()
    pane.addEventListener('scroll', read, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(read)
    observer?.observe(pane)
    return () => { pane.removeEventListener('scroll', read); observer?.disconnect() }
  }, [scrollElement, enabled, margin, initialViewport])

  // Before rows change: remember the first visible row by key and whether the view sat at the end.
  const anchor = useRef<{ key: string | number; offset: number; atEnd: boolean } | null>(null)
  const previousRows = useRef(rows)
  if (previousRows.current !== rows) {
    const pane = scrollElement.current
    const before = previousRows.current
    if (pane !== null && enabled && before.length > 0) {
      const beforeOffsets = rowOffsets(before)
      const top = pane.scrollTop - margin
      const index = rowAt(beforeOffsets, Math.max(0, top))
      const row = before[index]
      const atEnd = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= followThreshold
      if (row !== undefined) anchor.current = { key: row.key, offset: top - beforeOffsets[index]!, atEnd }
    }
    previousRows.current = rows
  }
  // After they changed: stay at the end, or put the remembered row back where it was.
  useLayoutEffect(() => {
    const pane = scrollElement.current
    const remembered = anchor.current
    anchor.current = null
    if (pane === null || remembered === null || !enabled) return
    if (remembered.atEnd) {
      pane.scrollTop = pane.scrollHeight
      return
    }
    const index = rows.findIndex((row) => row.key === remembered.key)
    if (index === -1) return
    const target = offsets[index]! + remembered.offset + margin
    if (Math.abs(pane.scrollTop - target) > 1) pane.scrollTop = target
  })

  const range = enabled ? visibleRange(offsets, viewport.top, viewport.height, overscan) : { start: 0, end: 0 }
  const scrollToIndex = useCallback((index: number, options: { readonly align: 'start' | 'center'; readonly behavior: ScrollBehavior }) => {
    const pane = scrollElement.current
    if (pane === null) return
    const all = rowOffsets(rows)
    const start = (all[index] ?? 0) + margin
    const height = rows[index]?.height ?? 0
    const top = options.align === 'start' ? start : start - (pane.clientHeight - height) / 2
    pane.scrollTo({ top: Math.max(0, top), behavior: options.behavior })
  }, [rows, scrollElement, margin])
  const scrollToEnd = useCallback(() => {
    const pane = scrollElement.current
    if (pane !== null) pane.scrollTop = pane.scrollHeight
  }, [scrollElement])

  return {
    range,
    paddingTop: offsets[range.start] ?? 0,
    paddingBottom: Math.max(0, totalHeight - (offsets[range.end] ?? totalHeight)),
    totalHeight,
    scrollToIndex,
    scrollToEnd,
  }
}
