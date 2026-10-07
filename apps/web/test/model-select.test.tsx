import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelOption } from '@mr-robot/protocol'
import { ModelSelect } from '../src/components/ModelSelect.tsx'

afterEach(cleanup)

const option = (provider: string, model: string, label: string): ModelOption => ({ provider, model, label, contextWindow: 128_000 })
const models = [
  option('workers-ai', '@cf/moonshotai/kimi-k2.6', 'Kimi K2.6'),
  option('workers-ai', '@cf/openai/gpt-oss-120b', 'GPT-OSS 120B'),
  option('opencode-go', 'kimi-k2.6', 'Kimi K2.6 (OpenCode Go)'),
  option('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5'),
]

describe('the model combobox (v1.1 ticket 07)', () => {
  it('filters by model name across providers, grouped by provider, and picks with a tap', () => {
    const onChange = vi.fn()
    render(<ModelSelect value={{ provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'off' }} models={models} unavailable={[option('openai', 'gpt-5.5', 'GPT-5.5')]} onChange={onChange} />)
    fireEvent.click(screen.getByText('Claude Sonnet 5.5'))
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'kimi' } })
    expect(screen.getAllByRole('option').map((element) => element.textContent)).toEqual(['Kimi K2.6', 'Kimi K2.6'])
    expect(screen.getAllByRole('group').map((element) => element.getAttribute('aria-label'))).toEqual(['Workers AI', 'OpenCode Go'])
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'claude' } })
    expect(screen.getAllByRole('option').map((element) => element.textContent)).toEqual(['Claude Sonnet 5.5'])
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'opencode' } })
    fireEvent.click(screen.getByRole('option', { name: 'Kimi K2.6' }))
    expect(onChange).toHaveBeenCalledWith(models[2])
  })
})
