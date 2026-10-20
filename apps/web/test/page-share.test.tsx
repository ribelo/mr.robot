import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RobotSummary, SharedPageView } from '@mr-robot/protocol'
import { SharedPageList, ShareSwitch } from '../src/components/PageShare.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-20T10:00:00Z')
const shared: SharedPageView = { robotId: 'r-1', path: 'pages/report.md', title: 'Flat search', url: 'https://home.example/p/m-1.aa.bb', createdAt: at }

describe('the Share switch (dp-hf7v)', () => {
  it('is off for a Page that is not shared, and turning it on shares', () => {
    const onShare = vi.fn()
    render(<ShareSwitch shared={null} onShare={onShare} onStop={vi.fn()} />)
    const toggle = screen.getByLabelText('Share with a link') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(screen.queryByLabelText('Share link')).toBeNull()
    fireEvent.click(toggle)
    expect(onShare).toHaveBeenCalled()
  })

  it('shows the link of a shared Page, and Stop sharing revokes it', () => {
    const onStop = vi.fn()
    render(<ShareSwitch shared={shared} onShare={vi.fn()} onStop={onStop} />)
    expect((screen.getByLabelText('Share with a link') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Share link') as HTMLInputElement).value).toBe(shared.url)
    fireEvent.click(screen.getByText('Stop sharing'))
    expect(onStop).toHaveBeenCalled()
  })
})

describe('the shared Pages of the profile (dp-zq16)', () => {
  it('lists every shared Page with its Robot, link and Stop sharing', () => {
    const onStop = vi.fn()
    const robots = [{ id: 'r-1', identity: { name: 'Flat hunter' } }] as unknown as RobotSummary[]
    render(<SharedPageList pages={[shared]} robots={robots} onStop={onStop} />)
    expect((screen.getByText('Flat search') as HTMLAnchorElement).getAttribute('href')).toBe('#/r/r-1/pages/pages/report.md')
    expect(screen.getByText(/Flat hunter/)).toBeTruthy()
    expect((screen.getByLabelText('Link of Flat search') as HTMLInputElement).value).toBe(shared.url)
    fireEvent.click(screen.getByText('Stop sharing'))
    expect(onStop).toHaveBeenCalledWith(shared)
    cleanup()
    render(<SharedPageList pages={[]} robots={robots} onStop={onStop} />)
    expect(screen.getByText('You share no Pages.')).toBeTruthy()
  })
})
