import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', home: 'Home', timeZone: 'Europe/Warsaw', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact' }
const robots = [{
  id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'mr-robot', sharing: 'private', status: 'active', fleetState: 'sleeping',
  identity: { name: 'Mr. Robot', title: '', description: 'Your personal Robot', avatarColor: '#5ec4b6' }, lastLine: 'Hello.', lastAt: 0, unread: false,
}]

describe('the app shell', () => {
  it('renders the robot list after loading (hooks stay in the same order across renders)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input, 'http://localhost').pathname
      return Response.json(path === '/api/me' ? me : path === '/api/robots' ? robots : {})
    }))
    render(<RegistryProvider><App /></RegistryProvider>)
    expect(await screen.findByText('Hello.')).toBeTruthy()
  })
})
