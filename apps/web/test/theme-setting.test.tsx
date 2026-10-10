import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { ColorPicker } from '../src/components/ColorPicker.tsx'
import { Profile } from '../src/components/Profile.tsx'
import { applyTheme } from '../src/theme/theme.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', home: 'Home', timeZone: 'Europe/Warsaw', timeZonePinned: false, detectedTimeZone: 'Europe/Warsaw', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'light' }

describe('theme override (ap-itj1)', () => {
  it('applies the profile setting to the page and remembers it for the next load', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input, 'http://localhost').pathname
      return Response.json(path === '/api/me' ? me : path === '/api/robots' ? [] : {})
    }))
    render(<RegistryProvider><App /></RegistryProvider>)
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    expect(localStorage.getItem('mr-robot-theme')).toBe('light')
  })

  it('pins dark from the profile and stores it with the Member', async () => {
    const calls: Array<{ method: string; path: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname
      calls.push({ method: init?.method ?? 'GET', path, body: ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : typeof init?.body === 'string' ? init.body : '' })
      return Response.json({})
    }))
    render(<RegistryProvider><Profile me={{ ...me, theme: 'system' } as never} /></RegistryProvider>)
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH' && call.path === '/api/me' && call.body.includes('"theme":"dark"'))).toBe(true))
    applyTheme('light')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
  })
})

describe('colour picker (ap-udc9)', () => {
  it('offers the palette and a hex field; an old colour stays valid', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="#123abc" onChange={onChange} />)
    expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(9)
    const hex = screen.getByLabelText('Custom colour') as HTMLInputElement
    expect(hex.value).toBe('#123abc')
    fireEvent.click(screen.getByRole('radio', { name: '#5ec4b6' }))
    expect(onChange).toHaveBeenLastCalledWith('#5ec4b6')
    fireEvent.change(hex, { target: { value: '#ABCDEF' } })
    expect(onChange).toHaveBeenLastCalledWith('#abcdef')
    onChange.mockClear()
    fireEvent.change(hex, { target: { value: '#abc' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
