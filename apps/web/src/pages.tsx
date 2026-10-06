import { useCallback, useEffect, useState } from 'react'
import type { Me, RobotSummary, Trajectory } from '@mr-robot/protocol'
import { api, ApiError } from './api.ts'
import { useLive } from './live.ts'
import { go, type Route } from './route.ts'
import { TrajectoryView } from './components/TrajectoryView.tsx'

/** Full-page views reached from a Robot or the sidebar. */
export function Pages({ route, me, robots, onChanged }: { route: Route; me: Me; robots: readonly RobotSummary[]; onChanged: () => void }) {
  switch (route.page) {
    case 'trajectory': return <TrajectoryPage id={route.id} robot={robots.find((robot) => robot.id === route.id)} me={me} onChanged={onChanged} />
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
