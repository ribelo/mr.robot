import { useState } from 'react'
import { ApiError } from '../api.ts'

/**
 * A destructive action confirmed by typing a name exactly (pl-kehf). There is no undo, so the
 * dialog says what goes and what stays, and the button stays off until the name matches.
 */
export function ConfirmByName({ title, name, goes, stays, action, option, onConfirm, onCancel }: {
  title: string
  name: string
  goes: string
  stays?: string
  action: string
  option?: { label: string; note: string }
  onConfirm: (option: boolean) => Promise<unknown>
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const matches = typed.trim() === name.trim()
  const confirm = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm(checked)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'it did not work; try again')
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal form" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <div>{goes}</div>
        {stays === undefined ? null : <div className="muted">{stays}</div>}
        <div className="muted">This cannot be undone.</div>
        {option === undefined ? null : (
          <label className="check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>{option.label}<small>{option.note}</small></span></label>
        )}
        <label><span>Type <b>{name}</b> to confirm</span>
          <input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && matches && !busy) void confirm() }} />
        </label>
        {error === undefined ? null : <div className="error">{error}</div>}
        <div className="question-actions">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="button button-danger" disabled={!matches || busy} onClick={() => void confirm()}>{busy ? 'Working…' : action}</button>
        </div>
      </div>
    </div>
  )
}
