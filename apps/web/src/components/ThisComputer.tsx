import { useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'

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
  if (state === undefined) return <div className="muted">Loading…</div>
  const pair = async () => {
    setMessage(undefined)
    const started = await bridge.pair()
    if (started.error !== undefined) return setMessage(started.error)
    // Signed in already (hs-upeq): this page approves the app's code itself.
    if (started.code !== undefined) {
      await api.approvePairing(started.code).catch((error: unknown) => setMessage(error instanceof ApiError ? error.message : 'could not pair'))
    }
  }
  const unpair = async () => {
    if (!confirm(`Unpair ${state.name}? Robots stop using it until you pair it again.`)) return
    if (state.hostId !== null) await api.unpairHost(state.hostId).catch(() => undefined)
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
