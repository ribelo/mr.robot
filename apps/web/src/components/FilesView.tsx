import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceFileContent, WorkspaceFileView } from '@mr-robot/protocol'
import { api, ApiError } from '../api.ts'

const GROUPS: ReadonlyArray<readonly [WorkspaceFileView['group'], string]> = [
  ['persona', 'Persona and memory'],
  ['daily', 'Daily notes'],
  ['skills', 'Skills'],
  ['other', 'Other files'],
  ['screens', 'Screenshots'],
]

/**
 * A Robot's Workspace (v1.1 ticket 08, rb-1miy, rb-q5eb): persona files and MEMORY.md pinned
 * first, daily notes, local skills, other files; any text file opens in an editor and saves.
 */
export function FilesView({ robotId, path, canEdit, onOpen }: { robotId: string; path: string | null; canEdit: boolean; onOpen: (path: string | null) => void }) {
  const [files, setFiles] = useState<WorkspaceFileView[]>()
  const [error, setError] = useState<string>()
  const refresh = useCallback(() => api.files(robotId).then(setFiles).catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'cannot list files')), [robotId])
  useEffect(() => { void refresh() }, [refresh])
  if (path !== null) return <FileEditor robotId={robotId} path={path} canEdit={canEdit} onBack={() => { onOpen(null); void refresh() }} />
  if (error !== undefined) return <div className="muted">{error}</div>
  if (files === undefined) return <div className="muted">Loading…</div>
  const newSkill = async () => {
    const name = prompt('Name of the new local skill (lowercase-with-dashes)')?.trim()
    if (name === undefined || name === '') return
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) { setError('A skill name is lowercase letters, digits and dashes.'); return }
    const path = `skills/${name}/SKILL.md`
    await api.saveFile(robotId, path, `---\nname: ${name}\ndescription: What this skill is for, in one line.\n---\n\n# ${name}\n\nSteps the Robot follows.\n`)
    onOpen(path)
  }
  return (
    <div className="files">
      {canEdit ? <div><button type="button" className="button" onClick={() => void newSkill()}>New local skill</button></div> : null}
      {GROUPS.map(([group, title]) => {
        const inGroup = files.filter((file) => file.group === group)
        if (inGroup.length === 0) return null
        const list = (
          <ul className="file-list">
            {inGroup.map((file) => (
              <li key={file.path}>
                <button type="button" className="file-row" onClick={() => onOpen(file.path)}>
                  <span className="file-name">{file.path}</span>
                  <span className="muted">{size(file.size)} · {new Date(file.updatedAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )
        return group === 'screens'
          ? <details key={group} className="file-group"><summary>{title} <span className="muted">· {inGroup.length}</span></summary>{list}</details>
          : <section key={group} className="file-group"><h3 className="panel-section">{title}</h3>{list}</section>
      })}
    </div>
  )
}

function FileEditor({ robotId, path, canEdit, onBack }: { robotId: string; path: string; canEdit: boolean; onBack: () => void }) {
  const [file, setFile] = useState<WorkspaceFileContent>()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<string>()
  useEffect(() => {
    void api.file(robotId, path).then((loaded) => { setFile(loaded); setText(loaded.text ?? '') }).catch((cause: unknown) => setStatus(cause instanceof ApiError ? cause.message : 'cannot open'))
  }, [robotId, path])
  const save = async () => {
    try {
      const saved = await api.saveFile(robotId, path, text)
      setFile(saved)
      setStatus('Saved. The Robot is told at its next Turn.')
    } catch (cause) {
      setStatus(cause instanceof ApiError ? cause.message : 'could not save')
    }
  }
  const editable = canEdit && file !== undefined && !file.readOnly
  return (
    <div className="form file-editor">
      <div className="file-editor-head">
        <button type="button" className="link" onClick={onBack}>‹ All files</button>
        <strong>{path}</strong>
        {file === undefined ? null : <span className="muted">{size(file.size)}</span>}
      </div>
      {file === undefined ? null : <div className="file-actions"><a className="button" href={api.rawUrl(robotId, path, true)} download>Download</a>{previewable(path) ? <a className="button" href={api.rawUrl(robotId, path)} target="_blank" rel="noreferrer">Open</a> : null}</div>}
      {file === undefined ? <div className="muted">{status ?? 'Loading…'}</div> : previewable(path) ? <FilePreview robotId={robotId} path={path} /> : file.text === null ? <div className="muted">{file.note}</div> : (
        <>
          <textarea aria-label={`Edit ${path}`} className="file-text" value={text} readOnly={!editable} spellCheck={false} onChange={(event) => { setText(event.target.value); setStatus(undefined) }} />
          {editable ? (
            <div className="question-actions">
              {status === undefined ? null : <span className="muted">{status}</span>}
              <button type="button" className="button" onClick={() => { if (confirm(`Delete ${path}?`)) void api.deleteFile(robotId, path).then(onBack) }}>Delete</button>
              <button type="button" className="button button-primary" disabled={text === file.text} onClick={() => void save()}>Save</button>
            </div>
          ) : <div className="muted">{canEdit ? file.note : 'Only the owner edits this Robot\'s files.'}</div>}
        </>
      )}
    </div>
  )
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

/** Files shown in the page instead of as text: images and PDFs (pl-ojbr). */
function previewable(path: string): boolean {
  return IMAGE.test(path) || /\.pdf$/i.test(path)
}

function FilePreview({ robotId, path }: { robotId: string; path: string }) {
  const url = api.rawUrl(robotId, path)
  return IMAGE.test(path)
    ? <img className="file-preview-image" src={url} alt={path} />
    : <iframe className="file-preview-pdf" src={url} title={path} />
}
