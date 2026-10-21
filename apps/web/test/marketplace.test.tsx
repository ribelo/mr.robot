import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Marketplace } from '../src/components/Marketplace.tsx'

// The Marketplace page (v1.18 ticket 06, rm-vhrq, rm-10ai): definitions with their needs, met or not, and Add.
const entry = {
  definition: { slug: 'bookkeeper', title: 'Bookkeeper', paragraph: 'Collects the invoices every week.', source: 'git', author: 'the library repository', published: true, mine: false, updatedAt: Date.parse('2026-10-20T10:00:00Z') },
  tools: ['files'],
  needs: [{ kind: 'connector', label: 'google (sends)', met: true }, { kind: 'host', label: 'a computer (shell)', met: false }],
}
let added: string[]
let bodies: unknown[]
const desk = { id: 'h-desk', name: 'Desk', platform: 'linux', ownerId: 'm-1', ownerName: 'Anna', sharing: 'private', online: true, lastSeen: null, version: null, capabilities: null, mine: true, users: [] }
beforeEach(() => {
  added = []
  bodies = []
  location.hash = '#/marketplace'
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/marketplace') return Response.json([entry])
    if (url.pathname === '/api/hosts') return Response.json([desk])
    if (url.pathname === '/api/definitions/bookkeeper/add' && init?.method === 'POST') {
      added.push('bookkeeper')
      const raw = init.body
      bodies.push(JSON.parse(ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)))
      return Response.json({ id: 'r-new', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'setup', fleetState: 'sleeping', turn: null, lastWakeup: null, identity: { name: 'Bookkeeper', title: '', description: '', avatarColor: '#f4a03a', avatarSeed: 'r-new' }, lastLine: '', lastAt: 0, unread: false })
    }
    return Response.json({})
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the Marketplace page (rm-vhrq, rm-10ai)', () => {
  it('shows each definition with what it needs, marks what the Member has, and Add opens the new Robot', async () => {
    render(<RegistryProvider><Marketplace isAdmin={false} /></RegistryProvider>)
    expect(await screen.findByText('Bookkeeper')).toBeTruthy()
    expect(screen.getByText('Collects the invoices every week.')).toBeTruthy()
    const needs = screen.getByLabelText('Needs of Bookkeeper')
    expect(needs.textContent).toContain('✓ google (sends)')
    expect([...needs.querySelectorAll('.pill-warn')].map((node) => node.textContent)).toEqual(['a computer (shell)'])
    expect(screen.getByText('Download definition').getAttribute('href')).toBe('/api/definitions/bookkeeper/archive')
    expect(screen.queryByText('Publish')).toBeNull()
    expect(screen.queryByText('Unpublish')).toBeNull()
    // It needs a computer, so Add asks for the Workspace first (v1.21, cw-nm6y).
    fireEvent.click(screen.getByText('Add'))
    const form = await screen.findByRole('group', { name: 'Workspace for Bookkeeper' })
    await waitFor(() => expect((form.querySelector('select') as HTMLSelectElement).value).toBe('h-desk'))
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: '~/books' } })
    fireEvent.click(screen.getByText('Add with this Workspace'))
    await waitFor(() => expect(added).toEqual(['bookkeeper']))
    expect(bodies).toEqual([{ workspace: { host: 'h-desk', root: '~/books' } }])
    await waitFor(() => expect(location.hash).toBe('#/r/r-new'))
  })

  it('gives the admin Unpublish and Remove', async () => {
    render(<RegistryProvider><Marketplace isAdmin /></RegistryProvider>)
    expect(await screen.findByText('Unpublish')).toBeTruthy()
    expect(screen.getByText('Remove')).toBeTruthy()
  })
})
