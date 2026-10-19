import { useState } from 'react'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { SubagentView } from '@mr-robot/protocol'
import { subagentsAtom } from '../client/api-atoms.ts'
import { go } from '../route.ts'

const STATES: Record<SubagentView['status'], string> = { running: 'working', done: 'done', interrupted: 'interrupted', failed: 'failed', archived: 'archived' }

/** "N Subagents" in the Robot's header (ao-ce55): a dropdown of its Subagents, each opening its own Chat and Trajectory. */
export function SubagentsControl({ robotId, now = Date.now() }: { robotId: string; now?: number }) {
  const [open, setOpen] = useState(false)
  const children = AsyncResult.getOrElse(useAtomValue(subagentsAtom(robotId)), () => [] as readonly SubagentView[])
  if (children.length === 0) return null
  const running = children.filter((child) => child.status === 'running').length
  const since = (at: number) => {
    const minutes = Math.floor((now - at) / 60_000)
    return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`
  }
  return (
    <span className="subagents-control">
      <button type="button" className="head-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {running > 0 ? `${running} ${running === 1 ? 'Subagent' : 'Subagents'}` : 'Subagents'}
      </button>
      {open ? (
        <div className="menu-backdrop" onClick={() => setOpen(false)}>
          <div className="subagents-menu" role="menu" aria-label="Subagents" onClick={(event) => event.stopPropagation()}>
            {children.map((child) => (
              <button key={child.id} type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); go({ page: 'subagent', id: robotId, child: child.id, tab: 'chat' }) }}>
                <span>{child.label}</span>
                <span className="muted"> · {child.model.model} · {STATES[child.status]} · {since(child.startedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </span>
  )
}
