import { useState, type ReactNode } from 'react'
import { useAtomValue } from '@effect/atom-react'
import * as Exit from 'effect/Exit'
import { AsyncResult } from 'effect/reactivity'
import type { ConnectionNote, ConnectionView, ConnectorWay, PluginView } from '@mr-robot/protocol'
import { connectionNotesAtom, connectionsAtom, keys, pluginsAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { go } from '../route.ts'
import { renderResult } from './AtomView.tsx'
import { SchemaFields } from './Plugins.tsx'
import { SignInConnect, useSignInAttempt, useSignInWay } from './SignInConnect.tsx'

/**
 * Connections (cn-s1pd, reference 11): one row per connector plugin with its status and
 * Connect/Manage, rendered from the plugin list; a new connector adds a row without code here.
 * A plugin with several ways to connect (Discord: as a bot, as you) shows each way with its own
 * status and Connect (ux-s8rx).
 */
export function Connections() {
  const plugins = useAtomValue(pluginsAtom)
  const connections = useAtomValue(connectionsAtom)
  const notes = AsyncResult.getOrElse(useAtomValue(connectionNotesAtom), () => [])
  // A Google consent comes back to #/me?connected=… or ?connection-error=… (v1.5 ticket 02).
  const outcome = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const connected = outcome.get('connected')
  const failed = outcome.get('connection-error')
  return (
    <>
      <h2>Connections</h2>
      {connected === null ? null : <div className="note note-ok">Connected {connected}.</div>}
      {failed === null ? null : <div className="note">{failed.charAt(0).toUpperCase() + failed.slice(1)}.</div>}
      <div className="muted">Accounts your Robots can act on. Each Robot gets only the connections you grant it in its settings. <button type="button" className="link" onClick={() => go({ page: 'plugins' })}>All plugins</button></div>
      {renderResult(AsyncResult.all([plugins, connections]), { what: 'your connections' }, ([pluginList, connectionList]) => (
        <div className="providers">
          {notes.map((note) => <UnsharedNote key={note.id} note={note} title={pluginList.find((plugin) => plugin.connectors.some((way) => way.kind === note.kind))?.title ?? note.kind} />)}
          {pluginList.filter((plugin) => plugin.connectors.length > 0 && plugin.enabled).map((plugin) => (
            <ConnectorRow key={plugin.name} plugin={plugin} connections={connectionList} />
          ))}
        </div>
      ))}
    </>
  )
}

/** A person connection the update unshared (ux-cop2): what changed and which Robots lost it, until dismissed. */
function UnsharedNote({ note, title }: { note: ConnectionNote; title: string }) {
  const command = useCommand()
  const [message, setMessage] = useState<string>()
  const robots = note.robots.map((robot) => `${robot.name} (${robot.ownerName})`).join(', ')
  return (
    <div className="note">
      Your {title} connection <b>{note.label}</b> ({note.account}) acts as you, so it is no longer shared with the Space.{' '}
      {note.robots.length === 0 ? 'No Robot of another Member had it.' : `Robots of other Members lost it: ${robots}.`}{' '}
      <button type="button" className="link" onClick={() => void command((api) => api.dismissConnectionNote(note.id), [keys.connections]).then((exit) => setMessage(exitFailure(exit)))}>Dismiss</button>
      {message === undefined ? null : <div className="muted">{message}</div>}
    </div>
  )
}

/** What a refused connection asks for: a session acting as the person is signed in again (ux-cbo3), a bot token pasted again. */
const rejectedText = (way: ConnectorWay): string => (way.actsAsPerson ? 'Sign in again' : 'Paste again')

function statusOf(plugin: PluginView, way: ConnectorWay, connections: readonly ConnectionView[]): { text: string; tone: 'ok' | 'warn' | 'off' } {
  if (connections.some((connection) => connection.mine && connection.status === 'needs-reconsent')) return { text: 'Needs consent again', tone: 'warn' }
  if (connections.some((connection) => connection.mine && connection.status === 'rejected')) return { text: rejectedText(way), tone: 'warn' }
  if (connections.length > 0) return { text: connections.length === 1 ? 'Connected' : `${connections.length} connected`, tone: 'ok' }
  if (plugin.setupNeeded !== null) return { text: 'Not set up', tone: 'off' }
  return { text: 'Not connected', tone: 'off' }
}

function ConnectorRow({ plugin, connections }: { plugin: PluginView; connections: readonly ConnectionView[] }) {
  const name = <><div>{plugin.title}</div><div className="muted">{plugin.description}</div></>
  const only = plugin.connectors.length === 1 ? plugin.connectors[0] : undefined
  return (
    <div className="provider connector-row">
      {only !== undefined ? <ConnectorWayRow plugin={plugin} way={only} several={false} connections={connections.filter((connection) => connection.kind === only.kind)}>{name}</ConnectorWayRow> : (
        <>
          <div className="provider-name">{name}</div>
          {plugin.connectors.map((way) => (
            <div key={way.kind} className="connector-way">
              <ConnectorWayRow plugin={plugin} way={way} several connections={connections.filter((connection) => connection.kind === way.kind)}><div>{way.way}</div></ConnectorWayRow>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/** One way to connect: its status, its own Connect or Manage, and its panel. */
function ConnectorWayRow({ plugin, way, several, connections, children }: { plugin: PluginView; way: ConnectorWay; several: boolean; connections: readonly ConnectionView[]; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const status = statusOf(plugin, way, connections)
  const action = connections.length === 0 ? 'Connect' : 'Manage'
  return (
    <>
      <div className="provider-head">
        <div className="provider-name">{children}</div>
        <div className="provider-action">
          <span className={`connect-status connect-status-${status.tone}`}>{status.text}</span>
          <button type="button" className="button" aria-label={several ? `${action} ${plugin.title} ${way.way.toLowerCase()}` : undefined} onClick={() => setOpen(!open)}>{action}</button>
        </div>
      </div>
      {open ? <ConnectorPanel plugin={plugin} way={way} connections={connections} /> : null}
    </>
  )
}

export function ConnectorPanel({ plugin, way, connections }: { plugin: PluginView; way: ConnectorWay; connections: readonly ConnectionView[] }) {
  const command = useCommand()
  const [message, setMessage] = useState<string>()
  const change = async (run: Parameters<typeof command>[0]) => setMessage(exitFailure(await command(run, [keys.connections])))
  const connector = way
  // In the desktop app Slack and Discord as you connect by signing in; the paste form is the fallback (ux-jpwz).
  const signIn = useSignInWay(plugin, way)
  const attempt = useSignInAttempt(way, signIn)
  const paste = connector.connect.method === 'paste' ? <PasteConnect way={way} form={connector.connect} /> : null
  return (
    <div className="connector-panel">
      {connections.length === 0 ? null : (
        <ul className="connection-list">
          {connections.map((connection) => (
            <li key={connection.id} className="connection">
              <div className="connection-name">
                <b>{connection.label}</b> <span className="muted">{connection.account}{connection.mine ? '' : ` · ${connection.ownerName}'s, shared`}</span>
                {connection.services.length > 0 ? <div className="muted">{connection.services.join(', ')}</div> : null}
                {connection.status === 'connected' ? null : <div className="host-log-failed">{connection.status === 'needs-reconsent' ? 'Needs consent again' : rejectedText(way)}{connection.statusNote === null ? '' : `: ${connection.statusNote}`}</div>}
                {connection.mine && connection.status === 'needs-reconsent' && connector.connect.method === 'oauth' ? <a className="button" href={`/api/connections/${connector.kind}/oauth/start?reconnect=${encodeURIComponent(connection.id)}${'mrRobotHost' in window ? '&external=1' : ''}`}>Reconnect</a> : null}
                {connection.mine && connection.status === 'rejected' && signIn !== undefined ? <button type="button" className="button" disabled={attempt.busy} onClick={attempt.run}>Sign in again</button> : null}
                {connection.setupLink === null ? null : <a className="button" href={connection.setupLink} target="_blank" rel="noreferrer">{connection.setupLabel ?? 'Finish setup'}</a>}
              </div>
              {connection.mine ? (
                <div className="connection-actions">
                  <label className="check"><input type="radio" name={`default-${connector.kind}`} checked={connection.isDefault} onChange={() => void change((api) => api.updateConnection(connection.id, { isDefault: true }))} /><span>Default</span></label>
                  {connector.actsAsPerson ? null : <label className="check"><input type="checkbox" checked={connection.shared} onChange={(event) => { const shared = event.target.checked; void change((api) => api.updateConnection(connection.id, { shared })) }} /><span>Shared with the Space</span></label>}
                  <button type="button" className="link danger" onClick={() => { if (confirm(`Remove ${connection.label}? Robots granted it lose it.`)) void change((api) => api.removeConnection(connection.id)) }}>Remove</button>
                </div>
              ) : null}
              <ConnectionInstructions connection={connection} />
            </li>
          ))}
        </ul>
      )}
      {message === undefined ? null : <div className="muted">{message}</div>}
      {plugin.setupNeeded === null && connections.some((connection) => connection.mine) ? <h4>Add another account</h4> : null}
      {plugin.setupNeeded !== null ? <div className="note">{plugin.setupNeeded}</div>
        : signIn !== undefined ? <SignInConnect way={way} signIn={signIn} attempt={attempt}>{paste}</SignInConnect>
          : connector.connect.method === 'paste' ? paste
          : <OAuthConnect plugin={plugin} way={way} services={connector.connect.services} />}
    </div>
  )
}

/**
 * What the owner wants Robots to do with a Connection (v1.15, gb-wzl9): "answer in threads on Slack", said once.
 * Every Robot granted the Connection reads it in its prompt. A Connection shared by someone else shows theirs, read-only.
 */
export function ConnectionInstructions({ connection }: { connection: ConnectionView }) {
  const command = useCommand()
  const stored = connection.instructions ?? ''
  const [text, setText] = useState(stored)
  const [message, setMessage] = useState<string>()
  if (!connection.mine) return stored === '' ? null : <div className="muted">Instructions: {stored}</div>
  const save = async () => setMessage(exitFailure(await command((api) => api.updateConnection(connection.id, { instructions: text }), [keys.connections])) ?? 'Saved.')
  return (
    <div className="connection-instructions">
      <label><span>Instructions for Robots <span className="muted">(optional)</span></span><textarea rows={2} value={text} placeholder="For example: answer in threads. Never mark messages read." aria-label={`Instructions for ${connection.label}`} onChange={(event) => { setText(event.target.value); setMessage(undefined) }} /></label>
      <div className="question-actions">{message === undefined ? null : <span className="muted">{message}</span>}<button type="button" className="button" disabled={text.trim() === stored.trim()} onClick={() => void save()}>Save instructions</button></div>
    </div>
  )
}

/** The paste form of a way; a warning (Discord as you, ux-gdg3) stands above its Connect. */
function PasteConnect({ way, form }: { way: ConnectorWay; form: Extract<ConnectorWay['connect'], { method: 'paste' }> }) {
  const command = useCommand()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [label, setLabel] = useState('')
  const [shared, setShared] = useState(false)
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true)
    const strings = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const exit = await command((api) => api.pasteConnection(way.kind, { ...(label.trim() === '' ? {} : { label: label.trim() }), shared, values: strings }), [keys.connections])
    if (Exit.isSuccess(exit)) { setValues({}); setLabel(''); setMessage(`Connected ${exit.value.account}.`) } else setMessage(exitFailure(exit))
    setBusy(false)
  }
  return (
    <div className="form connect-form">
      <div className="muted">{form.instructions}</div>
      <SchemaFields fields={form.fields} values={values} secretsSet={[]} onChange={setValues} />
      <label><span>Name <span className="muted">(optional)</span></span><input value={label} placeholder="Shown to your Robots, e.g. Work" onChange={(event) => setLabel(event.target.value)} /></label>
      {form.warning === undefined ? null : <div className="note">{form.warning}</div>}
      {way.actsAsPerson ? null : <label className="check"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /><span>Shared with the Space</span></label>}
      <div className="question-actions">{message === undefined ? null : <span className="muted">{message}</span>}<button type="button" className="button button-primary" disabled={busy} onClick={() => void connect()}>Connect</button></div>
    </div>
  )
}

function OAuthConnect({ plugin, way, services }: { plugin: PluginView; way: ConnectorWay; services: ReadonlyArray<{ value: string; label: string }> }) {
  const [chosen, setChosen] = useState<string[]>(services.map((service) => service.value).filter((value) => value !== 'gmail-send'))
  const [shared, setShared] = useState(false)
  // In the desktop app Google's sign-in finishes in the system browser (pa-e7xj).
  const external = typeof window !== 'undefined' && 'mrRobotHost' in window
  const start = `/api/connections/${way.kind}/oauth/start?services=${encodeURIComponent(chosen.join(','))}&shared=${shared ? 1 : 0}${external ? '&external=1' : ''}`
  return (
    <div className="form connect-form">
      <div className="muted">Choose what this account grants. Robots can never get more than you choose here; each Robot still needs its own grant. {plugin.title} asks which account to add; repeat this for each of your accounts.</div>
      <div className="check-grid">{services.map((service) => (
        <label key={service.value} className="check"><input type="checkbox" checked={chosen.includes(service.value)} onChange={() => setChosen(chosen.includes(service.value) ? chosen.filter((value) => value !== service.value) : [...chosen, service.value])} /><span>{service.label}</span></label>
      ))}</div>
      {way.actsAsPerson ? null : <label className="check"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /><span>Shared with the Space</span></label>}
      <div className="question-actions"><a className={chosen.length === 0 ? 'button button-primary disabled' : 'button button-primary'} href={chosen.length === 0 ? undefined : start}>Connect {plugin.title}</a></div>
    </div>
  )
}
