import { Loading } from './States.tsx'
import { ConfirmByName } from './ConfirmByName.tsx'
import { CLEAR_GOES, CLEAR_STAYS, START_OVER_GOES, START_OVER_STAYS } from './danger-words.ts'
import { useState, useEffect } from 'react'
import { effectiveSpendLimit, spendLimitText, capabilityItems, GRANT_LEVELS, hostHeading, hostsOf, type CapabilityField, type CapabilityItem, type GrantField, type GrantLevel, type GrantLevels, type RobotPanel, type SettingsCatalog, type SettingsPatch, type BrowserBackend } from '@mr-robot/protocol'
import { ChainEditor } from './ChainEditor.tsx'
import { ReviewerSetting } from './ReviewerSetting.tsx'
import { SubagentModels } from './SubagentModels.tsx'
import { SaveButton, type SaveOutcome } from './SaveButton.tsx'
import { parseRobotSpendLimit, SpendLimitChoice, spendLimitDraft } from './SpendLimitChoice.tsx'
import * as Option from 'effect/Option'
import type * as Exit from 'effect/Exit'
import { keys, promptAtom, useCommand, webhookAtom } from '../client/api-atoms.ts'
import type { ApiFailure } from '../client/api-failure.ts'
import { renderResult } from './AtomView.tsx'
import { go } from '../route.ts'
import { useAtomValue } from '@effect/atom-react'

export interface AdvancedSettingsProps {
  readonly panel: RobotPanel
  readonly catalog: SettingsCatalog
  readonly onSave: (patch: SettingsPatch) => Promise<SaveOutcome>
  readonly onPause: () => void
  readonly onResume: () => void
  readonly onDelete: (confirm: string) => Promise<Exit.Exit<void, ApiFailure>>
  readonly onClear: (confirm: string) => Promise<Exit.Exit<void, ApiFailure>>
  readonly onStartOver: (confirm: string) => Promise<Exit.Exit<void, ApiFailure>>
}


/**
 * What the Robot was given (robot-vqtw): model and effort, context budget, code mode,
 * compaction instruction, Grants, sharing, notifications and spend limit.
 */
