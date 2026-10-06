import { useCallback, useEffect, useState } from 'react'
import type { Me, RobotPanel, RobotSummary, SettingsCatalog, Trajectory } from '@mr-robot/protocol'
import { api, ApiError } from './api.ts'
import { useLive } from './live.ts'
import { go, type Route } from './route.ts'
import { AdvancedSettings } from './components/AdvancedSettings.tsx'
import { Profile } from './components/Profile.tsx'
import { Admin } from './components/Admin.tsx'
import { Takeover } from './components/Takeover.tsx'
import { TrajectoryView } from './components/TrajectoryView.tsx'

/** Full-page views reached from a Robot or the sidebar. */
export function Pages({ route, me, robots, onChanged }: { route: Route; me: Me; robots: readonly RobotSummary[]; onChanged: () => void }) {
  switch (route.page) {
    case 'trajectory': return <TrajectoryPage id={route.id} robot={robots.find((robot) => robot.id === route.id)} me={me} onChanged={onChanged} />
    case 'advanced': return <AdvancedPage id={route.id} onChanged={onChanged} />
    case 'admin': return (
      <div className="page">
        <PageHead title="Admin" back={{ page: 'home' }} />
        {me.role === 'admin' ? <Admin /> : <div className="muted">Only the Home admin sees this page.</div>}
      </div>
    )
    case 'takeover': return <TakeoverPage id={route.id} robot={robots.find((robot) => robot.id === route.id)} />
    case 'profile': return (
      <div className="page">
        <PageHead title={me.name} back={{ page: 'home' }} />
        <Profile me={me} onChanged={onChanged} />
      </div>
    )
    default: return <div className="empty-main">{route.page}</div>
  }
}

function PageHead({ title, back }: { title: string; back: Route }) {
  return (
    <h1>
      <button type="button" className="icon-button" aria-label="Back" onClick={() => go(back)}>‹</button>
      {title}
    </h1>
  )
}

function TrajectoryPage({ id, robot, me, onChanged }: { id: string; robot: RobotSummary | undefined; me: Me; onChanged: () => void }) {
  const [trajectory, setTrajectory] = useState<Trajectory>()
  const refresh = useCallback(() => api.trajectory(id).then(setTrajectory), [id])
  useEffect(() => { void refresh() }, [refresh])
  useLive(id, () => void refresh())
  const act = async (run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (cause) {
      alert(cause instanceof ApiError ? cause.message : 'failed')
    }
    await refresh()
    onChanged()
  }
  return (
    <div className="page">
      <PageHead title={`${robot?.identity.name ?? 'Robot'} · Trajectory`} back={{ page: 'robot', id, panel: true }} />
      {trajectory === undefined ? <div className="muted">Loading…</div> : (
        <TrajectoryView
          trajectory={trajectory}
          canRewind={robot?.ownerId === me.id}
          onRewind={(atSeq) => {
            if (confirm('Rewind the Conversation to this point? The current log stays in the archive and you can undo.')) void act(() => api.rewind(id, atSeq))
          }}
          onUndo={(rewind) => void act(() => api.undoRewind(id, rewind.id))}
        />
      )}
    </div>
  )
}
function AdvancedPage({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [state, setState] = useState<{ panel: RobotPanel; catalog: SettingsCatalog }>()
  const [message, setMessage] = useState<string>()
  const refresh = useCallback(async () => {
    const [panel, catalog] = await Promise.all([api.panel(id), api.catalog(id)])
    setState({ panel, catalog })
  }, [id])
  useEffect(() => { void refresh() }, [refresh])
  const act = async (run: () => Promise<unknown>, done?: string) => {
    try {
      await run()
      setMessage(done)
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'failed')
    }
    await refresh().catch(() => undefined)
    onChanged()
  }
  return (
    <div className="page">
      <PageHead title={`${state?.panel.summary.identity.name ?? 'Robot'} · Advanced settings`} back={{ page: 'robot', id, panel: true }} />
      {message === undefined ? null : <div className="muted">{message}</div>}
      {state === undefined ? <div className="muted">Loading…</div> : (
        <AdvancedSettings
          key={JSON.stringify(state.panel.settings)}
          panel={state.panel}
          catalog={state.catalog}
          onSave={(patch) => act(() => api.updateSettings(id, patch), 'Saved. Changes apply from the next Turn.')}
          onPause={() => void act(() => api.pause(id), 'Paused.')}
          onResume={() => void act(() => api.resume(id), 'Resumed.')}
          onDelete={() => {
            if (confirm('Delete this Robot? Its Conversation and Workspace stay in the archive.')) void act(() => api.remove(id)).then(() => go({ page: 'home' }))
          }}
        />
      )}
    </div>
  )
}
function TakeoverPage({ id, robot }: { id: string; robot: RobotSummary | undefined }) {
  const [panel, setPanel] = useState<RobotPanel>()
  useEffect(() => { void api.panel(id).then(setPanel) }, [id])
  if (panel === undefined) return <div className="empty-main">Loading…</div>
  return (
    <Takeover
      robotId={id}
      robotName={robot?.identity.name ?? panel.summary.identity.name}
      requested={panel.takeover === null || !panel.canEdit ? null : { reason: panel.takeover.reason }}
      onClose={() => go({ page: 'robot', id, panel: true })}
    />
  )
}
