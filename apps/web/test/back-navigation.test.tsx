import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// route.ts keeps the app's history count in module state, so each test loads a fresh copy of the app
// on the browser history it sets up. jsdom keeps the history itself across tests.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetModules()
})

const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, home: 'Home', timeZone: 'Europe/Warsaw', timeZonePinned: false, detectedTimeZone: 'Europe/Warsaw', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system' }
const robots = [{
  id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null,
  identity: { name: 'Scout', title: '', description: 'A Robot', avatarColor: '#5ec4b6', avatarSeed: 'seed-1' }, lastLine: 'Hello.', lastAt: 0, unread: false,
}]

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = new URL(input, 'http://localhost').pathname
    if (path === '/api/me') return Response.json(me)
    if (path === '/api/robots') return Response.json(robots)
    return new Response('{}', { status: 500 })
  }))
}

async function loadApp(hash: string) {
  history.replaceState(null, '', hash)
  stubFetch()
  const { App } = await import('../src/App.tsx')
  const { RegistryProvider } = await import('@effect/atom-react')
  render(<RegistryProvider><App /></RegistryProvider>)
}

describe('Back navigation', () => {
  it('returns from the profile to the robot the person came from', async () => {
    await loadApp('#/')
    fireEvent.click(await screen.findByText('Scout'))
    await waitFor(() => expect(location.hash).toBe('#/r/r-1'))
    fireEvent.click(document.querySelector('button.me') as HTMLButtonElement)
    await waitFor(() => expect(location.hash).toBe('#/me'))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(location.hash).toBe('#/r/r-1'))
  })

  it('goes to the page fallback when the app made no earlier entry in this tab', async () => {
    await loadApp('#/me')
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(await screen.findByText('Pick a robot')).toBeTruthy()
  })
})
