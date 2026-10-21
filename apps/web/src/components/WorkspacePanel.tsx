import { useEffect, useState } from 'react'
import type { WorkspaceSetting } from '@mr-robot/protocol'
import { useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'

type Entry = { readonly name: string; readonly kind: 'directory' | 'file' | 'link' | 'other'; readonly size: number | null }
type Git = { readonly branch: string; readonly status: ReadonlyArray<{ code: string; path: string }>; readonly log: ReadonlyArray<{ hash: string; subject: string; author: string; at: number }> }

/**
 * The Workspace panel (v1.21 ticket 08, cw-1wrt): where the Robot works, its current directory and its worktree, the repository's files
 * under the checkout listed on demand, and git's status and last twenty commits, read through the Host when the owner opens them.
 */
export function WorkspacePanel({ robotId, workspace }: { robotId: string; workspace: WorkspaceSetting }) {
  const command = useCommand()
  const [cwd, setCwd] = useState<string>()
  const [git, setGit] = useState<Git>()
  const [listing, setListing] = useState<{ path: string; entries: readonly Entry[]; truncated: boolean }>()
  const [failure, setFailure] = useState<string>()
  useEffect(() => {
    let current = true
    void command((api) => api.workspaceWhere(robotId), []).then((exit) => { if (current && exit._tag === 'Success') setCwd(exit.value.cwd) })
    return () => { current = false }
  }, [command, robotId, workspace.root, workspace.worktree])
  const files = async (path: string) => {
    const exit = await command((api) => api.workspaceFiles(robotId, path), [])
    setFailure(exitFailure(exit))
    if (exit._tag === 'Success') setListing(exit.value)
  }
  const readGit = async () => {
    const exit = await command((api) => api.workspaceGit(robotId), [])
    setFailure(exitFailure(exit))
    if (exit._tag === 'Success') setGit(exit.value)
  }
  const up = (path: string) => path.split('/').slice(0, -1).join('/')
  return (
    <section aria-label="Workspace">
      <h3 className="panel-section">Workspace</h3>
      <dl className="workspace-facts">
        <dt>Computer</dt><dd>{workspace.host}</dd>
        <dt>Root</dt><dd><code>{workspace.root}</code></dd>
        {workspace.repository === workspace.root ? null : <><dt>Repository</dt><dd><code>{workspace.repository}</code></dd></>}
        <dt>Worktree</dt><dd>{workspace.worktree === undefined ? 'none' : <code>{workspace.worktree}</code>}</dd>
        <dt>Current directory</dt><dd>{cwd === undefined ? '…' : <code>{cwd}</code>}</dd>
      </dl>
      <div className="question-actions">
        <button type="button" className="button" onClick={() => void files(listing?.path ?? '')}>Files</button>
        <button type="button" className="button" onClick={() => void readGit()}>Git status</button>
      </div>
      {failure === undefined ? null : <small role="alert">{failure}</small>}
      {listing === undefined ? null : (
        <ul className="directory-list" aria-label="Workspace files">
          {listing.path === '' ? null : <li><button type="button" className="link" onClick={() => void files(up(listing.path))}>../</button></li>}
          {listing.entries.map((entry) => (
            <li key={entry.name}>
              {entry.kind === 'directory'
                ? <button type="button" className="link" onClick={() => void files(listing.path === '' ? entry.name : `${listing.path}/${entry.name}`)}>{entry.name}/</button>
                : <span>{entry.name}{entry.size === null ? '' : <span className="muted"> · {entry.size} B</span>}</span>}
            </li>
          ))}
          {listing.truncated ? <li className="muted">More entries than shown.</li> : null}
        </ul>
      )}
      {git === undefined ? null : (
        <div aria-label="Git">
          <div>Branch <code>{git.branch}</code> · {git.status.length === 0 ? 'clean' : `${git.status.length} changed`}</div>
          {git.status.length === 0 ? null : <ul className="directory-list" aria-label="Changes">{git.status.map((entry) => <li key={entry.path}><code>{entry.code}</code> {entry.path}</li>)}</ul>}
          <ul className="directory-list" aria-label="Commits">{git.log.map((commit) => <li key={commit.hash}><code>{commit.hash.slice(0, 7)}</code> {commit.subject} <span className="muted">· {commit.author}</span></li>)}</ul>
        </div>
      )}
    </section>
  )
}
