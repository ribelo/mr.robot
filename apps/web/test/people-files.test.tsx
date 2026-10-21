import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesView } from '../src/components/FilesView.tsx'

// People pages in the Files view (v1.20 ticket 04, dm-ii3r): the owner's pages under Member files, after the daily notes.
const file = (path: string, group: string) => ({ path, group, size: 10, updatedAt: Date.parse('2026-10-20T10:00:00Z') })
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([
    file('MEMORY.md', 'persona'), file('memory/2026-10-20.md', 'daily'),
    file('memory/people/INDEX.md', 'member'), file('memory/people/jan-kowalski.md', 'member'), file('notes/plan.md', 'other'),
  ])))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('people pages in the Files view (dm-ii3r)', () => {
  it('lists the pages under Member files, after the daily notes', async () => {
    render(<RegistryProvider><FilesView robotId="r-1" path={null} canEdit onOpen={() => {}} /></RegistryProvider>)
    await screen.findByText('memory/people/jan-kowalski.md')
    expect(screen.getByText('Member files: people pages')).toBeTruthy()
    const names = [...document.querySelectorAll('.file-name')].map((node) => node.textContent)
    expect(names).toEqual(['MEMORY.md', 'memory/2026-10-20.md', 'memory/people/INDEX.md', 'memory/people/jan-kowalski.md', 'notes/plan.md'])
  })
})
