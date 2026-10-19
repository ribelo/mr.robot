import { useState } from 'react'
import type { ModelChoice, ModelOption, SubagentModel } from '@mr-robot/protocol'
import { ModelSelect } from './ModelSelect.tsx'

/**
 * The models a Robot's Subagents may run on (ao-2z4n): the subagents grant's list, empty by default, so nothing
 * is implicit. The first is used when the Robot names none.
 */
export function SubagentModels({ value, models, onChange }: { value: readonly SubagentModel[]; models: readonly ModelOption[]; onChange: (value: SubagentModel[]) => void }) {
  const first = models[0]
  const [adding, setAdding] = useState<ModelChoice | null>(null)
  const label = (entry: SubagentModel) => models.find((option) => option.provider === entry.provider && option.model === entry.model)?.label ?? entry.model
  return (
    <section className="subagent-models" aria-label="Subagent models">
      <h3 className="panel-section">Subagent models</h3>
      <div className="muted">The models this Robot's Subagents may run on. With none, it cannot delegate; the first is its default.</div>
      {value.length === 0 ? <div className="muted">None.</div> : (
        <ul className="grant-list">
          {value.map((entry) => (
            <li key={`${entry.provider}/${entry.model}`}>{label(entry)} <span className="muted">({entry.provider})</span>{' '}
              <button type="button" className="link" aria-label={`Remove ${label(entry)}`} onClick={() => onChange(value.filter((other) => other !== entry))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {adding === null
        ? <button type="button" className="button" disabled={first === undefined} onClick={() => first !== undefined && setAdding({ provider: first.provider, model: first.model, effort: 'off' })}>Add a model</button>
        : (
          <div className="form inline">
            <ModelSelect value={adding} models={models} unavailable={[]} onChange={(option) => setAdding({ provider: option.provider, model: option.model, effort: 'off' })} />
            <button type="button" className="button" onClick={() => {
              if (!value.some((entry) => entry.provider === adding.provider && entry.model === adding.model)) onChange([...value, { provider: adding.provider, model: adding.model }])
              setAdding(null)
            }}>Add</button>
          </div>
        )}
    </section>
  )
}
