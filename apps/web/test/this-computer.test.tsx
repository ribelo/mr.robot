import { RegistryProvider } from '@effect/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThisComputer } from '../src/components/ThisComputer.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const bridge = (extra: Record<string, unknown>) => ({
  state: async () => ({ server: 'https://mr.example', name: 'Laptop', hostId: null, autostart: true, state: 'unpaired', sessions: 0, ...extra }),
  save: async () => ({ ok: true }),
  pair: async () => ({ ok: true }),
  unpair: async () => ({ ok: true }),
  onChange: () => undefined,
})

describe('This computer in the desktop app (v1.16 ticket 04)', () => {
  it('tells a Windows owner without PowerShell 7 that robots cannot run commands, with the link to install it', async () => {
    vi.stubGlobal('mrRobotHost', bridge({ shell: 'pwsh', shellProblem: 'PowerShell 7 is not installed on this computer, so robots cannot run commands here.', shellInstallUrl: 'https://example.test/install-pwsh' }))
    render(<RegistryProvider><ThisComputer /></RegistryProvider>)
    expect(await screen.findByText('Robots cannot run commands here.')).toBeTruthy()
    expect(screen.getByText(/PowerShell 7 is not installed/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Install PowerShell 7' }).getAttribute('href')).toBe('https://example.test/install-pwsh')
  })

  it('shows nothing about the shell when commands run', async () => {
    vi.stubGlobal('mrRobotHost', bridge({ shell: 'bash' }))
    render(<RegistryProvider><ThisComputer /></RegistryProvider>)
    await screen.findByText('Not paired: robots cannot use this computer yet.')
    expect(screen.queryByText('Robots cannot run commands here.')).toBeNull()
  })
})
