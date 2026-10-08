import { Loading, Empty, ErrorState } from './States.tsx'
import { useEffect, useState } from 'react'
import { hostActionsAtom, keys, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { AtomView } from './AtomView.tsx'

/** The desktop app's bridge (apps/host preload); absent in a browser. */
interface HostState {
  readonly server: string | null
  readonly name: string
  readonly hostId: string | null
  readonly autostart: boolean
  readonly state: 'unpaired' | 'pairing' | 'connecting' | 'online' | 'offline'
  readonly detail?: string
  readonly sessions: number
}
interface HostBridge {
  state(): Promise<HostState>
  save(change: { server?: string; name?: string; autostart?: boolean }): Promise<{ ok?: boolean; error?: string }>
  pair(): Promise<{ ok?: boolean; code?: string; error?: string }>
  unpair(): Promise<{ ok?: boolean }>
  onChange(listener: (state: HostState) => void): void
  /** Older apps lack these. */
  setUnread?(count: number): Promise<unknown>
  readonly nativeNotifications?: boolean
}

export const hostBridge = (): HostBridge | undefined => (globalThis as { mrRobotHost?: HostBridge }).mrRobotHost

const LINES: Record<HostState['state'], string> = {
  unpaired: 'Not paired: robots cannot use this computer yet.',
  pairing: 'Pairing…',
  connecting: 'Connecting…',
  online: 'Connected: robots you grant this computer can use it.',
  offline: 'Offline, retrying…',
}

/** "This computer" (hs-p0jr): the desktop app's host settings, inside the Mr. Robot interface. */
export function ThisComputer() {
  const bridge = hostBridge()
  const command = useCommand()
  const [state, setState] = useState<HostState>()
  const [name, setName] = useState('')
  const [server, setServer] = useState('')
  const [message, setMessage] = useState<string>()
  useEffect(() => {
    if (bridge === undefined) return
    void bridge.state().then((value) => { setState(value); setName(value.name); setServer(value.server ?? '') })
    bridge.onChange(setState)
  }, [bridge])
  if (bridge === undefined) return <div className="muted">This page belongs to the Mr. Robot desktop app. Install it on a computer to let your robots use that computer.</div>
  if (state === undefined) return <Loading />
  const pair = async () => {
    setMessage(undefined)
    const started = await bridge.pair()
    if (started.error !== undefined) return setMessage(started.error)
    // Signed in already (hs-upeq): this page approves the app's code itself.
    const code = started.code
    if (code !== undefined) {
      const failure = exitFailure(await command((api) => api.approvePairing(code), [keys.hosts]))
      if (failure !== undefined) setMessage(failure)
    }
  }
  const unpair = async () => {
    if (!confirm(`Unpair ${state.name}? Robots stop using it until you pair it again.`)) return
    const hostId = state.hostId
    if (hostId !== null) await command((api) => api.unpairHost(hostId), [keys.hosts])
    await bridge.unpair()
  }
  return (
    <div className="form">
      <div className="status-card"><b>{LINES[state.state]}</b>{state.detail === undefined ? null : <div className="muted">{state.detail}</div>}{state.sessions > 0 ? <div className="muted">{state.sessions} robot browser session(s) open</div> : null}</div>
      <label>Name of this computer
        <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => { if (name !== state.name) void bridge.save({ name }).then((result) => setMessage(result.error ?? 'Saved.')) }} />
      </label>
      <label className="check"><input type="checkbox" checked={state.autostart} onChange={(event) => void bridge.save({ autostart: event.target.checked })} /><span>Start when I log in<small>The app starts in the tray and keeps this computer available to your robots.</small></span></label>
      <div className="question-actions">
        {message === undefined ? null : <span className="muted">{message}</span>}
        {state.hostId === null
          ? <button type="button" className="button button-primary" disabled={state.state === 'pairing'} onClick={() => void pair()}>Pair this computer</button>
          : <button type="button" className="button" onClick={() => void unpair()}>Unpair</button>}
      </div>
      {state.hostId === null ? null : <HostLog hostId={state.hostId} />}
      <h2>Server</h2>
      <label>Mr. Robot server address
        <input value={server} onChange={(event) => setServer(event.target.value)} />
      </label>
      <div className="muted">Changing it moves the app to another Mr. Robot: you sign in there and pair this computer again.</div>
      <div className="question-actions">
        <button type="button" className="button" disabled={server.trim() === '' || server === state.server} onClick={() => { if (confirm(`Move this app to ${server}?`)) void bridge.save({ server }).then((result) => { if (result.error !== undefined) setMessage(result.error) }) }}>Change server</button>
      </div>
    </div>
  )
}

/** What robots did on this computer (pl-vcy7): newest first, with the exit status of each command. */
function HostLog({ hostId }: { hostId: string }) {
  return (
    <>
      <h2>What robots did here</h2>
      <AtomView atom={hostActionsAtom(hostId)} what="the log" errorTitle="The log cannot be loaded">
        {(actions) => actions.length === 0 ? <Empty title="Nothing yet" hint="No robot has used this computer yet." /> : (
          <table className="grid host-log">
            <thead><tr><th>When</th><th>Robot</th><th>Action</th><th>Result</th></tr></thead>
            <tbody>
              {actions.map((entry, index) => (
                <tr key={index}>
                  <td>{new Date(entry.at).toLocaleString()}</td>
                  <td>{entry.robotName}</td>
                  <td className="wrap"><code>{entry.action}</code> {entry.detail}</td>
                  <td className={entry.outcome === 'done' && (entry.exitCode ?? 0) === 0 ? 'muted' : 'host-log-failed wrap'}>{entry.outcome === 'done' ? (entry.exitCode === null ? 'done' : `exit ${entry.exitCode}`) : entry.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AtomView>
    </>
  )
}
