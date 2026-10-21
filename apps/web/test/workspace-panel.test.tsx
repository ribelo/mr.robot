/**
 * The Workspace panel (v1.21 ticket 08, cw-1wrt): where the Robot works and is now, the checkout's files listed on demand, and git's
 * status and commits read through the Host.
 */
import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePanel } from '../src/components/WorkspacePanel.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const workspace = { hostId: 'h-desk', host: 'Desk', root: '/home/anna/repo', repository: '/home/anna/repo', worktree: '/home/anna/repo/.agents/worktrees/coder' }

describe('the Workspace panel (cw-1wrt)', () => {
  it('shows the place and the current directory, lists files on demand and walks into a folder, and reads git', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost')
      asked.push(url.pathname + url.search)
      if (url.pathname === '/api/robots/r-1/workspace') return Response.json({ setting: workspace, cwd: '/home/anna/repo/.agents/worktrees/coder/src' })
      if (url.pathname === '/api/robots/r-1/workspace/files') {
        const path = url.searchParams.get('path')
        return Response.json(path === 'src'
          ? { path: 'src', entries: [{ name: 'a.ts', kind: 'file', size: 9 }], truncated: false }
          : { path: '', entries: [{ name: 'src', kind: 'directory', size: null }, { name: 'README.md', kind: 'file', size: 120 }], truncated: false })
      }
      if (url.pathname === '/api/robots/r-1/workspace/git') return Response.json({ branch: 'coder', status: [{ code: ' M', path: 'src/a.ts' }], log: [{ hash: 'c0ffee1234567', subject: 'Add the greeting', author: 'Coder', at: 1 }] })
      return Response.json({})
    }))
    render(<RegistryProvider><WorkspacePanel robotId="r-1" workspace={workspace} /></RegistryProvider>)
    const panel = screen.getByRole('region', { name: 'Workspace' })
    expect(within(panel).getByText('Desk')).toBeTruthy()
    expect(within(panel).getByText('/home/anna/repo/.agents/worktrees/coder')).toBeTruthy()
    expect(await within(panel).findByText('/home/anna/repo/.agents/worktrees/coder/src')).toBeTruthy()
    expect(asked.some((path) => path.includes('/workspace/files'))).toBe(false)
    fireEvent.click(within(panel).getByRole('button', { name: 'Files' }))
    fireEvent.click(await within(panel).findByRole('button', { name: 'src/' }))
    expect(await within(panel).findByText('a.ts')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Git status' }))
    expect(await within(panel).findByText('Add the greeting')).toBeTruthy()
    expect(within(panel).getByText('1 changed', { exact: false })).toBeTruthy()
    expect(within(panel).getByText('c0ffee1')).toBeTruthy()
  })
})
