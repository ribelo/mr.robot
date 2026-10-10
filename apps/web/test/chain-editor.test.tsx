import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChainEntry, ModelOption, ProviderView } from '@mr-robot/protocol'
import { ChainEditor } from '../src/components/ChainEditor.tsx'

const models: ModelOption[] = [
  { provider: 'anthropic', model: 'claude-opus', label: 'Claude Opus' },
  { provider: 'opencode-go', model: 'glm', label: 'GLM' },
] as ModelOption[]
const account = (id: string, provider: ProviderView['provider'], label: string, ownerName = 'Anna'): ProviderView => ({ id, provider, label, kind: 'api-key', shared: ownerName !== 'Anna', connectedAt: 0, ownerId: ownerName.toLowerCase(), ownerName, status: 'ok', note: null, until: null })
const accounts = [account('c1', 'anthropic', 'rk@retailic.com'), account('c2', 'anthropic', 'me@gmail.com'), account('o1', 'opencode-go', 'Key ••••1111', 'Ben')]
const chain: ChainEntry[] = [
  { account: 'c1', owner: 'anna', provider: 'anthropic', model: 'claude-opus', effort: 'high' },
  { account: 'o1', owner: 'ben', provider: 'opencode-go', model: 'glm', effort: 'off' },
]

describe('ChainEditor (pa-mho0)', () => {
  it('offers only accounts of the entry\'s Provider and reorders entries', () => {
    const onChange = vi.fn()
    render(<ChainEditor chain={chain} models={models} unavailable={[]} accounts={accounts} onChange={onChange} />)
    const first = screen.getByLabelText('Account for entry 1') as HTMLSelectElement
    expect([...first.options].map((option) => option.textContent)).toEqual(['rk@retailic.com', 'me@gmail.com'])
    const second = screen.getByLabelText('Account for entry 2') as HTMLSelectElement
    expect([...second.options].map((option) => option.textContent)).toEqual(['Key ••••1111 · Ben'])
    fireEvent.change(first, { target: { value: 'c2' } })
    expect(onChange).toHaveBeenLastCalledWith([{ ...chain[0], account: 'c2', owner: 'anna' }, chain[1]])
    fireEvent.click(screen.getByLabelText('Move entry 2 up'))
    expect(onChange).toHaveBeenLastCalledWith([chain[1], chain[0]])
    fireEvent.click(screen.getByText('+ Add a fallback'))
    expect(onChange.mock.lastCall![0]).toHaveLength(3)
  })
})
