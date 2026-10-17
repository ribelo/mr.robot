/**
 * A dense table that renders only the rows in view (mc-m3cc): fixed row height, the visible window plus a margin,
 * one line per row and fixed columns (mc-m2bb). No dependency: the window is arithmetic over the scroll offset.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export interface WindowedTableProps<T> {
  readonly label: string
  readonly rows: readonly T[]
  readonly rowKey: (row: T) => string
  /** One line: every row is this many pixels high. */
  readonly rowHeight: number
  /** CSS grid-template-columns shared by the header and every row. */
  readonly columns: string
  readonly header: ReactNode
  readonly renderRow: (row: T) => ReactNode
  /** Extra class of a row (a group header, an overdue Task). */
  readonly rowClass?: (row: T) => string
  readonly onRowClick?: (row: T) => void
  /** The viewport's height when the page has not laid it out yet (tests, the first render). */
  readonly height?: number
  /** Rows rendered beyond the window on each side. */
  readonly margin?: number
  /** The window reached the last rows: load the next page. */
  readonly onEnd?: () => void
}

/** Which rows a window shows: [start, end) for the scroll offset, the viewport height and the margin. */
export function visibleRange(count: number, rowHeight: number, scrollTop: number, viewport: number, margin: number): { start: number; end: number } {
  const first = Math.floor(scrollTop / rowHeight)
  const last = Math.ceil((scrollTop + viewport) / rowHeight)
  return { start: Math.max(0, first - margin), end: Math.min(count, last + margin) }
}

export function WindowedTable<T>({ label, rows, rowKey, rowHeight, columns, header, renderRow, rowClass, onRowClick, height = 600, margin = 10, onEnd }: WindowedTableProps<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(height)
  useEffect(() => {
    const element = scroller.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (element.clientHeight > 0) setViewport(element.clientHeight) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const { start, end } = visibleRange(rows.length, rowHeight, scrollTop, viewport, margin)
  useEffect(() => { if (onEnd !== undefined && rows.length > 0 && end >= rows.length) onEnd() }, [end, rows.length, onEnd])
  const onScroll = useCallback(() => setScrollTop(scroller.current?.scrollTop ?? 0), [])
  return (
    <div className="wt" role="table" aria-label={label} aria-rowcount={rows.length}>
      <div className="wt-head" role="row" style={{ gridTemplateColumns: columns }}>{header}</div>
      <div className="wt-scroll" ref={scroller} onScroll={onScroll}>
        <div className="wt-space" style={{ height: rows.length * rowHeight }}>
          {rows.slice(start, end).map((row, offset) => (
            <div
              key={rowKey(row)}
              role="row"
              aria-rowindex={start + offset + 1}
              className={`wt-row${rowClass === undefined ? '' : ` ${rowClass(row)}`}`}
              style={{ top: (start + offset) * rowHeight, height: rowHeight, gridTemplateColumns: columns }}
              {...(onRowClick === undefined ? {} : { onClick: () => onRowClick(row), tabIndex: 0, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter') onRowClick(row) } })}
            >
              {renderRow(row)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
