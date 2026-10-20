import type { BoxView, RobotPanel } from '@mr-robot/protocol'
import { TaskList } from './TaskSheets.tsx'
import { ThreadCard } from './ChatView.tsx'
import { CostBreakdownView } from './CostBreakdown.tsx'

export interface PanelProps {
  readonly panel: RobotPanel
  readonly onOpenTask: (id: string) => void
  readonly onEditProfile: () => void
  readonly onOpenScreen: () => void
  readonly onAdvanced: () => void
  readonly onTrajectory: () => void
  readonly onFiles: () => void
  readonly onClose: () => void
  /** Show the card of an open request for help in the Conversation. */
  readonly onOpenHelp?: (requestId: string) => void
  /** Stop the Robot's Box (ao-9q18). */
  readonly onStopBox?: () => void
  /** The time the ages are counted from; the clock when left out. */
  readonly now?: number
}

/** The robot panel (robot-z3ud): screen thumbnail, Tasks, simple settings. */
export function Panel({ panel, onOpenTask, onEditProfile, onOpenScreen, onAdvanced, onTrajectory, onFiles, onClose, onOpenHelp, onStopBox, now = Date.now() }: PanelProps) {
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
          <h3 className="panel-section">Tasks</h3>
          <TaskList tasks={panel.tasks} onOpen={(task) => onOpenTask(task.id)} />
          {panel.threads === undefined ? null : (
            <>
              <h3 className="panel-section">Threads</h3>
              {panel.threads.length === 0 ? <div className="muted">No Threads.</div> : <ul className="thread-list">{panel.threads.map((thread) => <li key={thread.id}><ThreadCard thread={thread} /></li>)}</ul>}
            </>
          )}
          {panel.box === undefined ? null : <BoxSection box={panel.box} {...(onStopBox === undefined ? {} : { onStop: onStopBox })} />}
          <div className="panel-links">
            <button type="button" className="link" onClick={onFiles}>Files</button>
            <button type="button" className="link" onClick={onTrajectory}>Trajectory</button>
            {panel.canEdit ? <button type="button" className="link" onClick={onAdvanced}>Advanced settings</button> : null}
          </div>
          <div className="usage muted">
            {panel.usage.month}: {formatTokens(panel.usage.inputTokens + panel.usage.outputTokens)} tokens{(panel.usage.browser ?? []).map((row) => ` · ${row.minutes} browser min (${BACKEND_LABELS[row.backend] ?? (row.backend.startsWith('host:') ? 'host browser' : row.backend)})`).join('')}{(panel.usage.services ?? []).map((row) => ` · ${row.calls} ${row.service === 'exa' ? 'Exa' : row.service} calls`).join('')}{panel.usage.boxMinutes === undefined ? '' : ` · ${panel.usage.boxMinutes} Box min`} · ${panel.usage.costUsd.toFixed(2)}
            {panel.usage.limit.limit.kind === 'usd' ? ` of $${panel.usage.limit.limit.amount.toFixed(2)}` : ''}
          </div>
          <CostBreakdownView breakdown={panel.usage.breakdown} label={`Cost in ${panel.usage.month}`} />
      </div>
    </aside>
  )
}

const BOX_STATES: Record<BoxView['state'], string> = { off: 'Off', booting: 'Booting', running: 'Running', stopping: 'Stopping' }

/** The Robot's Box (ao-9q18): its state, since when, and Stop while it is on. */
function BoxSection({ box, onStop }: { box: BoxView; onStop?: () => void }) {
  return (
    <section aria-label="Box">
      <h3 className="panel-section">Box</h3>
      <div className="box-state">
        <span>{BOX_STATES[box.state]}{box.since === null ? '' : ` · since ${new Date(box.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span>
        {box.state === 'off' || onStop === undefined ? null : <button type="button" className="button" disabled={box.state === 'stopping'} onClick={onStop}>Stop</button>}
      </div>
      <div className="muted">Stops by itself ten minutes after its last command; box/ in the Workspace is kept.</div>
    </section>
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
