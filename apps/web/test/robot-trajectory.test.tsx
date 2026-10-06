import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import events from './fixtures/session-events.json'
import { RobotTrajectory, TrajectoryFeed } from '../src/dsh/RobotTrajectory.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// A real Robot session (names replaced): four Turns, the last one a code-mode program calling routine_create.
const serve = () => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sessionId: 's-1', hasMore: false, events })))

describe('the DSH trajectory over Robot events (robot-3ioa, robot-s54i)', () => {
  it('assembles Turns, requests and the code-mode program with its nested call', async () => {
    serve()
    const feed = new TrajectoryFeed('r-fixture')
    await feed.open()
    const snapshot = feed.getSnapshot()
    expect(snapshot.eventNodes.length).toBeGreaterThan(5)
    expect(snapshot.requests.length).toBe(5)
    expect(snapshot.eventNodes.map((node) => node.kind)).toEqual(['context', 'assistant', 'context', 'assistant', 'context', 'assistant', 'context', 'assistant', 'tool-result', 'assistant'])
    const result = snapshot.eventNodes.find((node) => node.kind === 'tool-result')
    // The program's inner call is recorded with its result, as a nested Subtool record.
    expect(JSON.stringify(result)).toContain('"name":"routine_create"')
  })

  it('pages back through older events (robot-gq88)', async () => {
    const all = events as Array<{ seq: number }>
    const split = all.findIndex((event) => event.seq >= 30)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const before = new URL(url, 'https://x').searchParams.get('before')
      return before === null
        ? Response.json({ sessionId: 's-1', hasMore: true, events: all.slice(split) })
        : Response.json({ sessionId: 's-1', hasMore: false, events: all.slice(0, split) })
    }))
    const feed = new TrajectoryFeed('r-fixture')
    await feed.open()
    expect(feed.getPaging().hasMore).toBe(true)
    const recent = feed.getSnapshot().eventNodes.length
    expect(await feed.loadOlder()).toBe(true)
    expect(feed.getPaging().hasMore).toBe(false)
    expect(feed.getSnapshot().eventNodes.length).toBeGreaterThan(recent)
  })

  it('renders the view with its toolbar', async () => {
    serve()
    render(<RobotTrajectory robotId="r-fixture" liveVersion={0} />)
    expect(await screen.findByText('Duration')).toBeTruthy()
  })
})
