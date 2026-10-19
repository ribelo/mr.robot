import { useRef, useState, type KeyboardEvent } from 'react'
import type { Attachment } from '@mr-robot/protocol'
import * as Exit from 'effect/Exit'
import { exitFailure, type ApiFailure } from '../client/api-failure.ts'

export interface ComposerProps {
  readonly placeholder: string
  /**
   * Called at Enter; the Composer is already empty. Whether the send works is the Conversation's to show (ap-3si6).
   * `followup`: sent with Ctrl+Enter, so it waits for a Turn of its own instead of reaching a working Robot (ao-q2z4).
   */
  readonly onSend: (text: string, attachments: Attachment[], followup: boolean) => void
  readonly onUpload: (file: File) => Promise<Exit.Exit<Attachment, ApiFailure>>
}

/** Text and files for a Robot (robot-jlzk). Enter sends on a keyboard; the button sends on a phone. */
export function Composer({ placeholder, onSend, onUpload }: ComposerProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const input = useRef<HTMLInputElement>(null)

  const send = (followup = false) => {
    if (busy || (text.trim() === '' && files.length === 0)) return
    onSend(text.trim(), files, followup)
    setText('')
    setFiles([])
    setFailure(undefined)
  }

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // Ctrl+Enter (Cmd+Enter on a Mac) queues the message as a follow-up, on any keyboard.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      send(true)
    } else if (!matchMedia('(pointer: coarse)').matches) {
      event.preventDefault()
      send()
    }
  }

  const upload = async (list: FileList | null) => {
    if (list === null) return
    setBusy(true)
    const results = await Promise.all([...list].map(onUpload))
    const uploaded = results.flatMap((result) => (Exit.isSuccess(result) ? [result.value] : []))
    setFiles((current) => [...current, ...uploaded])
    setFailure(results.map(exitFailure).find((message) => message !== undefined))
    setBusy(false)
  }

  return (
    <div className="composer">
      {failure === undefined ? null : <div className="composer-failure">{failure}</div>}
      {files.length > 0 ? (
        <div className="composer-files">
          {files.map((file) => (
            <button key={file.path} type="button" className="attachment" onClick={() => setFiles((current) => current.filter((other) => other !== file))}>📎 {file.name} ×</button>
          ))}
        </div>
      ) : null}
      <div className="composer-row">
        <button type="button" className="icon-button" aria-label="Attach a file" onClick={() => input.current?.click()} disabled={busy}>+</button>
        <input ref={input} type="file" multiple hidden onChange={(event) => { void upload(event.target.files); event.target.value = '' }} />
        <textarea
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keyDown}
        />
        <button type="button" className="send-button" aria-label="Send" onClick={() => send()} disabled={busy || (text.trim() === '' && files.length === 0)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  )
}
