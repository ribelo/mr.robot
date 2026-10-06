import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { Me, RobotPanel, RobotSummary, SettingsCatalog, Trajectory } from '@mr-robot/protocol'
import { api, ApiError } from './api.ts'
import { useLive } from './live.ts'
import { go, type Route } from './route.ts'
import { AdvancedSettings } from './components/AdvancedSettings.tsx'
import { Profile } from './components/Profile.tsx'
import { Admin } from './components/Admin.tsx'
import { Takeover } from './components/Takeover.tsx'
import { ConfirmButton } from './components/RobotSheets.tsx'

// The DSH trajectory (with its code highlighter) loads only when its page opens.
const RobotTrajectory = lazy(() => import('./dsh/RobotTrajectory.tsx').then((module) => ({ default: module.RobotTrajectory })))

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
  const [liveVersion, setLiveVersion] = useState(0)
  const [viewKey, setViewKey] = useState(0)
  const [rewinding, setRewinding] = useState(false)
  useLive(id, () => setLiveVersion((version) => version + 1))
  const canRewind = robot?.ownerId === me.id
  return (
    <div className="page page-wide">
      <PageHead title={`${robot?.identity.name ?? 'Robot'} · Trajectory`} back={{ page: 'robot', id, panel: true }} />
      {canRewind ? <div className="question-actions"><button type="button" className="button" onClick={() => setRewinding(true)}>Rewind…</button></div> : null}
      <Suspense fallback={<div className="muted">Loading the trajectory…</div>}>
        <RobotTrajectory key={viewKey} robotId={id} liveVersion={liveVersion} />
      </Suspense>
      {rewinding ? <RewindSheet id={id} onClose={() => setRewinding(false)} onDone={() => { setRewinding(false); setViewKey((key) => key + 1); onChanged() }} /> : null}
    </div>
  )
}

/** Rewind (robot-0q6a, robot-8v1t): back to before a Turn, or undo an earlier rewind. */
function RewindSheet({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [trajectory, setTrajectory] = useState<Trajectory>()
  const [error, setError] = useState<string>()
  useEffect(() => { void api.trajectory(id).then(setTrajectory) }, [id])
  const turns = useMemo(() => {
    const events = trajectory?.events ?? []
    return events.filter((event) => event.type === 'turn/start').map((start) => {
      const message = events.find((event) => event.seq > start.seq && event.type === 'user/message')
      let text = ''
      try {
        const data = JSON.parse(message?.data ?? '{}') as { content?: Array<{ type: string; text?: string }> }
        text = (data.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join(' ')
      } catch { /* not JSON */ }
      return { seq: start.seq, turn: start.turn, at: start.time, text: text.replace(/^\[[^\]]*\]\s*/, '').slice(0, 120) }
    }).reverse()
  }, [trajectory])
  const act = async (run: () => Promise<unknown>) => {
    try {
      await run()
      onDone()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'failed')
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet form" role="dialog" aria-label="Rewind" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head"><span /><span className="sheet-title">Rewind the Conversation</span><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="sheet-body">
          <div className="muted">The Robot forgets everything from that Turn on. The current log stays in the archive and you can undo. What it did outside (messages sent, orders placed) still stands.</div>
          {trajectory === undefined ? <div className="muted">Loading…</div> : null}
          {(trajectory?.rewinds ?? []).filter((rewind) => !rewind.undone).map((rewind) => (
            <div key={rewind.id} className="detail-block">
              Rewound to event {rewind.atSeq} on {new Date(rewind.at).toLocaleString()}. <button type="button" className="link" onClick={() => void act(() => api.undoRewind(id, rewind.id))}>Undo</button>
            </div>
          ))}
          <ul className="routine-cards">
            {turns.map((turn) => (
              <li key={turn.seq} className="routine-card">
                <span className="routine-card-text">
                  <span className="routine-name">Turn {turn.turn ?? ''} · {new Date(turn.at).toLocaleString()}</span>
                  <span className="muted">{turn.text || '(no message)'}</span>
                </span>
                <ConfirmButton label="Rewind to before" confirm="Rewind" onConfirm={() => void act(() => api.rewindBeforeTurn(id, turn.turn ?? 0))} />
              </li>
            ))}
          </ul>
          {error === undefined ? null : <div className="muted">{error}</div>}
        </div>
      </div>
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
            void act(() => api.remove(id)).then(() => go({ page: 'home' }))
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
