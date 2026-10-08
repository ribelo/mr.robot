import { ErrorState } from './States.tsx'
import { useState } from 'react'
import * as Exit from 'effect/Exit'
import type { WorkspaceFileContent, WorkspaceFileView } from '@mr-robot/protocol'
import { fileAtom, filesAtom, keys, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { rawFileUrl } from '../client/mr-robot-api.ts'
import { AtomView } from './AtomView.tsx'

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
  if (path !== null) return <FileEditor robotId={robotId} path={path} canEdit={canEdit} onBack={() => onOpen(null)} />
  return <AtomView atom={filesAtom(robotId)} what="the files" errorTitle="The files cannot be listed">{(files) => <FileList robotId={robotId} files={files} canEdit={canEdit} onOpen={onOpen} />}</AtomView>
}

function FileList({ robotId, files, canEdit, onOpen }: { robotId: string; files: readonly WorkspaceFileView[]; canEdit: boolean; onOpen: (path: string | null) => void }) {
  const command = useCommand()
  const [error, setError] = useState<string>()
  const newSkill = async () => {
    const name = prompt('Name of the new local skill (lowercase-with-dashes)')?.trim()
    if (name === undefined || name === '') return
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) { setError('A skill name is lowercase letters, digits and dashes.'); return }
    const path = `skills/${name}/SKILL.md`
    const exit = await command((api) => api.saveFile(robotId, path, `---\nname: ${name}\ndescription: What this skill is for, in one line.\n---\n\n# ${name}\n\nSteps the Robot follows.\n`), [keys.files(robotId)])
    if (Exit.isSuccess(exit)) onOpen(path)
    else setError(exitFailure(exit))
  }
  return (
    <div className="files">
      {canEdit ? <div><button type="button" className="button" onClick={() => void newSkill()}>New local skill</button></div> : null}
      {error === undefined ? null : <div className="muted">{error}</div>}
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
  return (
    <AtomView atom={fileAtom(`${robotId}\n${path}`)} what="the file" errorTitle="This file cannot be opened">
      {(file) => <FileText robotId={robotId} path={path} canEdit={canEdit} file={file} onBack={onBack} />}
    </AtomView>
  )
}

function FileText({ robotId, path, canEdit, file, onBack }: { robotId: string; path: string; canEdit: boolean; file: WorkspaceFileContent; onBack: () => void }) {
  const command = useCommand()
  const [text, setText] = useState(file.text ?? '')
  const [status, setStatus] = useState<string>()
  const save = async () => {
    const exit = await command((api) => api.saveFile(robotId, path, text), [keys.files(robotId)])
    setStatus(exitFailure(exit) ?? 'Saved. The Robot is told at its next Turn.')
  }
  const editable = canEdit && !file.readOnly
  return (
    <div className="form file-editor">
      <div className="file-editor-head">
        <button type="button" className="link" onClick={onBack}>‹ All files</button>
        <strong>{path}</strong>
        <span className="muted">{size(file.size)}</span>
      </div>
      <div className="file-actions"><a className="button" href={rawFileUrl(robotId, path, true)} download>Download</a>{previewable(path) ? <a className="button" href={rawFileUrl(robotId, path)} target="_blank" rel="noreferrer">Open</a> : null}</div>
      {previewable(path) ? <FilePreview robotId={robotId} path={path} /> : file.text === null ? <div className="muted">{file.note}</div> : (
        <>
          <textarea aria-label={`Edit ${path}`} className="file-text" value={text} readOnly={!editable} spellCheck={false} onChange={(event) => { setText(event.target.value); setStatus(undefined) }} />
          {editable ? (
            <div className="question-actions">
              {status === undefined ? null : <span className="muted">{status}</span>}
              <button type="button" className="button" onClick={() => { if (confirm(`Delete ${path}?`)) void command((api) => api.deleteFile(robotId, path), [keys.files(robotId)]).then((exit) => { const failure = exitFailure(exit); if (failure === undefined) onBack(); else setStatus(failure) }) }}>Delete</button>
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
  const url = rawFileUrl(robotId, path)
  return IMAGE.test(path)
    ? <img className="file-preview-image" src={url} alt={path} />
    : <iframe className="file-preview-pdf" src={url} title={path} />
}
