import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ReviewList, reviewsOf } from '../src/dsh/RobotTrajectory.tsx'

afterEach(cleanup)

const record = (seq: number, data: Record<string, unknown>) => ({ seq, type: 'plugin:mr-robot/review', time: seq, data })

describe('the Trajectory shows which calls Auto review checked (ao-jn6z)', () => {
  it('lists each reviewed call with its risk and decision; other events are not reviews', () => {
    const events = [
      { seq: 1, type: 'tool/call', time: 1, data: { name: 'write' } },
      record(2, { callId: 'c-1', name: 'write', risk: 'low', decision: 'allow', reviewer: 'deepseek/deepseek-flash' }),
      record(3, { callId: 'c-2', name: 'gmail_send', risk: 'medium', decision: 'deny', reason: 'the owner did not name the recipient', reviewer: 'deepseek/deepseek-flash' }),
      record(4, { callId: 'c-3', name: 'delete_file', decision: 'failed', reason: 'reviewer output must be one JSON object', reviewer: 'deepseek/deepseek-flash' }),
    ]
    render(<ReviewList reviews={reviewsOf(events as never)} />)
    expect(screen.getByText('Auto review · 3 calls')).toBeTruthy()
    const lines = within(screen.getByRole('list', { name: 'Reviewed calls' })).getAllByRole('listitem').map((item) => item.textContent)
    expect(lines).toEqual([
      'write · low risk · allowed (deepseek/deepseek-flash)',
      'gmail_send · medium risk · denied, asked the owner: the owner did not name the recipient (deepseek/deepseek-flash)',
      'delete_file · review failed, did not run: reviewer output must be one JSON object (deepseek/deepseek-flash)',
    ])
  })

  it('shows nothing without reviews', () => {
    const { container } = render(<ReviewList reviews={[]} />)
    expect(container.textContent).toBe('')
  })
})
