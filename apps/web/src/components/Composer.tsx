import { useRef, useState, type KeyboardEvent } from 'react'
import type { Attachment } from '@mr-robot/protocol'
import * as Exit from 'effect/Exit'
import { exitFailure, type ApiFailure } from '../client/api-failure.ts'

export interface ComposerProps {
  readonly placeholder: string
  readonly onSend: (text: string, attachments: Attachment[]) => Promise<Exit.Exit<void, ApiFailure>>
  readonly onUpload: (file: File) => Promise<Exit.Exit<Attachment, ApiFailure>>
}

/** Text and files for a Robot (robot-jlzk). Enter sends on a keyboard; the button sends on a phone. */
export function Composer({ placeholder, onSend, onUpload }: ComposerProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const input = useRef<HTMLInputElement>(null)

  const send = async () => {
    if (busy || (text.trim() === '' && files.length === 0)) return
    setBusy(true)
    const sent = await onSend(text.trim(), files)
    setFailure(exitFailure(sent))
    if (Exit.isSuccess(sent)) {
      setText('')
      setFiles([])
    }
    setBusy(false)
  }

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      event.preventDefault()
      void send()
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
        <button type="button" className="send-button" aria-label="Send" onClick={() => void send()} disabled={busy || (text.trim() === '' && files.length === 0)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  )
}
