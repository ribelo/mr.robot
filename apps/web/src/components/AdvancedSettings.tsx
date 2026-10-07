import { useState, useEffect } from 'react'
import type { GrantSet, RobotPanel, SettingsCatalog, SettingsPatch, ThinkingEffort, BrowserBackend } from '@mr-robot/protocol'
import { ModelSelect } from './ModelSelect.tsx'
import { ConfirmButton } from './RobotSheets.tsx'
import { api } from '../api.ts'

export interface AdvancedSettingsProps {
  readonly panel: RobotPanel
  readonly catalog: SettingsCatalog
  readonly onSave: (patch: SettingsPatch) => Promise<void>
  readonly onPause: () => void
  readonly onResume: () => void
  readonly onDelete: () => void
}

const EFFORTS: readonly ThinkingEffort[] = ['off', 'low', 'medium', 'high', 'max']

/**
 * What the Robot was given (robot-vqtw): model and effort, context budget, code mode,
 * compaction instruction, Grants, sharing, notifications and spend limit.
 */
export function AdvancedSettings({ panel, catalog, onSave, onPause, onResume, onDelete }: AdvancedSettingsProps) {
  const settings = panel.settings
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const model = catalog.models.find((option) => option.provider === draft.model.provider && option.model === draft.model.model)
  const maxBudget = model?.contextWindow ?? 1_000_000
  const toggle = (kind: keyof GrantSet, name: string) => {
    const current = draft.grants[kind] ?? []
    const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
    setDraft({ ...draft, grants: { ...draft.grants, [kind]: next } })
  }
  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        model: draft.model,
        contextBudget: draft.contextBudget,
        codeMode: draft.codeMode,
        browserBackend: draft.browserBackend,
        compactionInstruction: draft.compactionInstruction,
        grants: draft.grants,
        sharing: draft.sharing,
        notifications: draft.notifications,
        spendLimitUsd: draft.spendLimitUsd,
      })
    } finally {
      setSaving(false)
    }
  }
  const mrRobot = panel.summary.kind === 'mr-robot'
  return (
    <div className="form">
      <h2>Model</h2>
      <label>Model
        <ModelSelect
          value={draft.model}
          models={catalog.models}
          unavailable={catalog.unavailableModels ?? []}
          onChange={(option) => setDraft({ ...draft, model: { ...draft.model, provider: option.provider, model: option.model } })}
        />
      </label>
      <label>Thinking effort
        <select value={draft.model.effort} onChange={(event) => setDraft({ ...draft, model: { ...draft.model, effort: event.target.value as ThinkingEffort } })}>
          {EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </select>
      </label>
      <label>Context budget: {Math.round(draft.contextBudget / 1000)}k tokens
        <input type="range" min={8000} max={maxBudget} step={8000} value={Math.min(draft.contextBudget, maxBudget)} onChange={(event) => setDraft({ ...draft, contextBudget: Number(event.target.value) })} />
      </label>
      <label className="check"><input type="checkbox" checked={draft.codeMode} onChange={(event) => setDraft({ ...draft, codeMode: event.target.checked })} />
        <span>Code mode<small>The Robot writes one program that calls its tools; off means direct tool calls.</small></span>
      </label>
      <label>Browser
        <select aria-label="Browser backend" value={draft.browserBackend ?? ''} onChange={(event) => setDraft({ ...draft, browserBackend: event.target.value === '' ? null : (event.target.value as BrowserBackend) })}>
          <option value="">Home default ({(catalog.browserBackends ?? []).find((option) => option.id === catalog.defaultBrowserBackend)?.label ?? 'Browser Run'})</option>
          {(catalog.browserBackends ?? []).map((option) => <option key={option.id} value={option.id} disabled={!option.available}>{option.label}{option.available ? '' : ' (not available)'}</option>)}
        </select>
        <small className="muted">{(catalog.browserBackends ?? []).find((option) => option.id === (draft.browserBackend ?? catalog.defaultBrowserBackend))?.note ?? ''} Takes effect the next time the Robot opens its browser; cookies and logins carry over.</small>
      </label>
      <label>Compaction instruction
        <textarea rows={3} value={draft.compactionInstruction} placeholder="What must survive when the conversation is compacted" onChange={(event) => setDraft({ ...draft, compactionInstruction: event.target.value })} />
      </label>

      <h2>Tools</h2>
      <div className="check-grid scroll-box">
        {catalog.toolGroups.map((group) => (
          <label key={group.name} className="check">
            <input type="checkbox" checked={draft.grants.tools.includes(group.name)} onChange={() => toggle('tools', group.name)} />
            <span>{group.name}<small>{group.description}</small></span>
          </label>
        ))}
      </div>
      <h2>Skills</h2>
      {catalog.skills.length === 0 ? <div className="muted">No skills in the library yet.</div> : (
        <div className="check-grid scroll-box">
          {catalog.skills.map((skill) => (
            <label key={skill.name} className="check"><input type="checkbox" checked={draft.grants.skills.includes(skill.name)} onChange={() => toggle('skills', skill.name)} /><span>{skill.name}<small>{skill.description}</small></span></label>
          ))}
        </div>
      )}
      <h2>Recipients</h2>
      {mrRobot ? <div className="muted">Mr. Robot can message every Robot you can reach.</div> : catalog.robots.length === 0 ? <div className="muted">No other Robots to message.</div> : (
        <div className="check-grid">
          {catalog.robots.map((robot) => (
            <label key={robot.id} className="check"><input type="checkbox" checked={draft.grants.recipients.includes(robot.id)} onChange={() => toggle('recipients', robot.id)} /><span>{robot.name}</span></label>
          ))}
        </div>
      )}
      <h2>Logins</h2>
      {catalog.secrets.length === 0 ? <div className="muted">No logins yet: add them under your name → Logins.</div> : (
        <div className="check-grid">
          {catalog.secrets.map((secret) => (
            <label key={secret.name} className="check"><input type="checkbox" checked={draft.grants.secrets.includes(secret.name)} onChange={() => toggle('secrets', secret.name)} /><span>{secret.name}<small>{[secret.username, (secret.websites ?? []).join(', '), secret.scope === 'home' ? 'shared with the Home' : 'yours'].filter((part) => part !== undefined && part !== '').join(' · ')}</small></span></label>
          ))}
        </div>
      )}

      <h2>Channels</h2>
      <div className="muted">Where this Robot hears and answers. The app is always on; more Channels (Discord) come as adapters.</div>
      <ul className="grant-list">
        {draft.notifications.channels.map((channel) => <li key={channel}><span className="grant-kind">Channel</span> {channel === 'pwa' ? 'This app (chat and push notifications)' : channel}</li>)}
      </ul>
      <label className="check"><input type="checkbox" checked={draft.notifications.enabled} onChange={(event) => setDraft({ ...draft, notifications: { ...draft.notifications, enabled: event.target.checked } })} />
        <span>Notifications<small>Push when it finishes, needs you, or is blocked.</small></span>
      </label>

      <PromptPreview id={panel.summary.id} />

      <h2>Sharing and limits</h2>
      {mrRobot ? null : (
        <label className="check"><input type="checkbox" checked={draft.sharing === 'home'} onChange={(event) => setDraft({ ...draft, sharing: event.target.checked ? 'home' : 'private' })} />
          <span>Shared with the Home<small>Other Members can talk to it and use it.</small></span>
        </label>
      )}
      <label>Monthly spend limit (USD, empty = Home default)
        <input type="number" min={0} step={1} value={draft.spendLimitUsd ?? ''} onChange={(event) => setDraft({ ...draft, spendLimitUsd: event.target.value === '' ? null : Number(event.target.value) })} />
      </label>

      <div className="question-actions">
        {panel.summary.status === 'paused'
          ? <button type="button" className="button" onClick={onResume}>Resume</button>
          : <button type="button" className="button" onClick={onPause}>Pause</button>}
        {mrRobot ? null : <ConfirmButton label="Delete" confirm="Delete this Robot" onConfirm={onDelete} />}
        <span className="spacer" />
        <button type="button" className="button button-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

/** What the model receives at the start of the next Turn (saved settings, not the draft). */
function PromptPreview({ id }: { id: string }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.prompt>>>()
  useEffect(() => { void api.prompt(id).then(setPreview) }, [id])
  return (
    <>
      <h2>Prompt</h2>
      <div className="muted">What the model is given at the start of each Turn, as saved. Secret values are masked.</div>
      {preview === undefined ? <div className="muted">Loading…</div> : (
        <>
          {preview.sections.map((section) => (
            <details key={section.name} className="prompt-section">
              <summary>{section.name} <span className="muted">· {section.text.length.toLocaleString()} characters</span></summary>
              <pre>{section.text}</pre>
            </details>
          ))}
          <details className="prompt-section">
            <summary>Skills <span className="muted">· {preview.skills.length}</span></summary>
            <pre>{preview.skills.join('\n') || 'none granted'}</pre>
          </details>
        </>
      )}
    </>
  )
}
