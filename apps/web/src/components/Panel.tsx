import { useEffect, useState } from 'react'
import type { Identity, RobotPanel } from '@mr-robot/protocol'
import { ClockIcon } from './ChatView.tsx'
import { Avatar } from './Avatar.tsx'

export interface PanelProps {
  readonly panel: RobotPanel
  readonly onDeleteRoutine: (id: string) => void
  readonly onSave: (patch: { identity?: Identity; notifications?: RobotPanel['settings']['notifications'] }) => void
  readonly onOpenScreen: () => void
  readonly onAdvanced: () => void
  readonly onTrajectory: () => void
  readonly onClose: () => void
}

/** The robot panel (robot-z3ud): screen thumbnail, Routines, simple settings. */
export function Panel({ panel, onDeleteRoutine, onSave, onOpenScreen, onAdvanced, onTrajectory, onClose }: PanelProps) {
  const [view, setView] = useState<'overview' | 'settings'>('overview')
  const name = panel.summary.identity.name
  return (
    <aside className="panel">
      <div className="panel-head">
        {view === 'settings' ? <button type="button" className="icon-button" aria-label="Back" onClick={() => setView('overview')}>‹</button> : <span />}
        <span className="panel-title">{view === 'settings' ? 'Settings' : ''}</span>
        <span className="panel-head-actions">
          {view === 'overview' && panel.canEdit ? <button type="button" className="icon-button" aria-label="Settings" onClick={() => setView('settings')}>⚙</button> : null}
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </span>
      </div>
      {view === 'overview' ? (
        <div className="panel-body">
          {panel.takeover === null ? null : (
            <div className="question">
              <div className="question-title">Needs you in its browser</div>
              <div className="question-purpose">{panel.takeover.reason}</div>
              <div className="question-actions"><button type="button" className="button button-primary" onClick={onOpenScreen}>Take over</button></div>
            </div>
          )}
          <button type="button" className="screen" onClick={onOpenScreen} aria-label={`${name}'s screen`} disabled={panel.screen === null && panel.takeover === null}>
            {panel.screen === null ? <span className="screen-empty">No screen yet</span> : <img src={panel.screen.url} alt="" />}
          </button>
          <div className="screen-caption">{name}’s screen</div>
          <h3 className="panel-section">Routines</h3>
          {panel.routines.length === 0 ? <div className="muted">No routines.</div> : null}
          <ul className="routines">
            {panel.routines.map((routine) => (
              <li key={routine.id} className="routine">
                <ClockIcon />
                <span className="routine-name">{routine.name}</span>
                <span className="routine-when" title={routine.nextRun === null ? '' : new Date(routine.nextRun).toLocaleString()}>{routine.summary}</span>
                {panel.canEdit ? <button type="button" className="icon-button small" aria-label={`Delete ${routine.name}`} onClick={() => onDeleteRoutine(routine.id)}>×</button> : null}
              </li>
            ))}
          </ul>
          <div className="panel-links">
            <button type="button" className="link" onClick={onTrajectory}>Trajectory</button>
            {panel.canEdit ? <button type="button" className="link" onClick={onAdvanced}>Advanced settings</button> : null}
          </div>
          <div className="usage muted">
            {panel.usage.month}: {formatTokens(panel.usage.inputTokens + panel.usage.outputTokens)} tokens · ${panel.usage.costUsd.toFixed(2)}
            {panel.usage.limitUsd === null ? '' : ` of $${panel.usage.limitUsd.toFixed(2)}`}
          </div>
        </div>
      ) : <SimpleSettings panel={panel} onSave={onSave} />}
    </aside>
  )
}

function SimpleSettings({ panel, onSave }: { panel: RobotPanel; onSave: PanelProps['onSave'] }) {
  const [identity, setIdentity] = useState(panel.settings.identity)
  useEffect(() => setIdentity(panel.settings.identity), [panel.settings.identity])
  const notifications = panel.settings.notifications
  const save = () => onSave({ identity })
  return (
    <div className="panel-body settings">
      <div className="settings-avatar"><Avatar color={identity.avatarColor} size={64} /></div>
      <label>Name<input value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} onBlur={save} /></label>
      <label>Title (optional)<input value={identity.title} onChange={(event) => setIdentity({ ...identity, title: event.target.value })} onBlur={save} /></label>
      <label>Description<textarea rows={5} value={identity.description} onChange={(event) => setIdentity({ ...identity, description: event.target.value })} onBlur={save} /></label>
      <label>Avatar colour<input type="color" value={identity.avatarColor} onChange={(event) => { const next = { ...identity, avatarColor: event.target.value }; setIdentity(next); onSave({ identity: next }) }} /></label>
      <div className="toggle-card">
        <div>
          <div>Notifications</div>
          <div className="muted">Get notified when this robot finishes or needs input</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={notifications.enabled}
          aria-label="Notifications"
          className={notifications.enabled ? 'switch on' : 'switch'}
          onClick={() => onSave({ notifications: { ...notifications, enabled: !notifications.enabled } })}
        ><span /></button>
      </div>
    </div>
  )
}

function formatTokens(count: number): string {
  return count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}
