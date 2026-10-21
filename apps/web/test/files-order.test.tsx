import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesView } from '../src/components/FilesView.tsx'

// The Files view order (v1.18 ticket 01, rm-w88a): the two persona files and MEMORY.md first, then daily notes and the rest.
const file = (path: string, group: string) => ({ path, group, size: 10, updatedAt: Date.parse('2026-10-20T10:00:00Z') })
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([
    file('SOUL.md', 'persona'), file('AGENTS.md', 'persona'), file('MEMORY.md', 'persona'),
    file('memory/2026-10-20.md', 'daily'), file('notes/plan.md', 'other'),
  ])))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the Files view order (rm-w88a)', () => {
  it('shows SOUL.md, AGENTS.md and MEMORY.md under Persona and memory, before the daily notes', async () => {
    render(<RegistryProvider><FilesView robotId="r-1" path={null} canEdit onOpen={() => {}} /></RegistryProvider>)
    await screen.findByText('SOUL.md')
    const names = [...document.querySelectorAll('.file-name')].map((node) => node.textContent)
    expect(names).toEqual(['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'memory/2026-10-20.md', 'notes/plan.md'])
    expect(screen.getByText('Persona and memory')).toBeTruthy()
  })
})
