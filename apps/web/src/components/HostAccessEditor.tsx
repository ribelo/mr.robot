import { HOST_GRANT_MODES, isHostRoot, type HostGrantAccess, type HostGrantMode } from '@mr-robot/protocol'

const MODE_TEXT: Readonly<Record<HostGrantMode, string>> = {
  'read-only': 'Read only: nothing on the computer may be changed',
  'workspace-write': "Its own folder, and the folders listed below",
  full: 'Full: anywhere the computer user can write, with no sandbox',
}

/** The lines of the roots box that are not a folder path; empty lines are ignored. */
export const badRoots = (roots: readonly string[]): string[] => roots.map((root) => root.trim()).filter((root) => root !== '' && !isHostRoot(root))

/**
 * What one Host files or shell grant lets the Robot change (v1.16 ticket 02, ob-wh59): a mode and, in workspace-write, more folders
 * besides the Robot's own ~/mr-robot/<robot>/. Reads are as wide as the computer user in every mode.
 */
export function HostAccessEditor({ label, value, onChange }: { label: string; value: HostGrantAccess; onChange: (value: HostGrantAccess) => void }) {
  const bad = badRoots(value.roots)
  return (
    <div className="host-access">
      <label>Changes allowed
        <select aria-label={`${label} changes allowed`} value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value as HostGrantMode })}>
          {HOST_GRANT_MODES.map((mode) => <option key={mode} value={mode}>{MODE_TEXT[mode]}</option>)}
        </select>
      </label>
      {value.mode !== 'workspace-write' ? null : (
        <label>More folders to change (one per line)
          <textarea rows={2} aria-label={`${label} write roots`} placeholder="~/projects" value={value.roots.join('\n')} onChange={(event) => onChange({ ...value, roots: event.target.value.split('\n') })} />
          <small className="muted">The Robot's own folder on that computer is always included. Write absolute paths, or ~/ for the home folder.</small>
          {bad.length === 0 ? null : <small role="alert">Not a folder path: {bad.join(', ')}</small>}
        </label>
      )}
    </div>
  )
}
