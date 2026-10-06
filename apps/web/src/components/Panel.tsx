import type { RobotPanel } from '@mr-robot/protocol'
import { RoutineList } from './RobotSheets.tsx'

export interface PanelProps {
  readonly panel: RobotPanel
  readonly onOpenRoutine: (id: string) => void
  readonly onEditProfile: () => void
  readonly onOpenScreen: () => void
  readonly onAdvanced: () => void
  readonly onTrajectory: () => void
  readonly onClose: () => void
}

/** The robot panel (robot-z3ud): screen thumbnail, Routines, simple settings. */
export function Panel({ panel, onOpenRoutine, onEditProfile, onOpenScreen, onAdvanced, onTrajectory, onClose }: PanelProps) {
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
          <button type="button" className="screen" onClick={onOpenScreen} aria-label={`${name}'s screen`} disabled={panel.screen === null && panel.takeover === null}>
            {panel.screen === null ? <span className="screen-empty">No screen yet</span> : <img src={panel.screen.url} alt="" />}
          </button>
          <div className="screen-caption">{name}’s screen</div>
          <h3 className="panel-section">Routines</h3>
          <RoutineList routines={panel.routines} onOpen={(routine) => onOpenRoutine(routine.id)} />
          <div className="panel-links">
            <button type="button" className="link" onClick={onTrajectory}>Trajectory</button>
            {panel.canEdit ? <button type="button" className="link" onClick={onAdvanced}>Advanced settings</button> : null}
          </div>
          <div className="usage muted">
            {panel.usage.month}: {formatTokens(panel.usage.inputTokens + panel.usage.outputTokens)} tokens · ${panel.usage.costUsd.toFixed(2)}
            {panel.usage.limitUsd === null ? '' : ` of $${panel.usage.limitUsd.toFixed(2)}`}
          </div>
      </div>
    </aside>
  )
}

function formatTokens(count: number): string {
  return count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}
