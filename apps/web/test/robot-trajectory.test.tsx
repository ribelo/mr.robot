import { cleanup, render, screen } from '@testing-library/react'
import { RegistryProvider } from '@effect/atom-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import events from './fixtures/session-events.json'
import { RobotTrajectory } from '../src/dsh/RobotTrajectory.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// A real Robot session (names replaced): four Turns, the last one a code-mode program calling routine_create.
const all = events as Array<{ seq: number }>

function serveEvents(page: (query: URLSearchParams) => { hasMore: boolean; events: unknown[] }) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    calls.push(url.search)
    return Response.json({ sessionId: 's-1', ...page(url.searchParams) })
  }))
  return calls
}

const rows = () => [...document.querySelectorAll('tr[data-kind]')].map((row) => row.getAttribute('data-kind'))

describe('the trajectory page over Robot events (robot-3ioa, robot-s54i, fe-r2kx)', () => {
  it('shows the Turns, requests and the code-mode program with its nested call', async () => {
    serveEvents(() => ({ hasMore: false, events: all }))
    render(<RegistryProvider><RobotTrajectory robotId="r-fixture-1" liveVersion={0} /></RegistryProvider>)
    expect(await screen.findByText('Duration')).toBeTruthy()
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(5))
    expect(rows()).toContain('tool')
    expect(document.body.textContent).toContain('routine_create')
  })

  it('reads the events written since on each live change (fe-xp06)', async () => {
    const split = all.findIndex((event) => event.seq >= 30)
    const calls = serveEvents((query) => (query.get('after') === null ? { hasMore: false, events: all.slice(0, split) } : { hasMore: false, events: all.slice(split) }))
    const { rerender } = render(<RegistryProvider><RobotTrajectory robotId="r-fixture-2" liveVersion={0} /></RegistryProvider>)
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const before = rows().length
    rerender(<RegistryProvider><RobotTrajectory robotId="r-fixture-2" liveVersion={1} /></RegistryProvider>)
    await vi.waitFor(() => expect(calls.some((search) => search.includes('after='))).toBe(true))
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(before))
  })

  it('shows a failure as the error state with Try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'no such robot' }, { status: 404 })))
    render(<RegistryProvider><RobotTrajectory robotId="r-fixture-3" liveVersion={0} /></RegistryProvider>)
    expect((await screen.findByRole('alert')).textContent).toContain('No such robot.')
  })
})
