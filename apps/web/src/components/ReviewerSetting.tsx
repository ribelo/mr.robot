import type { ModelChoice, ModelOption, ThinkingEffort } from '@mr-robot/protocol'
import { ModelSelect } from './ModelSelect.tsx'

const EFFORTS: readonly ThinkingEffort[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * The Auto review route (ao-6m9i): the default named by `fallback`, or a model and thinking effort of its own.
 * A cheap model reviews well: the reviewer reads one call and answers with a short JSON object.
 */
export function ReviewerSetting({ value, models, fallback, onChange }: { value: ModelChoice | null; models: readonly ModelOption[]; fallback: string; onChange: (value: ModelChoice | null) => void }) {
  const first = models[0]
  return (
    <div className="reviewer-setting">
      <label>Reviewer
        <select aria-label="Reviewer" value={value === null ? 'default' : 'own'} onChange={(event) => onChange(event.target.value === 'default' || first === undefined ? null : value ?? { provider: first.provider, model: first.model, effort: 'off' })}>
          <option value="default">{fallback}</option>
          <option value="own" disabled={first === undefined}>A model of its own</option>
        </select>
      </label>
      {value === null ? null : (
        <>
          <ModelSelect value={value} models={models} unavailable={[]} onChange={(option) => onChange({ provider: option.provider, model: option.model, effort: value.effort })} />
          <label>Reviewer thinking
            <select aria-label="Reviewer thinking" value={value.effort} onChange={(event) => onChange({ ...value, effort: event.target.value as ThinkingEffort })}>
              {EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
            </select>
          </label>
        </>
      )}
    </div>
  )
}
