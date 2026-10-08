import { useEffect, useState, type ReactNode } from 'react'
import { useAtomValue } from '@effect/atom-react'
import type { Identity, RobotPanel, RoutineView } from '@mr-robot/protocol'
import { keys, panelAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { renderResult } from './AtomView.tsx'
import { Avatar } from './Avatar.tsx'
import { ClockIcon } from './ChatView.tsx'

const COLORS = ['#5ec4b6', '#f4a03a', '#6c63ff', '#8b5cf6', '#3b82f6', '#f97316', '#ef4444', '#10b981', '#ec4899']

/** Edit profile (robot-lulc, reference 09): avatar, name, title, description, notifications, Routines. */
export function EditProfileSheet({ robotId, onClose, onOpenRoutine }: {
  robotId: string
  onClose: () => void
  onOpenRoutine: (routine: RoutineView) => void
}) {
  const result = useAtomValue(panelAtom(robotId))
  return <>{renderResult(result, {}, (panel) => <ProfileForm robotId={robotId} panel={panel} onClose={onClose} onOpenRoutine={onOpenRoutine} />)}</>
}

function ProfileForm({ robotId, panel, onClose, onOpenRoutine }: { robotId: string; panel: RobotPanel; onClose: () => void; onOpenRoutine: (routine: RoutineView) => void }) {
  const command = useCommand()
  const [identity, setIdentity] = useState<Identity>(panel.settings.identity)
  const [notify, setNotify] = useState(panel.settings.notifications.enabled)
  const [watch, setWatch] = useState(panel.settings.wakeOnScreenNotifications)
  const [discord, setDiscord] = useState(panel.settings.notifications.channels.includes('discord'))
  const [discordChannel, setDiscordChannel] = useState(panel.settings.discordChannel ?? '')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    const failure = exitFailure(await command((api) => api.updateSettings(robotId, {
      identity,
      notifications: { ...panel.settings.notifications, enabled: notify, channels: [...panel.settings.notifications.channels.filter((channel) => channel !== 'discord'), ...(discord ? ['discord'] : [])] },
      wakeOnScreenNotifications: watch,
      discordChannel: discord && discordChannel.trim() !== '' ? discordChannel.trim() : null,
    }), [keys.robot(robotId), keys.robots]))
    if (failure === undefined) onClose()
    else {
      setError(failure)
      setSaving(false)
    }
  }
  const editable = panel.canEdit
  return (
    <Sheet onClose={onClose} footer={editable ? <button type="button" className="button button-primary" disabled={saving || identity.name.trim() === ''} onClick={() => void save()}>Save</button> : null}>
      <div className="sheet-avatar"><Avatar color={identity.avatarColor} size={72} /></div>
      {editable ? (
        <div className="color-row" role="radiogroup" aria-label="Avatar colour">
          {COLORS.map((color) => (
            <button key={color} type="button" role="radio" aria-checked={identity.avatarColor === color} aria-label={color} className={identity.avatarColor === color ? 'color-dot on' : 'color-dot'} style={{ background: color }} onClick={() => setIdentity({ ...identity, avatarColor: color })} />
          ))}
        </div>
      ) : null}
      <label>Name<input value={identity.name} disabled={!editable} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} /></label>
      <label>Title (optional)<input value={identity.title} disabled={!editable} onChange={(event) => setIdentity({ ...identity, title: event.target.value })} /></label>
      <label>Description<textarea rows={3} value={identity.description} disabled={!editable} onChange={(event) => setIdentity({ ...identity, description: event.target.value })} /></label>
      <div className="toggle-card">
        <div>
          <div>Wake on screen notifications</div>
          <div className="muted">Wake this Robot when an app on its screen shows a notification. Its browser stays open between Turns (Browser Rendering time is billed while it runs).</div>
        </div>
        <button type="button" role="switch" aria-checked={watch} aria-label="Wake on screen notifications" disabled={!editable} className={watch ? 'switch on' : 'switch'} onClick={() => setWatch(!watch)}><span /></button>
      </div>
      <div className="toggle-card">
        <div>
          <div>Notifications</div>
          <div className="muted">Get a push when this Robot finishes, needs you, or is blocked.</div>
        </div>
        <button type="button" role="switch" aria-checked={notify} aria-label="Notifications" disabled={!editable} className={notify ? 'switch on' : 'switch'} onClick={() => setNotify(!notify)}><span /></button>
      </div>
      <div className="toggle-card">
        <div>
          <div>Talk to this Robot on Discord</div>
          <div className="muted">Messages in its channel wake it, and its replies and notifications go there. Direct messages to the bot reach Mr. Robot. Needs the Discord bot (your name → Connections).</div>
        </div>
        <button type="button" role="switch" aria-checked={discord} aria-label="Talk on Discord" disabled={!editable} className={discord ? 'switch on' : 'switch'} onClick={() => setDiscord(!discord)}><span /></button>
      </div>
      {discord ? <label>Discord channel ID<input value={discordChannel} disabled={!editable} placeholder="Right-click the channel → Copy Channel ID" onChange={(event) => setDiscordChannel(event.target.value)} /></label> : null}
      <h3 className="panel-section">Routines</h3>
      <RoutineList routines={panel.routines} onOpen={onOpenRoutine} />
      {error === undefined ? null : <div className="muted">{error}</div>}
    </Sheet>
  )
}

