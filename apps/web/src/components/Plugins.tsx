import { useState, type ReactNode } from 'react'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { PluginField, PluginView } from '@mr-robot/protocol'
import {
  IconAlarmClockOutlineRegular, IconCodeOutlineRegular, IconEditOutlineRegular, IconFolderOpenOutlineRegular, IconGlobeOutlineRegular,
  IconLinkOutlineRegular, IconSearchOutlineRegular, IconSendOutlineRegular, IconSparkleRegular, IconThinkOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { siDiscord, siGoogle } from 'simple-icons'
import { keys, pluginsAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { go } from '../route.ts'
import { AtomView, renderResult } from './AtomView.tsx'
import { Empty } from './States.tsx'

function Brand({ path, color }: { path: string; color: string }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={path} fill={color} /></svg>
}

/** The tile icon of a plugin, by the icon name its entry carries. */
export function PluginIcon({ icon }: { icon: string }): ReactNode {
  const glyph = (() => {
    switch (icon) {
      case 'folder': return <IconFolderOpenOutlineRegular />
      case 'globe': return <IconGlobeOutlineRegular />
      case 'browser': return <IconCodeOutlineRegular />
      case 'alarm': return <IconAlarmClockOutlineRegular />
      case 'send': return <IconSendOutlineRegular />
      case 'key': return <IconLinkOutlineRegular />
      case 'sparkle': return <IconSparkleRegular />
      case 'bell': return <IconThinkOutlineRegular />
      case 'search': return <IconSearchOutlineRegular />
      case 'google': return <Brand path={siGoogle.path} color={`#${siGoogle.hex}`} />
      case 'discord': return <Brand path={siDiscord.path} color={`#${siDiscord.hex}`} />
      case 'slack': return <span className="plugin-glyph">#</span>
      default: return <IconEditOutlineRegular />
    }
  })()
  return <span className="plugin-icon">{glyph}</span>
}

/** The Plugins page (cn-dbm9, reference 12): every plugin, its description, and the Home's switch. */
export function PluginsPage({ isAdmin }: { isAdmin: boolean }) {
  return (
    <AtomView atom={pluginsAtom} what="the plugins">
      {(plugins) => (
        <div className="plugins">
          <div className="muted">What Robots in this Home can do. {isAdmin ? 'Switch a plugin off to take it from every Robot; open one for its settings.' : 'The Home admin switches plugins on and off.'}</div>
          <PluginGroup title="Built-in" plugins={plugins.filter((plugin) => plugin.group === 'capability')} isAdmin={isAdmin} />
          <PluginGroup title="Connectors" plugins={plugins.filter((plugin) => plugin.group === 'connector')} isAdmin={isAdmin} />
        </div>
      )}
    </AtomView>
  )
}

function PluginGroup({ title, plugins, isAdmin }: { title: string; plugins: readonly PluginView[]; isAdmin: boolean }) {
  const command = useCommand()
  const [failure, setFailure] = useState<string>()
  return (
    <section>
      <h2>{title} <span className="muted">{plugins.length}</span></h2>
      {failure === undefined ? null : <div className="muted">{failure}</div>}
      <ul className="plugin-list">
        {plugins.map((plugin) => (
          <li key={plugin.name} className="plugin-row">
            <button type="button" className="plugin-open" onClick={() => go({ page: 'plugin', name: plugin.name })}>
              <PluginIcon icon={plugin.icon} />
              <span className="plugin-text">
                <span className="plugin-title">{plugin.title}{plugin.setupNeeded !== null && plugin.enabled ? <span className="badge">Needs setup</span> : null}</span>
                <span className="muted">{plugin.description}</span>
              </span>
            </button>
            <button type="button" role="switch" aria-checked={plugin.enabled} aria-label={`${plugin.title} on`} disabled={!isAdmin}
              className={plugin.enabled ? 'switch on' : 'switch'}
              onClick={() => void command((api) => api.setPluginEnabled(plugin.name, !plugin.enabled), [keys.plugins, keys.admin]).then((exit) => setFailure(exitFailure(exit)))}><span /></button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A plugin's own page (reference 13): icon, name, description, the form from its schema, Save. */
export function PluginDetail({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const result = useAtomValue(pluginsAtom)
  return (
    <div className="plugin-detail">
      <button type="button" className="link back-link" onClick={() => go({ page: 'plugins' })}>‹ Plugins</button>
      {renderResult(result, { what: 'the plugin' }, (plugins) => {
        const plugin = plugins.find((entry) => entry.name === name)
        if (plugin === undefined) return <Empty title="No such plugin" hint="It may have been removed from this Home." />
        return <PluginSettings key={JSON.stringify([plugin.values, plugin.secretsSet])} plugin={plugin} isAdmin={isAdmin} />
      })}
    </div>
  )
}

function PluginSettings({ plugin, isAdmin }: { plugin: PluginView; isAdmin: boolean }) {
  const command = useCommand()
  const [values, setValues] = useState<Record<string, unknown>>(plugin.values)
  const [message, setMessage] = useState<string>()
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(values) !== JSON.stringify(plugin.values)
  const save = async () => {
    setSaving(true)
    const exit = await command((api) => api.savePluginSettings(plugin.name, values), [keys.plugins, keys.admin])
    setMessage(exitFailure(exit) ?? 'Saved.')
    setSaving(false)
  }
  return (
    <>
      <div className="plugin-detail-head">
        <PluginIcon icon={plugin.icon} />
        <h1>{plugin.title}</h1>
        <div className="muted">{plugin.description}</div>
      </div>
      {plugin.setupNeeded === null ? null : <div className="note">{plugin.setupNeeded}</div>}
      {!isAdmin ? <div className="muted">Only the Home admin changes this plugin's settings.</div> : plugin.fields.length === 0 ? <div className="muted">This plugin has no settings.</div> : (
        <div className="form">
          <h3>Settings</h3>
          <SchemaFields fields={plugin.fields} values={values} secretsSet={plugin.secretsSet} onChange={setValues} />
          <div className="question-actions">
            {message === undefined ? null : <span className="muted">{message}</span>}
            <button type="button" className="button button-primary" disabled={saving || !dirty} onClick={() => void save()}>Save</button>
          </div>
        </div>
      )}
    </>
  )
}

/** Inputs for described fields (cn-s1pd): a stored secret shows as stored and is replaced only when typed again. */
export function SchemaFields({ fields, values, secretsSet, onChange }: {
  fields: readonly PluginField[]
  values: Readonly<Record<string, unknown>>
  secretsSet: readonly string[]
  onChange: (values: Record<string, unknown>) => void
}) {
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value })
  return (
    <div className="schema-fields">
      {fields.map((field) => {
        const value = values[field.key]
        const label = <span>{field.label}{field.required ? '' : <span className="muted"> (optional)</span>}</span>
        const hint = field.description === null ? null : <small className="muted">{field.description}</small>
        switch (field.kind) {
          case 'boolean':
            return <label key={field.key} className="check"><input type="checkbox" checked={value === true} onChange={(event) => set(field.key, event.target.checked)} /><span>{field.label}{hint}</span></label>
          case 'choice':
            return <label key={field.key}>{label}<select value={typeof value === 'string' ? value : ''} onChange={(event) => set(field.key, event.target.value)}><option value="" />{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{hint}</label>
          case 'choices': {
            const chosen = Array.isArray(value) ? (value as string[]) : []
            return (
              <fieldset key={field.key} className="choices"><legend>{field.label}</legend>
                {field.options.map((option) => <label key={option.value} className="check"><input type="checkbox" checked={chosen.includes(option.value)} onChange={() => set(field.key, chosen.includes(option.value) ? chosen.filter((item) => item !== option.value) : [...chosen, option.value])} /><span>{option.label}</span></label>)}
                {hint}
              </fieldset>
            )
          }
          case 'number':
            return <label key={field.key}>{label}<input type="number" value={typeof value === 'number' ? value : ''} onChange={(event) => set(field.key, event.target.value === '' ? undefined : Number(event.target.value))} />{hint}</label>
          case 'secret':
            return <label key={field.key}>{label}<input type="password" autoComplete="off" value={typeof value === 'string' ? value : ''} placeholder={secretsSet.includes(field.key) ? 'Stored: type to replace' : ''} onChange={(event) => set(field.key, event.target.value)} />{hint}</label>
          case 'text':
            return <label key={field.key}>{label}<input value={typeof value === 'string' ? value : ''} onChange={(event) => set(field.key, event.target.value)} />{hint}</label>
        }
      })}
    </div>
  )
}

/** Whether every plugin has loaded, for pages that need the list without their own states. */
export function usePlugins(): readonly PluginView[] {
  return AsyncResult.getOrElse(useAtomValue(pluginsAtom), () => [])
}
