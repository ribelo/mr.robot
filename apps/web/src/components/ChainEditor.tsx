import { useState } from 'react'
import type { ChainEntry, ModelOption, ProviderView, ThinkingEffort } from '@mr-robot/protocol'
import { ModelSelect } from './ModelSelect.tsx'

const EFFORTS: readonly ThinkingEffort[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * A Robot's model chain (v1.10, pa-mho0): ordered account + model rows, reordered by dragging. The
 * Robot runs on the first usable row and moves down only when an account hits a limit or breaks.
 */
export function ChainEditor({ chain, models, unavailable, accounts, onChange }: {
  chain: readonly ChainEntry[]
  models: readonly ModelOption[]
  unavailable: readonly ModelOption[]
  accounts: readonly ProviderView[]
  onChange: (chain: ChainEntry[]) => void
}) {
  const [dragged, setDragged] = useState<number>()
  const set = (index: number, entry: ChainEntry) => onChange(chain.map((item, at) => (at === index ? entry : item)))
  const usable = (provider: string) => accounts.filter((account) => account.provider === provider)
  const firstAccount = (provider: string): Pick<ChainEntry, 'account' | 'owner'> => {
    if (provider === 'workers-ai') return { account: 'workers-ai', owner: '' }
    const found = usable(provider)[0]
    return found === undefined ? { account: '', owner: '' } : { account: found.id, owner: found.ownerId }
  }
  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...chain]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    onChange(next)
  }
  return (
    <div className="chain">
      <ol className="chain-list">
        {chain.map((entry, index) => (
          <li key={index} className={dragged === index ? 'chain-row dragging' : 'chain-row'} draggable
            onDragStart={() => setDragged(index)} onDragEnd={() => setDragged(undefined)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (dragged !== undefined) move(dragged, index); setDragged(undefined) }}>
            <span className="chain-handle" aria-hidden="true" title="Drag to reorder">⠿</span>
            <span className="chain-index">{index + 1}</span>
            <div className="chain-fields">
              <ModelSelect value={{ provider: entry.provider, model: entry.model, effort: entry.effort }} models={models} unavailable={unavailable}
                onChange={(option) => set(index, option.provider === entry.provider ? { ...entry, model: option.model } : { ...entry, ...firstAccount(option.provider), provider: option.provider, model: option.model })} />
              {entry.provider === 'workers-ai' ? <span className="muted">Workers AI · this Cloudflare account</span> : (
                <select aria-label={`Account for entry ${index + 1}`} value={entry.account} onChange={(event) => {
                  const account = usable(entry.provider).find((candidate) => candidate.id === event.target.value)
                  set(index, { ...entry, account: account?.id ?? '', owner: account?.ownerId ?? '' })
                }}>
                  {entry.account === '' ? <option value="">First account of this Provider</option> : null}
                  {usable(entry.provider).map((account) => <option key={account.id} value={account.id}>{account.label}{account.shared && account.ownerName !== '' ? ` · ${account.ownerName}` : ''}{account.status === 'ok' ? '' : account.status === 'limited' ? ' (limited)' : ' (needs attention)'}</option>)}
                </select>
              )}
              <select aria-label={`Thinking effort for entry ${index + 1}`} value={entry.effort} onChange={(event) => set(index, { ...entry, effort: event.target.value as ThinkingEffort })}>
                {EFFORTS.map((effort) => <option key={effort} value={effort}>thinking: {effort}</option>)}
              </select>
            </div>
            <span className="chain-buttons">
              <button type="button" className="icon-button small" aria-label={`Move entry ${index + 1} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button>
              <button type="button" className="icon-button small" aria-label={`Move entry ${index + 1} down`} disabled={index === chain.length - 1} onClick={() => move(index, index + 1)}>↓</button>
              <button type="button" className="link danger" disabled={chain.length === 1} onClick={() => onChange(chain.filter((_, at) => at !== index))}>Remove</button>
            </span>
          </li>
        ))}
      </ol>
      <div><button type="button" className="button" onClick={() => { const last = chain.at(-1)!; onChange([...chain, { ...last }]) }}>+ Add a fallback</button></div>
      <small className="muted chain-note">The Robot runs on the first entry. It moves to the next only when that account hits its limit or stops working, says so in the conversation, and comes back once the account works again.</small>
    </div>
  )
}