export function RoutineList({ routines, onOpen }: { routines: readonly RoutineView[]; onOpen: (routine: RoutineView) => void }) {
  if (routines.length === 0) return <div className="muted">No routines.</div>
  return (
    <ul className="routine-cards">
      {routines.map((routine) => (
        <li key={routine.id}>
          <button type="button" className="routine-card" onClick={() => onOpen(routine)}>
            <span className="routine-icon"><ClockIcon /></span>
            <span className="routine-card-text">
              <span className="routine-name">{routine.name}</span>
              <span className="muted">{routine.summary}</span>
            </span>
            <span className={routine.paused ? 'routine-status paused' : 'routine-status'}>{routine.paused ? 'Paused' : 'Active'}</span>
            <span className="chevron">›</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Routine detail (robot-l3gr, robot-qhll, reference 08). */
export function RoutineSheet({ robotId, routineId, canEdit, onClose, onBack }: {
  robotId: string
  routineId: string
  canEdit: boolean
  onClose: () => void
  onBack?: () => void
}) {
  const result = useAtomValue(panelAtom(robotId))
  const command = useCommand()
  const [error, setError] = useState<string>()
  return <>{renderResult(result, { what: 'the routine' }, (panel) => {
    const routine = panel.routines.find((entry) => entry.id === routineId)
    if (routine === undefined) return <Sheet onClose={onClose}><div className="muted">This Routine no longer exists.</div></Sheet>
    const act = async (run: Parameters<typeof command>[0], closeAfter = false) => {
      const failure = exitFailure(await command(run, [keys.robot(robotId), keys.admin]))
      setError(failure)
      if (failure === undefined && closeAfter) (onBack ?? onClose)()
    }
    return <RoutineDetail routine={routine} canEdit={canEdit} onClose={onClose} {...(onBack === undefined ? {} : { onBack })} error={error}
      onDelete={() => void act((api) => api.deleteRoutine(robotId, routine.id), true)}
      onTogglePause={() => void act((api) => api.pauseRoutine(robotId, routine.id, !routine.paused))} />
  })}</>
}

function RoutineDetail({ routine, canEdit, onClose, onBack, error, onDelete, onTogglePause }: { routine: RoutineView; canEdit: boolean; onClose: () => void; onBack?: () => void; error: string | undefined; onDelete: () => void; onTogglePause: () => void }) {
  return (
    <Sheet
      title={routine.name}
      onClose={onClose}
      {...(onBack === undefined ? {} : { onBack })}
      footer={canEdit ? (
        <>
          <ConfirmButton label="Delete" confirm="Delete for good" onConfirm={onDelete} />
          <span className="spacer" />
          <button type="button" className="button" onClick={onTogglePause}>{routine.paused ? 'Resume' : 'Pause'}</button>
        </>
      ) : null}
    >
      <dl className="detail-rows">
        <div><dt>Schedule</dt><dd>{routine.summary}{routine.cron === null ? null : <div className="mono muted">{routine.cron}</div>}</dd></div>
        <div><dt>Status</dt><dd><span className={routine.paused ? 'status-dot paused' : 'status-dot'} /> {routine.paused ? 'Paused' : 'Active'}</dd></div>
        <div><dt>Next run</dt><dd>{routine.nextRun === null ? '—' : new Date(routine.nextRun).toLocaleString()}</dd></div>
      </dl>
      <h3 className="panel-section">Instructions</h3>
      <div className="detail-block">{routine.prompt}</div>
      <h3 className="panel-section">Recent runs</h3>
      {routine.runs.length === 0 ? <div className="detail-block muted">No runs yet</div> : (
        <ul className="detail-block runs">
          {routine.runs.map((run) => (
            <li key={run.at}>
              <span className={`run-${run.outcome}`}>{run.outcome === 'done' ? '✓' : run.outcome === 'failed' ? '✕' : '…'}</span>
              <span className="muted">{new Date(run.at).toLocaleString()}</span>
              <span>{run.summary}</span>
            </li>
          ))}
        </ul>
      )}
      {error === undefined ? null : <div className="muted">{error}</div>}
    </Sheet>
  )
}

function Sheet({ title, onClose, onBack, footer, children }: { title?: string; onClose: () => void; onBack?: () => void; footer?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet form" role="dialog" aria-label={title ?? 'Edit profile'} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          {onBack === undefined ? <span /> : <button type="button" className="icon-button" aria-label="Back" onClick={onBack}>‹</button>}
          <span className="sheet-title">{title ?? ''}</span>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer === null || footer === undefined ? null : <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** A destructive action asked twice in place, without a browser dialog. */
export function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  return armed
    ? <button type="button" className="button button-danger" onClick={onConfirm}>{confirm}</button>
    : <button type="button" className="link danger" onClick={() => setArmed(true)}>{label}</button>
}
