import { describe, expect, it } from 'vitest'
import { rowAt, rowOffsets, visibleRange } from '../src/components/row-window.ts'

// Rows of 30, 50, 20, 100 and 40 px: they start at 0, 30, 80, 100 and 200; the list is 240 px tall.
const rows = [30, 50, 20, 100, 40].map((height, index) => ({ key: index, height }))
const offsets = rowOffsets(rows)

describe('row window arithmetic (fe-r2kx)', () => {
  it('finds the row under a given offset', () => {
    expect(offsets).toEqual([0, 30, 80, 100, 200, 240])
    expect(rowAt(offsets, 0)).toBe(0)
    expect(rowAt(offsets, 29)).toBe(0)
    expect(rowAt(offsets, 30)).toBe(1)
    expect(rowAt(offsets, 99)).toBe(2)
    expect(rowAt(offsets, 150)).toBe(3)
    expect(rowAt(offsets, 239)).toBe(4)
  })

  it('renders the rows in view plus overscan, never past either end', () => {
    // A 60 px viewport at 85 shows rows 2 (80–100) and 3 (100–200).
    expect(visibleRange(offsets, 85, 60, 0)).toEqual({ start: 2, end: 4 })
    expect(visibleRange(offsets, 85, 60, 1)).toEqual({ start: 1, end: 5 })
    expect(visibleRange(offsets, 0, 1000, 3)).toEqual({ start: 0, end: 5 })
    expect(visibleRange(rowOffsets([]), 0, 100, 2)).toEqual({ start: 0, end: 0 })
  })
})
