import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostSandbox, HostView } from '@mr-robot/protocol'
import { Hosts } from '../src/components/Hosts.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const host = (id: string, name: string, sandbox: HostSandbox | undefined): HostView => ({
  id, name, platform: 'linux', ownerId: 'm-1', ownerName: 'Anna', sharing: 'private', online: true, lastSeen: null, version: '0.1.0',
  capabilities: { graphical: true, chrome: '/usr/bin/google-chrome', ...(sandbox === undefined ? {} : { sandbox }) }, mine: true, users: [],
})

describe('the Hosts page shows each Host\'s sandbox state (v1.16 ticket 02, ob-n72n)', () => {
  it('says whether a Host confines commands fully, partly or not at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([host('h-1', 'Desk', 'full'), host('h-2', 'Laptop', 'partial'), host('h-3', 'Nas', 'none'), host('h-4', 'Old', undefined)])))
    render(<RegistryProvider><Hosts /></RegistryProvider>)
    const line = async (name: string) => (await screen.findByText(name)).parentElement!.textContent
    expect(await line('Desk')).toContain('sandbox on')
    expect(await line('Laptop')).toContain('sandbox partial')
    expect(await line('Nas')).toContain('no sandbox: confined commands do not run')
    expect(await line('Old')).not.toContain('sandbox')
  })
})
