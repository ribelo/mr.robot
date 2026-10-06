import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Trajectory } from '@mr-robot/protocol'
import { TrajectoryView } from '../src/components/TrajectoryView.tsx'

afterEach(cleanup)

const event = (seq: number, type: string, turn: number | null, data: unknown) => ({ seq, type, turn, time: 0, data: JSON.stringify(data) })

const trajectory: Trajectory = {
  robotId: 'r-1',
  sessionId: 's-2',
  events: [
    event(0, 'turn/start', 1, { turn: 1 }),
    event(1, 'user/message', 1, { content: [{ type: 'text', text: 'I like blue.' }], source: { kind: 'member' } }),
    event(2, 'tool/call', 1, { name: 'web_fetch', arguments: '{"url":"https://x"}', callId: 'c1' }),
    event(3, 'turn/end', 1, { turn: 1 }),
    event(4, 'turn/start', 2, { turn: 2 }),
    event(5, 'user/message', 2, { content: [{ type: 'text', text: 'Order the red one.' }], source: { kind: 'member' } }),
  ],
  rewinds: [{ id: 'rw-1', atSeq: 3, archivedSessionId: 's-1', liveSessionId: 's-2', at: 0, undone: false }],
}

describe('TrajectoryView (robot-h5v3, robot-0q6a)', () => {
  it('groups events by Turn and shows tool calls', () => {
    render(<TrajectoryView trajectory={trajectory} canRewind={false} onRewind={vi.fn()} onUndo={vi.fn()} />)
    expect(screen.getByText('Turn 1')).toBeTruthy()
    expect(screen.getByText('Turn 2')).toBeTruthy()
    expect(screen.getByText('web_fetch({"url":"https://x"})')).toBeTruthy()
    expect(screen.queryByText('Rewind to before this')).toBeNull()
  })

  it('rewinds to just before a Member message and offers to undo the latest rewind', () => {
    const onRewind = vi.fn()
    const onUndo = vi.fn()
    render(<TrajectoryView trajectory={trajectory} canRewind={true} onRewind={onRewind} onUndo={onUndo} />)
    const buttons = screen.getAllByText('Rewind to before this')
    fireEvent.click(buttons[1]!)
    expect(onRewind).toHaveBeenCalledWith(4)
    fireEvent.click(screen.getByText('Undo rewind'))
    expect(onUndo).toHaveBeenCalledWith(trajectory.rewinds[0])
  })
})
