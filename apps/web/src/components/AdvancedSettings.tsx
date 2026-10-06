import { useState } from 'react'
import type { GrantSet, RobotPanel, SettingsCatalog, SettingsPatch, ThinkingEffort } from '@mr-robot/protocol'

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
    const current = draft.grants[kind]
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
  const chief = panel.summary.kind === 'chief'
  return (
    <div className="form">
      <h2>Model</h2>
      <label>Model
        <select
          value={`${draft.model.provider}/${draft.model.model}`}
          onChange={(event) => {
            const option = catalog.models.find((entry) => `${entry.provider}/${entry.model}` === event.target.value)
            if (option !== undefined) setDraft({ ...draft, model: { ...draft.model, provider: option.provider, model: option.model } })
          }}
        >
          {model === undefined ? <option value={`${draft.model.provider}/${draft.model.model}`}>{draft.model.provider} / {draft.model.model}</option> : null}
          {catalog.models.map((option) => <option key={`${option.provider}/${option.model}`} value={`${option.provider}/${option.model}`}>{option.label}</option>)}
        </select>
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
      <label>Compaction instruction
        <textarea rows={3} value={draft.compactionInstruction} placeholder="What must survive when the conversation is compacted" onChange={(event) => setDraft({ ...draft, compactionInstruction: event.target.value })} />
      </label>

      <h2>Tools</h2>
      <div className="check-grid">
        {catalog.toolGroups.map((group) => (
          <label key={group.name} className="check">
            <input type="checkbox" checked={draft.grants.tools.includes(group.name)} onChange={() => toggle('tools', group.name)} />
            <span>{group.name}<small>{group.description}</small></span>
          </label>
        ))}
      </div>
      <h2>Skills</h2>
      {catalog.skills.length === 0 ? <div className="muted">No skills in the library yet.</div> : (
        <div className="check-grid">
          {catalog.skills.map((skill) => (
            <label key={skill.name} className="check"><input type="checkbox" checked={draft.grants.skills.includes(skill.name)} onChange={() => toggle('skills', skill.name)} /><span>{skill.name}<small>{skill.description}</small></span></label>
          ))}
        </div>
      )}
      <h2>Recipients</h2>
      {chief ? <div className="muted">Mr. Robot can message every Robot you can reach.</div> : catalog.robots.length === 0 ? <div className="muted">No other Robots to message.</div> : (
        <div className="check-grid">
          {catalog.robots.map((robot) => (
            <label key={robot.id} className="check"><input type="checkbox" checked={draft.grants.recipients.includes(robot.id)} onChange={() => toggle('recipients', robot.id)} /><span>{robot.name}</span></label>
          ))}
        </div>
      )}
      <h2>Secrets</h2>
      {catalog.secrets.length === 0 ? <div className="muted">No secrets in your vault.</div> : (
        <div className="check-grid">
          {catalog.secrets.map((secret) => (
            <label key={secret.name} className="check"><input type="checkbox" checked={draft.grants.secrets.includes(secret.name)} onChange={() => toggle('secrets', secret.name)} /><span>{secret.name}<small>{secret.scope === 'home' ? 'shared with the Home' : 'yours'}</small></span></label>
          ))}
        </div>
      )}

      <h2>Sharing and limits</h2>
      {chief ? null : (
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
        {chief ? null : <button type="button" className="button button-danger" onClick={onDelete}>Delete</button>}
        <span className="spacer" />
        <button type="button" className="button button-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