export function AdvancedSettings({ panel, catalog, onSave, onPause, onResume, onDelete, onClear, onStartOver }: AdvancedSettingsProps) {
  const settings = panel.settings
  const [danger, setDanger] = useState<'delete' | 'clear' | 'start-over'>()
  const name = panel.summary.identity.name
  const [draft, setDraft] = useState(settings)
  const [limitDraft, setLimitDraft] = useState(spendLimitDraft(settings.spendLimit))
  const spendLimit = parseRobotSpendLimit(limitDraft)
  const model = catalog.models.find((option) => option.provider === draft.model.provider && option.model === draft.model.model)
  const maxBudget = model?.contextWindow ?? 1_000_000
  const setLevel = (field: GrantField, name: string, level: GrantLevel) => setDraft({ ...draft, grants: { ...draft.grants, [field]: { ...draft.grants[field], [name]: level } } })
  // The same list my_capabilities and the prompt's runtime section are built from (sk-ixvp).
  const capabilities = capabilityItems(catalog, draft.grants)
  const of = (field: CapabilityField) => capabilities.filter((entry) => entry.field === field)
  /** One grant item's three-state control (sk-746n). */
  const item = (entry: CapabilityItem) => (
    <GrantItem key={`${entry.field}:${entry.name}`} label={entry.label} shown={entry.field === 'hosts' ? entry.facet : entry.label} detail={entry.description} level={entry.level} onChange={(level) => setLevel(entry.field, entry.name, level)} />
  )
  const hostItems = of('hosts')
  const save = async () => {
    // An amount that is not whole dollars of at least 1 is shown under its field and not sent.
    if (Option.isNone(spendLimit)) return false
    return onSave({
      chain: draft.chain,
      contextBudget: draft.contextBudget,
      codeMode: draft.codeMode,
      browserBackend: draft.browserBackend,
      compactionInstruction: draft.compactionInstruction,
      cacheWarming: draft.cacheWarming,
      idleCompaction: draft.idleCompaction,
      idleCompactionFloorTokens: draft.idleCompactionFloorTokens,
      autoReview: draft.autoReview,
      reviewer: draft.reviewer,
      subagentModels: draft.subagentModels,
      grants: draft.grants,
      sharing: draft.sharing,
      notifications: draft.notifications,
      spendLimit: spendLimit.value,
    })
  }
  const mrRobot = panel.summary.kind === 'mr-robot'
  return (
    <div className="form">
      <h2>Model chain</h2>
      <ChainEditor chain={draft.chain} models={catalog.models} unavailable={catalog.unavailableModels ?? []} accounts={catalog.accounts ?? []} workersAiEnabled={catalog.workersAiEnabled}
        onChange={(chain) => setDraft({ ...draft, chain, model: { provider: chain[0]!.provider, model: chain[0]!.model, effort: chain[0]!.effort } })} />
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

      <h2>While idle</h2>
      <div className="muted">Nothing happens during a Turn or while work waits; a new message cancels it.</div>
      <label className="check"><input type="checkbox" checked={draft.cacheWarming} onChange={(event) => setDraft({ ...draft, cacheWarming: event.target.checked })} />
        <span>Cache warming<small>Refresh the model's prompt cache at 54, 108 and 162 minutes of idle, so the next message is cheap. Only for models with a known cache window (Claude).</small></span>
      </label>
      <label className="check"><input type="checkbox" checked={draft.idleCompaction} onChange={(event) => setDraft({ ...draft, idleCompaction: event.target.checked })} />
        <span>Idle compaction<small>Compact once, shortly before the cache expires, after a step to save memory; the next Wake-up starts from a short summary.</small></span>
      </label>
      <label>Compact only above (tokens)
        <input type="number" min={0} step={1000} value={draft.idleCompactionFloorTokens} onChange={(event) => setDraft({ ...draft, idleCompactionFloorTokens: Math.max(0, Number(event.target.value)) })} />
      </label>

      <h2>Auto review</h2>
      <label className="check"><input type="checkbox" checked={draft.autoReview} onChange={(event) => setDraft({ ...draft, autoReview: event.target.checked })} />
        <span>Auto review<small>Before each call of an item at allow, a reviewer model checks it. A call it denies becomes an Ask to you, with its reason. Items at ask keep asking you.</small></span>
      </label>
      <ReviewerSetting value={draft.reviewer} models={catalog.models} onChange={(reviewer) => setDraft({ ...draft, reviewer })}
        fallback={`Home default (${settings.homeReviewer === null ? "this Robot's own model" : (catalog.models.find((option) => option.provider === settings.homeReviewer!.provider && option.model === settings.homeReviewer!.model)?.label ?? settings.homeReviewer.model)})`} />

      <h2>Tools</h2>
      <div className="muted">Platform tools: one item per tool group. Allow: the Robot uses it freely. Ask: each use waits for your answer. Deny: the Robot does not have it.{mrRobot ? ' Mr. Robot holds everything you can reach at allow unless you lower it here.' : ''}</div>
      <div className="check-grid scroll-box">
        {of('tools').map(item)}
      </div>
      <SubagentModels value={draft.subagentModels} models={catalog.models} onChange={(subagentModels) => setDraft({ ...draft, subagentModels })} />
      <h2>Skills</h2>
      {catalog.skills.length === 0 ? <div className="muted">No skills in the library yet.</div> : (
        <div className="check-grid scroll-box">
          {of('skills').map(item)}
        </div>
      )}
      <h2>Recipients</h2>
      {mrRobot ? <div className="muted">Mr. Robot can message every Robot you can reach.</div> : catalog.robots.length === 0 ? <div className="muted">No other Robots to message.</div> : (
        <div className="check-grid">
          {of('recipients').map(item)}
        </div>
      )}
      <h2>Connections</h2>
      <div className="muted">Plugin tools: one item per connected account. Each Robot gets only the accounts you grant here.</div>
      {(catalog.connections ?? []).length === 0 ? <div className="muted">No connections yet: connect accounts under your name → Connections.</div> : (
        <div className="check-grid">
          {of('connections').map(item)}
        </div>
      )}
      <h2>Hosts</h2>
      <div className="muted">Computers that run the Mr. Robot app: yours and the ones shared with the Home. Grant files, shell and browser of each computer on their own.</div>
      {hostItems.length === 0 ? <div className="muted">No computers yet: install the Mr. Robot app on one and pair it (your name → Hosts).</div> : hostsOf(hostItems).map((host) => (
        <section key={host.id} className="host-grants" aria-label={host.name}>
          <h3 className="panel-section">{hostHeading(host)}</h3>
          <div className="check-grid">
            {hostItems.filter((entry) => entry.field === 'hosts' && entry.host.id === host.id).map(item)}
          </div>
        </section>
      ))}
      <h2>Logins</h2>
      {catalog.secrets.length === 0 ? <div className="muted">No logins yet: add them under your name → Logins.</div> : (
        <div className="check-grid">
          {of('secrets').map(item)}
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

      {panel.canEdit ? <WebhookSection id={panel.summary.id} /> : null}

      <PromptPreview id={panel.summary.id} />

      <h2>Sharing and limits</h2>
      {mrRobot ? null : (
        <label className="check"><input type="checkbox" checked={draft.sharing === 'home'} onChange={(event) => setDraft({ ...draft, sharing: event.target.checked ? 'home' : 'private' })} />
          <span>Shared with the Home<small>Other Members can talk to it and use it.</small></span>
        </label>
      )}
      <SpendLimitChoice label="Monthly spend limit" kinds={['home', 'none', 'usd']} draft={limitDraft} valid={Option.isSome(spendLimit)} onChange={setLimitDraft}
        note={Option.isSome(spendLimit) ? `In effect: ${spendLimitText(effectiveSpendLimit(spendLimit.value, settings.homeSpendLimit))}` : undefined} />

      <div className="question-actions">
        {panel.summary.status === 'paused'
          ? <button type="button" className="button" onClick={onResume}>Resume</button>
          : <button type="button" className="button" onClick={onPause}>Pause</button>}
        {panel.canEdit ? <button type="button" className="button button-danger" onClick={() => setDanger('clear')}>Clear history…</button> : null}
        {panel.canEdit ? <button type="button" className="button button-danger" onClick={() => setDanger('start-over')}>Start over…</button> : null}
        {mrRobot || !panel.canEdit ? null : <button type="button" className="button button-danger" onClick={() => setDanger('delete')}>Delete…</button>}
        <span className="spacer" />
        <span className="muted">Changes apply from the next Turn.</span>
        <SaveButton onSave={save} />
      </div>
      {danger === 'delete' ? (
        <ConfirmByName title={`Delete ${name}`} name={name} action="Delete robot"
          goes="The robot, its conversation, files and memory are deleted, and other robots stop being able to message it. Its open Tasks stay, without a doer."
          onCancel={() => setDanger(undefined)} onConfirm={() => onDelete(name)} />
      ) : danger === 'start-over' ? (
        <ConfirmByName title={`Start ${name} over`} name={name} action="Start over" goes={START_OVER_GOES} stays={START_OVER_STAYS}
          onCancel={() => setDanger(undefined)} onConfirm={async () => { const exit = await onStartOver(name); if (exit._tag === 'Success') setDanger(undefined); return exit }} />
      ) : danger === 'clear' ? (
        <ConfirmByName title={`Clear ${name}'s history`} name={name} action="Clear history" goes={CLEAR_GOES} stays={CLEAR_STAYS}
          onCancel={() => setDanger(undefined)} onConfirm={async () => { const exit = await onClear(name); if (exit._tag === 'Success') setDanger(undefined); return exit }} />
      ) : null}
    </div>
  )
}

/** The level an item holds: what the set names, deny when it names nothing. */
function levelIn(levels: GrantLevels, name: string): GrantLevel {
  return Object.hasOwn(levels, name) ? levels[name]! : 'deny'
}

/** A grant item with allow, ask and deny (sk-746n); `shown` is the visible text when a heading already names part of the label. */
export function GrantItem({ label, shown = label, detail, level, onChange }: { label: string; shown?: string; detail?: string; level: GrantLevel; onChange: (level: GrantLevel) => void }) {
  return (
    <div className="grant-item">
      <span>{shown}{detail === undefined || detail === '' ? null : <small>{detail}</small>}</span>
      <div className="segmented compact" role="radiogroup" aria-label={label}>
        {GRANT_LEVELS.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={level === option} className={level === option ? `segment active level-${option}` : 'segment'} onClick={() => onChange(option)}>{option}</button>
        ))}
      </div>
    </div>
  )
}

