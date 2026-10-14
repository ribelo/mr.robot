import { useRef, useState, type ReactNode } from 'react'
import { saveSucceeded, type SaveOutcome } from './SaveButton.tsx'

/**
 * A label that becomes a text field (ux-h9wl, ux-kjli, ux-xbt3): Enter or leaving the field saves,
 * Escape cancels. It replaces the browser's prompt dialog, which the desktop app does not implement. The caller
 * starts the edit (a Rename or New button) and shows a failure; a failed save keeps the field open.
 */
export function InlineEdit({ editing, value, label, placeholder, onSave, onClose, children }: {
  readonly editing: boolean
  /** The text the field starts with. */
  readonly value: string
  /** The field's accessible name. */
  readonly label: string
  readonly placeholder?: string
  /** Called with the trimmed text; not called when it is empty or unchanged. */
  readonly onSave: (text: string) => Promise<SaveOutcome>
  /** The edit ended: saved or cancelled. */
  readonly onClose: () => void
  /** What shows while not editing. */
  readonly children: ReactNode
}) {
  if (!editing) return <>{children}</>
  return <InlineField value={value} label={label} {...(placeholder === undefined ? {} : { placeholder })} onSave={onSave} onClose={onClose} />
}

function InlineField({ value, label, placeholder, onSave, onClose }: {
  readonly value: string
  readonly label: string
  readonly placeholder?: string
  readonly onSave: (text: string) => Promise<SaveOutcome>
  readonly onClose: () => void
}) {
  const [text, setText] = useState(value)
  const [saving, setSaving] = useState(false)
  // Enter or Escape already ended this edit, or a save runs: the blur that follows does nothing.
  const ended = useRef(false)
  const busy = useRef(false)
  const end = () => {
    ended.current = true
    onClose()
  }
  const commit = async () => {
    if (ended.current || busy.current) return
    const trimmed = text.trim()
    if (trimmed === '' || trimmed === value) {
      end()
      return
    }
    busy.current = true
    setSaving(true)
    const saved = saveSucceeded(await onSave(trimmed))
    busy.current = false
    setSaving(false)
    if (saved) end()
  }
  return (
    <input className="inline-edit" aria-label={label} value={text} {...(placeholder === undefined ? {} : { placeholder })} readOnly={saving} autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); void commit() }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); end() }
      }} />
  )
}
