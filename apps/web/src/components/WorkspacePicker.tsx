import { useState } from 'react'
import type { WorkspaceChoice, WorkspaceSetting } from '@mr-robot/protocol'
import { useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'

/** A Host the Robot may take a Workspace on: one it holds the files facet on (in the draft). */
export interface PickerHost {
  readonly id: string
  readonly name: string
}

/** The parent of a directory as the Host printed it; the root stays the root. */
const parentOf = (path: string): string => {
  const cut = path.replace(/[\\/]+$/, '')
  const at = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('\\'))
  return at <= 0 ? (cut.startsWith('/') ? '/' : cut) : cut.slice(0, at)
}
const join = (path: string, name: string): string => (path.endsWith('/') || path.endsWith('\\') ? `${path}${name}` : `${path}/${name}`)

/**
 * The Workspace setting (v1.21, cw-gx04): a Host the Robot holds the files facet on and a directory there, chosen by walking the Host's
 * directories (listed on demand through the Host). The Robot checks the choice on the Host when the settings are saved: a directory,
 * reached through no link, inside a git repository. `choice` is what the next save sends: undefined keeps the setting, null removes it.
 */
export function WorkspacePicker({ robotId, current, hosts, choice, onChoose }: {
  readonly robotId: string
  readonly current: WorkspaceSetting | null
  readonly hosts: readonly PickerHost[]
  readonly choice: WorkspaceChoice | null | undefined
  readonly onChoose: (choice: WorkspaceChoice | null | undefined) => void
}) {
  const command = useCommand()
  const [host, setHost] = useState(current?.hostId ?? hosts[0]?.id ?? '')
  const [path, setPath] = useState(current?.root ?? '~')
  const [listing, setListing] = useState<{ path: string; directories: readonly string[]; truncated: boolean }>()
  const [error, setError] = useState<string>()
  const list = async (at: string) => {
    if (host === '') return
    const exit = await command((api) => api.hostDirectories(robotId, host, at), [])
    const failed = exitFailure(exit)
    setError(failed)
    if (exit._tag === 'Success') {
      setListing(exit.value)
      setPath(exit.value.path)
    }
  }
  const hostName = (id: string) => hosts.find((entry) => entry.id === id)?.name ?? current?.host ?? id
  const shown = choice === undefined
    ? current === null ? 'None' : `${current.host}: ${current.root}${current.repository === current.root ? '' : ` (repository ${current.repository})`}`
    : choice === null ? 'None (after you save)' : `${hostName(choice.host)}: ${choice.root} (checked when you save)`
  return (
    <section className="workspace-picker" aria-label="Workspace">
      <h3 className="panel-section">Workspace</h3>
      <div className="muted">A folder on one of your computers where this Robot works: its code, the repository's instructions and skills. The Robot must hold the files facet of that computer.</div>
      <div>Workspace: <strong>{shown}</strong></div>
      {hosts.length === 0 ? <div className="muted">Grant this Robot the files facet of a computer first.</div> : (
        <>
          <label>Computer
            <select aria-label="Workspace computer" value={host} onChange={(event) => { setHost(event.target.value); setListing(undefined) }}>
              {hosts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label>Folder
            <input aria-label="Workspace folder" value={path} onChange={(event) => setPath(event.target.value)} />
          </label>
          <div className="question-actions">
            <button type="button" className="button" onClick={() => void list(path)}>Browse</button>
            {listing === undefined ? null : <button type="button" className="button" onClick={() => void list(parentOf(listing.path))}>Up</button>}
            <button type="button" className="button" disabled={path.trim() === ''} onClick={() => onChoose({ host, root: path.trim() })}>Use this folder</button>
            {current === null && choice == null ? null : <button type="button" className="button" onClick={() => onChoose(null)}>No Workspace</button>}
          </div>
          {error === undefined ? null : <small role="alert">{error}</small>}
          {listing === undefined ? null : (
            <ul className="directory-list" aria-label="Folders">
              {listing.directories.map((name) => <li key={name}><button type="button" className="link" onClick={() => void list(join(listing.path, name))}>{name}/</button></li>)}
              {listing.directories.length === 0 ? <li className="muted">No folders here.</li> : null}
              {listing.truncated ? <li className="muted">More folders than shown: type the path.</li> : null}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