/** The webhook address and its key (cd-pqt8): anyone holding it can wake this Robot, so only the owner sees it. */
function WebhookSection({ id }: { id: string }) {
  const result = useAtomValue(webhookAtom(id))
  const command = useCommand()
  const [failure, setFailure] = useState<string>()
  const regenerate = async () => {
    const exit = await command((api) => api.regenerateWebhook(id), [keys.robot(id)])
    setFailure(exit._tag === 'Success' ? undefined : 'Could not regenerate the key.')
  }
  return (
    <>
      <h2>Webhook</h2>
      <div className="muted">POST JSON or text (up to 64 KB) to this address to wake the Robot. The key in it is the only credential: keep it secret. Add an Idempotency-Key header to make a retry harmless.</div>
      {renderResult(result, { what: 'the webhook' }, (hook) => (
        <>
          <label>Address
            <input readOnly aria-label="Webhook address" value={`${window.location.origin}${hook.path}`} onFocus={(event) => event.target.select()} />
          </label>
          <label>Key
            <input readOnly aria-label="Webhook key" value={hook.key} onFocus={(event) => event.target.select()} />
          </label>
          <div className="question-actions">
            <button type="button" className="button" onClick={() => void regenerate()}>Regenerate</button>
          </div>
          <div className="muted">Regenerating stops the old address working at once.</div>
          {failure === undefined ? null : <div className="muted">{failure}</div>}
        </>
      ))}
    </>
  )
}

/** What the model receives at the start of the next Turn (saved settings, not the draft). */
function PromptPreview({ id }: { id: string }) {
  const result = useAtomValue(promptAtom(id))
  return (
    <>
      <h2>Prompt</h2>
      <div className="muted">What the model is given at the start of each Turn, as saved. Secret values are masked. The Platform part is written by Mr. Robot itself and cannot be edited; to change how this Robot behaves and what it remembers, edit its files:</div>
      <div className="prompt-files">
        {['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'MEMORY.md'].map((file) => (
          <button key={file} type="button" className="button" onClick={() => go({ page: 'files', id, path: file })}>Edit {file}</button>
        ))}
        <button type="button" className="link" onClick={() => go({ page: 'profile' })}>Your USER.md and preferences</button>
      </div>
      {renderResult(result, { what: 'the prompt' }, (preview) => (
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
      ))}
    </>
  )
}