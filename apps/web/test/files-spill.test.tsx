import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileView } from '@mr-robot/protocol'
import { FilesView } from '../src/components/FilesView.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const files: WorkspaceFileView[] = [
  { path: 'spill/s-1/call-1-grep.txt', size: 40_000, updatedAt: 1, group: 'spill' },
  { path: 'MEMORY.md', size: 10, updatedAt: 1, group: 'persona' },
  { path: 'out/report.md', size: 10, updatedAt: 1, group: 'other' },
  { path: 'docs/robots.md', size: 10, updatedAt: 0, group: 'docs' },
  { path: 'screens/a.png', size: 10, updatedAt: 1, group: 'screens' },
]

describe('Files lists spill/ last (ao-ry61)', () => {
  it('shows the spilled tool results after every other group, folded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(files)))
    const { container } = render(<RegistryProvider><FilesView robotId="r-1" path={null} canEdit={false} onOpen={vi.fn()} /></RegistryProvider>)
    await screen.findByText('spill/s-1/call-1-grep.txt')
    const groups = [...container.querySelectorAll('.file-group')]
    const last = groups.at(-1)!
    expect(last.tagName).toBe('DETAILS')
    expect(last.textContent).toContain('Spilled tool results')
    expect(last.textContent).toContain('spill/s-1/call-1-grep.txt')
    expect(groups.findIndex((group) => group.textContent?.includes('Other files'))).toBeLessThan(groups.length - 1)
  })
})
