import { useState } from 'react'
import { useAtomValue } from '@effect/atom-react'
import * as Exit from 'effect/Exit'
import { AsyncResult } from 'effect/reactivity'
import type { ConnectionView, PluginView } from '@mr-robot/protocol'
import { connectionsAtom, keys, pluginsAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { go } from '../route.ts'
import { renderResult } from './AtomView.tsx'
import { SchemaFields } from './Plugins.tsx'

/**
 * Connections (cn-s1pd, reference 11): one row per connector plugin with its status and
 * Connect/Manage, rendered from the plugin list; a new connector adds a row without code here.
 */
export function Connections() {
  const plugins = useAtomValue(pluginsAtom)
  const connections = useAtomValue(connectionsAtom)
  return (
    <>
      <h2>Connections</h2>
      <div className="muted">Accounts your Robots can act on. Each Robot gets only the connections you grant it in its settings. <button type="button" className="link" onClick={() => go({ page: 'plugins' })}>All plugins</button></div>
      {renderResult(AsyncResult.all([plugins, connections]), { what: 'your connections' }, ([pluginList, connectionList]) => (
        <div className="providers">
          {pluginList.filter((plugin) => plugin.connector !== null && plugin.enabled).map((plugin) => (
            <ConnectorRow key={plugin.name} plugin={plugin} connections={connectionList.filter((connection) => connection.kind === plugin.connector!.kind)} />
          ))}
        </div>
      ))}
    </>
  )
}

function statusOf(plugin: PluginView, connections: readonly ConnectionView[]): { text: string; tone: 'ok' | 'warn' | 'off' } {
  if (connections.some((connection) => connection.mine && connection.status === 'needs-reconsent')) return { text: 'Needs consent again', tone: 'warn' }
  if (connections.some((connection) => connection.mine && connection.status === 'rejected')) return { text: 'Paste again', tone: 'warn' }
  if (connections.length > 0) return { text: connections.length === 1 ? 'Connected' : `${connections.length} connected`, tone: 'ok' }
  if (plugin.setupNeeded !== null) return { text: 'Not set up', tone: 'off' }
  return { text: 'Not connected', tone: 'off' }
}

function ConnectorRow({ plugin, connections }: { plugin: PluginView; connections: readonly ConnectionView[] }) {
  const [open, setOpen] = useState(false)
  const status = statusOf(plugin, connections)
  return (
    <div className="provider connector-row">
      <div className="provider-head">
        <div className="provider-name">
          <div>{plugin.title}</div>
          <div className="muted">{plugin.description}</div>
        </div>
        <div className="provider-action">
          <span className={`connect-status connect-status-${status.tone}`}>{status.text}</span>
          <button type="button" className="button" onClick={() => setOpen(!open)}>{connections.length === 0 ? 'Connect' : 'Manage'}</button>
        </div>
      </div>
      {open ? <ConnectorPanel plugin={plugin} connections={connections} /> : null}
    </div>
  )
}

function ConnectorPanel({ plugin, connections }: { plugin: PluginView; connections: readonly ConnectionView[] }) {
  const command = useCommand()
  const [message, setMessage] = useState<string>()
  const change = async (run: Parameters<typeof command>[0]) => setMessage(exitFailure(await command(run, [keys.connections])))
  const connector = plugin.connector!
  return (
    <div className="connector-panel">
      {connections.length === 0 ? null : (
        <ul className="connection-list">
          {connections.map((connection) => (
            <li key={connection.id} className="connection">
              <div className="connection-name">
                <b>{connection.label}</b> <span className="muted">{connection.account}{connection.mine ? '' : ` · ${connection.ownerName}'s, shared`}</span>
                {connection.services.length > 0 ? <div className="muted">{connection.services.join(', ')}</div> : null}
                {connection.status === 'connected' ? null : <div className="host-log-failed">{connection.status === 'needs-reconsent' ? 'Needs consent again' : 'Paste again'}{connection.statusNote === null ? '' : `: ${connection.statusNote}`}</div>}
              </div>
              {connection.mine ? (
                <div className="connection-actions">
                  <label className="check"><input type="radio" name={`default-${connector.kind}`} checked={connection.isDefault} onChange={() => void change((api) => api.updateConnection(connection.id, { isDefault: true }))} /><span>Default</span></label>
                  <label className="check"><input type="checkbox" checked={connection.shared} onChange={(event) => { const shared = event.target.checked; void change((api) => api.updateConnection(connection.id, { shared })) }} /><span>Shared with the Home</span></label>
                  <button type="button" className="link danger" onClick={() => { if (confirm(`Remove ${connection.label}? Robots granted it lose it.`)) void change((api) => api.removeConnection(connection.id)) }}>Remove</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {message === undefined ? null : <div className="muted">{message}</div>}
      {plugin.setupNeeded !== null ? <div className="note">{plugin.setupNeeded}</div>
        : connector.connect.method === 'paste' ? <PasteConnect plugin={plugin} fields={connector.connect.fields} instructions={connector.connect.instructions} />
          : <OAuthConnect plugin={plugin} services={connector.connect.services} />}
    </div>
  )
}

function PasteConnect({ plugin, fields, instructions }: { plugin: PluginView; fields: Extract<NonNullable<PluginView['connector']>['connect'], { method: 'paste' }>['fields']; instructions: string }) {
  const command = useCommand()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [label, setLabel] = useState('')
  const [shared, setShared] = useState(false)
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true)
    const strings = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const exit = await command((api) => api.pasteConnection(plugin.connector!.kind, { ...(label.trim() === '' ? {} : { label: label.trim() }), shared, values: strings }), [keys.connections])
    if (Exit.isSuccess(exit)) { setValues({}); setLabel(''); setMessage(`Connected ${exit.value.account}.`) } else setMessage(exitFailure(exit))
    setBusy(false)
  }
  return (
    <div className="form connect-form">
      <div className="muted">{instructions}</div>
      <SchemaFields fields={fields} values={values} secretsSet={[]} onChange={setValues} />
      <label><span>Name <span className="muted">(optional)</span></span><input value={label} placeholder="Shown to your Robots, e.g. Work" onChange={(event) => setLabel(event.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /><span>Shared with the Home</span></label>
      <div className="question-actions">{message === undefined ? null : <span className="muted">{message}</span>}<button type="button" className="button button-primary" disabled={busy} onClick={() => void connect()}>Connect</button></div>
    </div>
  )
}

function OAuthConnect({ plugin, services }: { plugin: PluginView; services: ReadonlyArray<{ value: string; label: string }> }) {
  const [chosen, setChosen] = useState<string[]>(services.map((service) => service.value).filter((value) => value !== 'gmail-send'))
  const [shared, setShared] = useState(false)
  const start = `/api/connections/${plugin.connector!.kind}/oauth/start?services=${encodeURIComponent(chosen.join(','))}&shared=${shared ? 1 : 0}`
  return (
    <div className="form connect-form">
      <div className="muted">Choose what this account grants. Robots can never get more than you choose here; each Robot still needs its own grant.</div>
      <div className="check-grid">{services.map((service) => (
        <label key={service.value} className="check"><input type="checkbox" checked={chosen.includes(service.value)} onChange={() => setChosen(chosen.includes(service.value) ? chosen.filter((value) => value !== service.value) : [...chosen, service.value])} /><span>{service.label}</span></label>
      ))}</div>
      <label className="check"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /><span>Shared with the Home</span></label>
      <div className="question-actions"><a className={chosen.length === 0 ? 'button button-primary disabled' : 'button button-primary'} href={chosen.length === 0 ? undefined : start}>Connect {plugin.title}</a></div>
    </div>
  )
}
