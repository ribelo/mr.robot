import type { RobotPanel } from '@mr-robot/protocol'
import { RoutineList } from './RobotSheets.tsx'
import { ThreadCard } from './ChatView.tsx'

export interface PanelProps {
  readonly panel: RobotPanel
  readonly onOpenRoutine: (id: string) => void
  readonly onEditProfile: () => void
  readonly onOpenScreen: () => void
  readonly onAdvanced: () => void
  readonly onTrajectory: () => void
  readonly onFiles: () => void
  readonly onClose: () => void
  /** Show the card of an open request for help in the Conversation. */
  readonly onOpenHelp?: (requestId: string) => void
  /** The time the ages are counted from; the clock when left out. */
  readonly now?: number
}

/** The robot panel (robot-z3ud): screen thumbnail, Routines, simple settings. */
export function Panel({ panel, onOpenRoutine, onEditProfile, onOpenScreen, onAdvanced, onTrajectory, onFiles, onClose, onOpenHelp, now = Date.now() }: PanelProps) {
  const name = panel.summary.identity.name
  return (
    <aside className="panel">
      <div className="panel-head">
        <span />
        <span className="panel-title" />
        <span className="panel-head-actions">
          {panel.canEdit ? <button type="button" className="icon-button" aria-label="Edit profile" onClick={onEditProfile}>⚙</button> : null}
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </span>
      </div>
      <div className="panel-body">
          {panel.takeover === null ? null : (
            <div className="question">
              <div className="question-title">Needs you in its browser</div>
              <div className="question-purpose">{panel.takeover.reason}</div>
              <div className="question-actions"><button type="button" className="button button-primary" onClick={onOpenScreen}>Take over</button></div>
            </div>
          )}
          {panel.help === undefined || panel.help.length === 0 ? null : (
            <>
              <h3 className="panel-section">Needs help</h3>
              <ul className="help-list">
                {panel.help.map((request) => (
                  <li key={request.id}>
                    <button type="button" className="help-open" onClick={() => onOpenHelp?.(request.id)}>
                      <span className="help-open-text">{request.text}</span>
                      <span className="help-open-meta muted">{[ageText(now - request.created), request.urgent ? 'urgent' : null, request.escalated ? 'Mr. Robot asked' : 'Mr. Robot not asked yet'].filter((part) => part !== null).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className="screen" onClick={onOpenScreen} aria-label={`${name}'s screen`}>
            {panel.screen === null ? <span className="screen-empty">Open the browser</span> : <img src={panel.screen.url} alt="" />}
          </button>
          <div className="screen-caption">{name}’s screen</div>
          <h3 className="panel-section">Routines</h3>
          <RoutineList routines={panel.routines} onOpen={(routine) => onOpenRoutine(routine.id)} />
          {panel.threads === undefined ? null : (
            <>
              <h3 className="panel-section">Threads</h3>
              {panel.threads.length === 0 ? <div className="muted">No Threads.</div> : <ul className="thread-list">{panel.threads.map((thread) => <li key={thread.id}><ThreadCard thread={thread} /></li>)}</ul>}
            </>
          )}
          <div className="panel-links">
            <button type="button" className="link" onClick={onFiles}>Files</button>
            <button type="button" className="link" onClick={onTrajectory}>Trajectory</button>
            {panel.canEdit ? <button type="button" className="link" onClick={onAdvanced}>Advanced settings</button> : null}
          </div>
          <div className="usage muted">
            {panel.usage.month}: {formatTokens(panel.usage.inputTokens + panel.usage.outputTokens)} tokens{(panel.usage.browser ?? []).map((row) => ` · ${row.minutes} browser min (${BACKEND_LABELS[row.backend] ?? (row.backend.startsWith('host:') ? 'host browser' : row.backend)})`).join('')}{(panel.usage.services ?? []).map((row) => ` · ${row.calls} ${row.service === 'exa' ? 'Exa' : row.service} calls`).join('')} · ${panel.usage.costUsd.toFixed(2)}
            {panel.usage.limitUsd === null ? '' : ` of $${panel.usage.limitUsd.toFixed(2)}`}
          </div>
      </div>
    </aside>
  )
}

/** How long ago, in the largest whole unit: "just now", "12 min ago", "3 h ago", "2 d ago". */
export function ageText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 60 * 24 ? `${Math.floor(minutes / 60)} h ago` : `${Math.floor(minutes / (60 * 24))} d ago`
}

const BACKEND_LABELS: Record<string, string> = { 'browser-run': 'Browser Run', container: 'Container Chrome', 'container-vpn': 'Container Chrome via VPN' }

function formatTokens(count: number): string {
  return count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}
