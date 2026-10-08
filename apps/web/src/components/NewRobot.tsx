import { useState } from 'react'
import { useAtomValue } from '@effect/atom-react'
import * as Exit from 'effect/Exit'
import { AsyncResult } from 'effect/reactivity'
import type { ModelChoice, ProvidersView } from '@mr-robot/protocol'
import { keys, providersAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { go } from '../route.ts'

/** Create a Robot: what it is for and the model it starts on; the Robot then interviews you. */
export function NewRobot({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const providersResult = useAtomValue(providersAtom)
  const providers: ProvidersView | undefined = AsyncResult.isSuccess(providersResult) ? providersResult.value : undefined
  const command = useCommand()
  const [brief, setBrief] = useState('')
  const [chosen, setModel] = useState<ModelChoice>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  // Until the person picks one: the Home default when they can use it, else their first model.
  const model = chosen ?? (providers === undefined ? undefined : startingModel(providers))
  const create = async () => {
    setBusy(true)
    const exit = await command((api) => api.createRobot({ ...(brief.trim() === '' ? {} : { brief: brief.trim() }), ...(model === undefined ? {} : { model }) }), [keys.robots])
    if (Exit.isSuccess(exit)) onCreated(exit.value.id)
    else {
      setError(exitFailure(exit))
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal form" role="dialog" aria-label="New robot" onClick={(event) => event.stopPropagation()}>
        <h2>New robot</h2>
        <label>What should it do?
          <textarea rows={4} autoFocus value={brief} placeholder="e.g. Watch flat prices in Warsaw and tell me about good offers" onChange={(event) => setBrief(event.target.value)} />
        </label>
        {providers !== undefined && providers.models.length === 0 ? (
          <div className="form">
            <div>No Provider is connected yet, so a Robot would have no model to run on.</div>
            <button type="button" className="button button-primary" onClick={() => { onCancel(); go({ page: 'profile' }) }}>Connect a Provider</button>
          </div>
        ) : providers === undefined || model === undefined ? <div className="muted">Loading models…</div> : (
          <label>Model
            <ModelSelect value={model} models={providers.models} unavailable={[]} onChange={(option) => setModel({ provider: option.provider, model: option.model, effort: model.effort })} />
          </label>
        )}
        <div className="muted">It starts by asking you a few questions and then proposes its name and what it needs; you approve.</div>
        {error === undefined ? null : <div className="muted">{error}</div>}
        <div className="question-actions">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="button button-primary" disabled={busy || model === undefined || providers?.models.length === 0} onClick={() => void create()}>Create</button>
        </div>
      </div>
    </div>
  )
}

function startingModel(view: ProvidersView): ModelChoice {
  const usable = view.models.some((option) => option.provider === view.defaultModel.provider && option.model === view.defaultModel.model)
  const first = view.models[0]
  return usable || first === undefined ? view.defaultModel : { provider: first.provider, model: first.model, effort: 'off' }
}
