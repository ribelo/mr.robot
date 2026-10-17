import { useEffect, useState, type ReactNode } from 'react'
import { useAtomValue } from '@effect/atom-react'
import type { Identity, RobotPanel, TaskView } from '@mr-robot/protocol'
import { keys, panelAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { renderResult } from './AtomView.tsx'
import { Avatar } from './Avatar.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { SaveButton } from './SaveButton.tsx'
import { TaskList } from './TaskSheets.tsx'

/** Edit profile (robot-lulc, reference 09): avatar, name, title, description, notifications, Tasks. */
export function EditProfileSheet({ robotId, onClose, onOpenTask }: {
  robotId: string
  onClose: () => void
  onOpenTask: (task: TaskView) => void
}) {
  const result = useAtomValue(panelAtom(robotId))
  return <>{renderResult(result, {}, (panel) => <ProfileForm robotId={robotId} panel={panel} onClose={onClose} onOpenTask={onOpenTask} />)}</>
}

function ProfileForm({ robotId, panel, onClose, onOpenTask }: { robotId: string; panel: RobotPanel; onClose: () => void; onOpenTask: (task: TaskView) => void }) {
  const command = useCommand()
  const [identity, setIdentity] = useState<Identity>(panel.settings.identity)
  const [notify, setNotify] = useState(panel.settings.notifications.enabled)
  const [watch, setWatch] = useState(panel.settings.wakeOnScreenNotifications)
  const [discord, setDiscord] = useState((panel.settings.discordChannel ?? '') !== '')
  const [discordChannel, setDiscordChannel] = useState(panel.settings.discordChannel ?? '')
  const [discordProactive, setDiscordProactive] = useState(panel.settings.discordProactive)
  const [error, setError] = useState<string>()
  // A saved profile closes the sheet; a failure stays and shows below.
  const save = async () => {
    const failure = exitFailure(await command((api) => api.updateSettings(robotId, {
      identity,
      notifications: { ...panel.settings.notifications, enabled: notify },
      wakeOnScreenNotifications: watch,
      discordChannel: discord && discordChannel.trim() !== '' ? discordChannel.trim() : null,
      discordProactive,
    }), [keys.robot(robotId), keys.robots]))
    setError(failure)
    if (failure === undefined) onClose()
    return failure === undefined
  }
  const editable = panel.canEdit
  return (
    <Sheet onClose={onClose} footer={editable ? <SaveButton onSave={save} disabled={identity.name.trim() === ''} /> : null}>
      <div className="sheet-avatar"><Avatar seed={identity.avatarSeed} color={identity.avatarColor} size={96} /></div>
      {editable ? (
        <>
          {/* A new seed shows at once; it is kept only when the profile is saved (ux-h0s4). */}
          <div className="sheet-avatar"><button type="button" className="button" onClick={() => setIdentity({ ...identity, avatarSeed: newAvatarSeed() })}>Another look</button></div>
          <ColorPicker value={identity.avatarColor} onChange={(color) => setIdentity({ ...identity, avatarColor: color })} />
        </>
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
          <div className="muted">Messages in its channel wake it, and its answer goes back to Discord as a reply to your message. Questions asked in the app are answered in the app. Direct messages to the bot reach Mr. Robot. Needs the Discord bot (your name → Connections).</div>
        </div>
        <button type="button" role="switch" aria-checked={discord} aria-label="Talk on Discord" disabled={!editable} className={discord ? 'switch on' : 'switch'} onClick={() => setDiscord(!discord)}><span /></button>
      </div>
      {discord ? <label>Discord channel ID<input value={discordChannel} disabled={!editable} placeholder="Right-click the channel → Copy Channel ID" onChange={(event) => setDiscordChannel(event.target.value)} /></label> : null}
      {discord ? (
        <div className="toggle-card">
          <div>
            <div>Also send its own messages here</div>
            <div className="muted">Task results and notifications go to this channel too. Replies to Discord messages always go back to Discord.</div>
          </div>
          <button type="button" role="switch" aria-checked={discordProactive} aria-label="Also send its own messages to Discord" disabled={!editable} className={discordProactive ? 'switch on' : 'switch'} onClick={() => setDiscordProactive(!discordProactive)}><span /></button>
        </div>
      ) : null}
      <h3 className="panel-section">Tasks</h3>
      <TaskList tasks={panel.tasks} onOpen={onOpenTask} />
      {error === undefined ? null : <div className="muted">{error}</div>}
    </Sheet>
  )
}

/** A random seed for a Robot's generated avatar. */
function newAvatarSeed(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function Sheet({ title, onClose, onBack, footer, children }: { title?: string; onClose: () => void; onBack?: () => void; footer?: ReactNode; children: ReactNode }) {
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
