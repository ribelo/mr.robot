/**
 * A file's history (v1.18, rm-7jo4): who wrote the version it has now, and its kept versions with their authors; one opens to read,
 * and the owner restores it (the restore is a new version, and the Robot hears about it).
 */
import { useEffect, useState } from 'react'
import * as Exit from 'effect/Exit'
import type { FileHistoryView, FileVersionContent, WorkspaceFileContent } from '@mr-robot/protocol'
import { keys, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'

/** Persona and memory files keep versions; other files do not. */
export function hasHistory(path: string): boolean {
  return ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'IDENTITY.md', 'TOOLS.md'].includes(path) || /^memory\/[^/]+\.md$/.test(path)
}

export function FileHistoryDrawer({ robotId, path, canRestore, onRestored, onClose }: {
  robotId: string
  path: string
  canRestore: boolean
  onRestored: (file: WorkspaceFileContent) => void
  onClose: () => void
}) {
  const command = useCommand()
  const [history, setHistory] = useState<FileHistoryView>()
  const [open, setOpen] = useState<FileVersionContent>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void command((api) => api.fileHistory(robotId, path), []).then((exit) => (Exit.isSuccess(exit) ? setHistory(exit.value) : setError(exitFailure(exit))))
  }, [command, robotId, path])
  const show = async (version: string) => {
    const exit = await command((api) => api.fileVersion(robotId, path, version), [])
    if (Exit.isSuccess(exit)) setOpen(exit.value)
    else setError(exitFailure(exit))
  }
  const restore = async (version: string) => {
    const exit = await command((api) => api.restoreFile(robotId, path, version), [keys.files(robotId)])
    if (Exit.isSuccess(exit)) onRestored(exit.value)
    else setError(exitFailure(exit))
  }
  return (
    <aside className="file-history" aria-label={`History of ${path}`}>
      <div className="sheet-head"><span /><span className="sheet-title">History of {path}</span><button type="button" className="icon-button" aria-label="Close history" onClick={onClose}>×</button></div>
      {error === undefined ? null : <div className="muted">{error}</div>}
      {history === undefined ? <div className="muted">Loading the history…</div> : (
        <>
          <div className="muted">{history.current === null ? 'The file is deleted; a kept version brings it back.' : `Now: written by ${history.current.by}, ${new Date(history.current.at).toLocaleString()}.`}</div>
          {history.versions.length === 0 ? <div className="muted">No earlier versions.</div> : (
            <ul className="file-versions">
              {history.versions.map((version) => (
                <li key={version.id}>
                  <span>{new Date(version.at).toLocaleString()} · {version.by}</span>
                  <button type="button" className="link" onClick={() => void show(version.id)}>Show</button>
                  {canRestore ? <button type="button" className="link" onClick={() => void restore(version.id)}>Restore</button> : null}
                </li>
              ))}
            </ul>
          )}
          {open === undefined ? null : <pre className="file-version-text" aria-label="Version text">{open.text}</pre>}
        </>
      )}
    </aside>
  )
}
