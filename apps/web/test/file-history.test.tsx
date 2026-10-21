import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesView } from '../src/components/FilesView.tsx'

// File history in the Files view (v1.18 ticket 02, rm-7jo4): the History drawer lists versions with their authors, shows one, restores it.
let restored: unknown[]
beforeEach(() => {
  restored = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/robots/r-1/file') return Response.json({ path: 'MEMORY.md', size: 20, text: '# MEMORY.md\nNow.', readOnly: false, note: null })
    if (url.pathname === '/api/robots/r-1/file/history') return Response.json({ path: 'MEMORY.md', current: { at: Date.parse('2026-10-20T10:00:00Z'), by: 'Anna' }, versions: [
      { id: '0000000000001-aaaaaa', at: Date.parse('2026-10-19T10:00:00Z'), by: 'the Robot', replacedAt: Date.parse('2026-10-20T10:00:00Z'), size: 30 },
      { id: '0000000000002-bbbbbb', at: Date.parse('2026-10-18T10:00:00Z'), by: 'the memory sweep', replacedAt: Date.parse('2026-10-19T10:00:00Z'), size: 25 },
    ] })
    if (url.pathname === '/api/robots/r-1/file/version') return Response.json({ version: { id: url.searchParams.get('version'), at: 1, by: 'the Robot', replacedAt: 2, size: 30 }, text: '# MEMORY.md\nWhat the Robot wrote.' })
    if (url.pathname === '/api/robots/r-1/file/restore' && init?.method === 'POST') {
      restored.push(JSON.parse(new TextDecoder().decode(init.body as Uint8Array)))
      return Response.json({ path: 'MEMORY.md', size: 30, text: '# MEMORY.md\nWhat the Robot wrote.', readOnly: false, note: null })
    }
    return Response.json({})
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the History drawer (rm-7jo4)', () => {
  it('lists who wrote each version, shows one, and restores it into the editor', async () => {
    render(<RegistryProvider><FilesView robotId="r-1" path="MEMORY.md" canEdit onOpen={() => {}} /></RegistryProvider>)
    fireEvent.click(await screen.findByText('History'))
    expect(await screen.findByText(/Now: written by Anna/)).toBeTruthy()
    expect(screen.getByText(/· the Robot$/)).toBeTruthy()
    expect(screen.getByText(/· the memory sweep$/)).toBeTruthy()
    fireEvent.click(screen.getAllByText('Show')[0]!)
    expect((await screen.findByLabelText('Version text')).textContent).toBe('# MEMORY.md\nWhat the Robot wrote.')
    fireEvent.click(screen.getAllByText('Restore')[0]!)
    await waitFor(() => expect(restored).toEqual([{ version: '0000000000001-aaaaaa' }]))
    await waitFor(() => expect((screen.getByLabelText('Edit MEMORY.md') as HTMLTextAreaElement).value).toBe('# MEMORY.md\nWhat the Robot wrote.'))
  })

  it('is offered only for persona and memory files', async () => {
    render(<RegistryProvider><FilesView robotId="r-1" path="notes/a.md" canEdit onOpen={() => {}} /></RegistryProvider>)
    await screen.findByLabelText('Edit notes/a.md')
    expect(screen.queryByText('History')).toBeNull()
  })
})
