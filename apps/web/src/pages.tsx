import { Empty } from './components/States.tsx'
import { ThisComputer } from './components/ThisComputer.tsx'
import { PairHost } from './components/Hosts.tsx'
import { FilesView } from './components/FilesView.tsx'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { Me, RobotSummary, Trajectory } from '@mr-robot/protocol'
import { catalogAtom, keys, panelAtom, trajectoryAtom, useCommand } from './client/api-atoms.ts'
import { exitFailure } from './client/api-failure.ts'
import { robotFeedAtom } from './client/robot-feed.ts'
import { AtomView, renderResult } from './components/AtomView.tsx'
import { Loading } from './components/States.tsx'
import { go, type Route } from './route.ts'
import { AdvancedSettings } from './components/AdvancedSettings.tsx'
import { Profile } from './components/Profile.tsx'
import { Admin } from './components/Admin.tsx'
import { Takeover } from './components/Takeover.tsx'
import { ConfirmButton } from './components/RobotSheets.tsx'

// The DSH trajectory (with its code highlighter) loads only when its page opens.
const RobotTrajectory = lazy(() => import('./dsh/RobotTrajectory.tsx').then((module) => ({ default: module.RobotTrajectory })))

/** Full-page views reached from a Robot or the sidebar. */
export function Pages({ route, me, robots }: { route: Route; me: Me; robots: readonly RobotSummary[] }) {
  switch (route.page) {
    case 'trajectory': return <TrajectoryPage id={route.id} robot={robots.find((robot) => robot.id === route.id)} me={me} />
    case 'advanced': return <AdvancedPage id={route.id} />
    case 'admin': return (
      <div className="page">
        <PageHead title="Admin" back={{ page: 'home' }} />
        {me.role === 'admin' ? <Admin /> : <div className="muted">Only the Home admin sees this page.</div>}
      </div>
    )
    case 'this-computer': return (
      <div className="page">
        <PageHead title="This computer" back={{ page: 'profile' }} />
        <ThisComputer />
      </div>
    )
    case 'pair': return (
      <div className="page">
        <PageHead title="Pair a computer" back={{ page: 'home' }} />
        <PairHost code={route.code} />
      </div>
    )
    case 'files': return <FilesPage id={route.id} path={route.path} robot={robots.find((robot) => robot.id === route.id)} me={me} />
    case 'takeover': return <TakeoverPage id={route.id} robot={robots.find((robot) => robot.id === route.id)} />
    case 'profile': return (
      <div className="page">
        <PageHead title={me.name} back={{ page: 'home' }} />
        <Profile me={me} />
      </div>
    )
    default: return <div className="empty-main"><Empty title="Nothing here" hint="This address does not lead to a page." /></div>
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

function TrajectoryPage({ id, robot, me }: { id: string; robot: RobotSummary | undefined; me: Me }) {
  const liveVersion = AsyncResult.getOrElse(useAtomValue(robotFeedAtom(id)), () => ({ changes: 0 })).changes
  const [viewKey, setViewKey] = useState(0)
  const [rewinding, setRewinding] = useState(false)
  const canRewind = robot?.ownerId === me.id
  return (
    <div className="page page-wide">
      <PageHead title={`${robot?.identity.name ?? 'Robot'} · Trajectory`} back={{ page: 'robot', id, panel: true }} />
      {canRewind ? <div className="question-actions"><button type="button" className="button" onClick={() => setRewinding(true)}>Rewind…</button></div> : null}
      <Suspense fallback={<div className="muted">Loading the trajectory…</div>}>
        <RobotTrajectory key={viewKey} robotId={id} liveVersion={liveVersion} />
      </Suspense>
      {rewinding ? <RewindSheet id={id} onClose={() => setRewinding(false)} onDone={() => { setRewinding(false); setViewKey((key) => key + 1) }} /> : null}
    </div>
  )
}

/** Rewind (robot-0q6a, robot-8v1t): back to before a Turn, or undo an earlier rewind. */
function RewindSheet({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const result = useAtomValue(trajectoryAtom(id))
  const trajectory: Trajectory | undefined = AsyncResult.isSuccess(result) ? result.value : undefined
  const command = useCommand()
  const [error, setError] = useState<string>()
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
  const act = async (run: Parameters<typeof command>[0]) => {
    const failure = exitFailure(await command(run, [keys.robot(id), keys.robots]))
    if (failure === undefined) onDone()
    else setError(failure)
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet form" role="dialog" aria-label="Rewind" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head"><span /><span className="sheet-title">Rewind the Conversation</span><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="sheet-body">
          <div className="muted">The Robot forgets everything from that Turn on. The current log stays in the archive and you can undo. What it did outside (messages sent, orders placed) still stands.</div>
          {renderResult(result, { what: 'the trajectory' }, () => null)}
          {(trajectory?.rewinds ?? []).filter((rewind) => !rewind.undone).map((rewind) => (
            <div key={rewind.id} className="detail-block">
              Rewound to event {rewind.atSeq} on {new Date(rewind.at).toLocaleString()}. <button type="button" className="link" onClick={() => void act((api) => api.undoRewind(id, rewind.id))}>Undo</button>
            </div>
          ))}
          <ul className="routine-cards">
            {turns.map((turn) => (
              <li key={turn.seq} className="routine-card">
                <span className="routine-card-text">
                  <span className="routine-name">Turn {turn.turn ?? ''} · {new Date(turn.at).toLocaleString()}</span>
                  <span className="muted">{turn.text || '(no message)'}</span>
                </span>
                <ConfirmButton label="Rewind to before" confirm="Rewind" onConfirm={() => void act((api) => api.rewindBeforeTurn(id, turn.turn ?? 0))} />
              </li>
            ))}
          </ul>
          {error === undefined ? null : <div className="muted">{error}</div>}
        </div>
      </div>
    </div>
  )
}

function AdvancedPage({ id }: { id: string }) {
  const panel = useAtomValue(panelAtom(id))
  const catalog = useAtomValue(catalogAtom(id))
  const command = useCommand()
  const [message, setMessage] = useState<string>()
  const act = async (run: Parameters<typeof command>[0], done: string) => {
    setMessage(exitFailure(await command(run, [keys.robot(id), keys.robots])) ?? done)
  }
  const name = AsyncResult.isSuccess(panel) ? panel.value.summary.identity.name : 'Robot'
  return (
    <div className="page">
      <PageHead title={`${name} · Advanced settings`} back={{ page: 'robot', id, panel: true }} />
      {message === undefined ? null : <div className="muted">{message}</div>}
      {renderResult(AsyncResult.all([panel, catalog]), { what: 'the settings' }, ([loadedPanel, loadedCatalog]) => (
        <AdvancedSettings
          key={JSON.stringify(loadedPanel.settings)}
          panel={loadedPanel}
          catalog={loadedCatalog}
          onSave={(patch) => act((api) => api.updateSettings(id, patch), 'Saved. Changes apply from the next Turn.')}
          onPause={() => void act((api) => api.pause(id), 'Paused.')}
          onResume={() => void act((api) => api.resume(id), 'Resumed.')}
          onDelete={async (confirm) => {
            const exit = await command((api) => api.remove(id, confirm), [keys.robots])
            if (exitFailure(exit) === undefined) go({ page: 'home' })
            return exit
          }}
          onClear={async (confirm, memory) => {
            const exit = await command((api) => api.clearHistory(id, confirm, memory), [keys.robot(id), keys.robots, keys.files(id)])
            if (exitFailure(exit) === undefined) setMessage('History cleared.')
            return exit
          }}
        />
      ))}
    </div>
  )
}
function TakeoverPage({ id, robot }: { id: string; robot: RobotSummary | undefined }) {
  return (
    <AtomView atom={panelAtom(id)} what="the browser">
      {(panel) => (
        <Takeover
          robotId={id}
          robotName={robot?.identity.name ?? panel.summary.identity.name}
          requested={panel.takeover === null || !panel.canEdit ? null : { reason: panel.takeover.reason }}
          onClose={() => go({ page: 'robot', id, panel: true })}
        />
      )}
    </AtomView>
  )
}

function FilesPage({ id, path, robot, me }: { id: string; path: string | null; robot: RobotSummary | undefined; me: Me }) {
  return (
    <div className="page">
      <PageHead title={`${robot?.identity.name ?? 'Robot'} · Files`} back={{ page: 'robot', id, panel: true }} />
      <FilesView robotId={id} path={path} canEdit={robot === undefined || robot.ownerId === me.id} onOpen={(next) => go({ page: 'files', id, path: next })} />
    </div>
  )
}
