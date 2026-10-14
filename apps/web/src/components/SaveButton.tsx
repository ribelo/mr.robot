// Contract: idle 'Save' → saving 'Saving…' (disabled) → saved 'Saved' for 2 s → idle; a press while saved saves again; a failure returns to idle; the width stays that of the widest label.
import { useEffect, useState } from 'react'
import * as Exit from 'effect/Exit'

/** What a save reports: the command's Exit, or whether it succeeded. */
export type SaveOutcome = Exit.Exit<unknown, unknown> | boolean

export function saveSucceeded(outcome: SaveOutcome): boolean {
  return typeof outcome === 'boolean' ? outcome : Exit.isSuccess(outcome)
}

type SavePhase = 'idle' | 'saving' | 'saved'

const SAVING = 'Saving…'
const SAVED = 'Saved'
/** How long the button says Saved before it says Save again. */
export const SAVED_FOR_MS = 2000

/**
 * The one Save button (ux-jefs, ux-ivf4): Save → Saving… → Saved for two seconds → Save. A press
 * while it says Saved saves again. A failure returns it to Save; the caller shows the failure next
 * to it. Every label sits in the same cell and only the current one shows, so the button keeps the
 * width of the widest label.
 */
export function SaveButton({ onSave, label = 'Save', disabled = false, secondary = false }: {
  readonly onSave: () => Promise<SaveOutcome>
  readonly label?: string
  /** Nothing to save yet; applies only while the button says Save. */
  readonly disabled?: boolean
  /** A plain button, for a form where another button is the primary one. */
  readonly secondary?: boolean
}) {
  const [phase, setPhase] = useState<SavePhase>('idle')
  useEffect(() => {
    if (phase !== 'saved') return
    const timer = setTimeout(() => setPhase('idle'), SAVED_FOR_MS)
    return () => clearTimeout(timer)
  }, [phase])
  const press = async () => {
    setPhase('saving')
    try {
      setPhase(saveSucceeded(await onSave()) ? 'saved' : 'idle')
    } catch (defect) {
      setPhase('idle')
      throw defect
    }
  }
  const current = phase === 'saving' ? SAVING : phase === 'saved' ? SAVED : label
  return (
    <button type="button" className={secondary ? 'button save-button' : 'button button-primary save-button'} disabled={phase === 'saving' || (phase === 'idle' && disabled)} onClick={() => void press()}>
      <span className="save-button-labels">
        {[label, SAVING, SAVED].map((text) => <span key={text} aria-hidden={text === current ? undefined : true}>{text}</span>)}
      </span>
    </button>
  )
}
