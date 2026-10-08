import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Empty, ErrorState, Loading } from '../src/components/States.tsx'

afterEach(cleanup)

describe('page states (v1.3 ticket 08, pl-fxge)', () => {
  it('shows loading, empty and a readable error with its actions', () => {
    render(<Loading what="the files" />)
    expect(screen.getByRole('status').textContent).toBe('Loading the files…')
    cleanup()
    render(<Empty title="Nothing yet" hint="No robot has used this computer yet." />)
    expect(screen.getByText('Nothing yet')).toBeTruthy()
    cleanup()
    const retry = vi.fn()
    const back = vi.fn()
    render(<ErrorState title="This robot cannot be opened" message="no such robot" onRetry={retry} back={{ label: 'All robots', onClick: back }} />)
    expect(screen.getByRole('alert').textContent).toContain('No such robot.')
    fireEvent.click(screen.getByText('Try again'))
    fireEvent.click(screen.getByText('All robots'))
    expect(retry).toHaveBeenCalledOnce()
    expect(back).toHaveBeenCalledOnce()
  })
})
