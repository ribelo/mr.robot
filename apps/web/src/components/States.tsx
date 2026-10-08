import type { ReactNode } from 'react'

/**
 * The three states every page shows instead of a blank or a raw message (pl-fxge): loading,
 * empty and error, in one look, centred in the space they fill.
 */
export function Loading({ what }: { what?: string }) {
  return (
    <div className="page-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div className="page-state-hint">{what === undefined ? 'Loading…' : `Loading ${what}…`}</div>
    </div>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="page-state">
      <div className="page-state-title">{title}</div>
      {hint === undefined ? null : <div className="page-state-hint">{hint}</div>}
      {action === undefined ? null : <div className="page-state-action">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, back }: { title?: string; message?: string; onRetry?: () => void; back?: { label: string; onClick: () => void } }) {
  return (
    <div className="page-state page-state-error" role="alert">
      <div className="page-state-title">{title}</div>
      {message === undefined ? null : <div className="page-state-hint">{sentence(message)}</div>}
      {onRetry === undefined && back === undefined ? null : (
        <div className="page-state-action">
          {back === undefined ? null : <button type="button" className="button" onClick={back.onClick}>{back.label}</button>}
          {onRetry === undefined ? null : <button type="button" className="button button-primary" onClick={onRetry}>Try again</button>}
        </div>
      )}
    </div>
  )
}

/** Server messages are lower-case fragments ("no such robot"); shown as a sentence. */
function sentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return trimmed
  const capital = trimmed[0]!.toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}
