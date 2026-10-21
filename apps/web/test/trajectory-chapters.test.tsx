import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChapterView } from '@mr-robot/protocol'
import { ChapterBar } from '../src/components/ChapterBar.tsx'

// The Trajectory a chapter at a time (v1.19 ticket 04, ec-mwvo): Previous, Next and the picker.
afterEach(cleanup)

const day = Date.parse('2026-10-01T09:00:00Z')
const chapters: ChapterView[] = [
  { ordinal: 1, sessionId: 's-1', openedAt: day, closedAt: day + 86_400_000, closedBy: 'compaction', superseded: false, turns: 19, firstSeq: 0 },
  { ordinal: 2, sessionId: 's-2', openedAt: day + 86_400_000, closedAt: day + 2 * 86_400_000, closedBy: 'rewind', superseded: false, turns: 1, firstSeq: 12 },
  { ordinal: 3, sessionId: 's-3', openedAt: day + 2 * 86_400_000, closedAt: null, closedBy: null, superseded: false, turns: 4, firstSeq: 9 },
]

function bar(shown: number) {
  const asked: number[] = []
  render(<ChapterBar chapters={chapters} shown={shown} onShow={(ordinal) => asked.push(ordinal)} />)
  return asked
}

describe('the chapter bar of the Trajectory (ec-mwvo)', () => {
  it('names each chapter by its dates, Turns and why it closed', () => {
    bar(3)
    const options = [...screen.getByLabelText('Chapter').querySelectorAll('option')].map((option) => option.textContent)
    expect(options).toHaveLength(3)
    expect(options[0]).toMatch(/^Chapter 1 · .+ – .+ · 19 Turns · closed by compaction$/)
    expect(options[1]).toMatch(/· 1 Turn · closed by a Rewind$/)
    expect(options[2]).toMatch(/– now · 4 Turns · live$/)
  })

  it('goes to the chapter before and after, and to the one picked', () => {
    const asked = bar(2)
    fireEvent.click(screen.getByText('‹ Previous'))
    fireEvent.click(screen.getByText('Next ›'))
    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: '3' } })
    expect(asked).toEqual([1, 3, 3])
  })

  it('has no Previous at the first chapter and no Next at the live one', () => {
    bar(1)
    expect((screen.getByText('‹ Previous') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    bar(3)
    expect((screen.getByText('Next ›') as HTMLButtonElement).disabled).toBe(true)
  })
})
