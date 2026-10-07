import { useEffect, useRef, useState } from 'react'
import type { ModelChoice, ModelOption } from '@mr-robot/protocol'

const PROVIDER_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  'workers-ai': 'Workers AI',
  openai: 'ChatGPT',
  anthropic: 'Claude',
  'opencode-go': 'OpenCode Go',
}

const providerName = (provider: string) => PROVIDER_NAMES[provider] ?? provider
const key = (option: { provider: string; model: string }) => `${option.provider}/${option.model}`

/**
 * A searchable model combobox grouped by Provider (rb-…, v1.1 ticket 07): typing filters by model
 * name and Provider. A Provider the person has not connected stays visible but disabled, labelled
 * with where to connect it, so a missing model explains itself.
 */
export function ModelSelect({ value, models, unavailable, onChange }: {
  value: ModelChoice
  models: readonly ModelOption[]
  unavailable: readonly ModelOption[]
  onChange: (option: ModelOption) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => { if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '')
  const matches = (option: ModelOption) => words.every((word) => `${option.label} ${option.model} ${option.provider} ${providerName(option.provider)}`.toLowerCase().includes(word))
  const groups = (list: readonly ModelOption[]) => [...new Set(list.map((option) => option.provider))].map((provider) => [provider, list.filter((option) => option.provider === provider && matches(option))] as const).filter(([, options]) => options.length > 0)
  const current = models.find((option) => key(option) === key(value))
  // The Provider is connected (it offers other models) but no longer lists this one.
  const gone = current === undefined && models.some((option) => option.provider === value.provider)
  const label = (option: ModelOption) => option.label.replace(/ \([^)]*\)$/, '')
  const shown = groups(models)
  const off = groups(unavailable)
  return (
    <div className="model-combo" ref={box}>
      <button type="button" className="model-combo-current" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{current === undefined ? `${providerName(value.provider)}: ${value.model} (${gone ? 'no longer offered' : 'not connected'})` : `${label(current)}`}</span>
        <span className="muted">{providerName(value.provider)} ▾</span>
      </button>
      {open ? (
        <div className="model-combo-panel">
          <input autoFocus aria-label="Search models" placeholder="Search models or providers" value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
              if (event.key === 'Enter') {
                const first = shown[0]?.[1][0]
                if (first !== undefined) { onChange(first); setOpen(false); setQuery('') }
              }
            }} />
          <div className="model-combo-list" role="listbox">
            {shown.map(([provider, options]) => (
              <div key={provider} role="group" aria-label={providerName(provider)}>
                <div className="model-combo-group">{providerName(provider)}</div>
                {options.map((option) => (
                  <button key={key(option)} type="button" role="option" aria-selected={key(option) === key(value)} className={key(option) === key(value) ? 'model-option selected' : 'model-option'} onClick={() => { onChange(option); setOpen(false); setQuery('') }}>{label(option)}</button>
                ))}
              </div>
            ))}
            {off.map(([provider, options]) => (
              <div key={`off-${provider}`} role="group" aria-label={providerName(provider)}>
                <div className="model-combo-group">{providerName(provider)}: connect it under your name → Providers</div>
                {options.map((option) => <button key={`off-${key(option)}`} type="button" role="option" aria-selected={false} className="model-option" disabled>{label(option)}</button>)}
              </div>
            ))}
            {shown.length === 0 && off.length === 0 ? <div className="muted model-combo-group">No model matches “{query}”.</div> : null}
          </div>
        </div>
      ) : null}
      {current === undefined ? <small className="muted">{gone ? `${providerName(value.provider)} no longer lists this model; pick another one.` : 'This model\'s Provider is not connected; the Robot cannot run until you connect it or pick another model.'}</small> : null}
    </div>
  )
}
