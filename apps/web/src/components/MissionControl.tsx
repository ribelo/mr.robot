/**
 * Mission Control (v1.13 ticket 06, mc-m1aa…mc-m9ii): the Fleet (who works, why, on what) and the Tasks a Member
 * sees, as two dense windowed tables. Grouping, the state filter and Whole Space are remembered in the Member's
 * preferences; a Fleet row opens the Robot, a Task row opens its detail in place.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { LastWakeup, Me, MissionGroup, MissionPrefs, MissionState, MissionView, RobotSummary, TaskView, WakeupCause } from '@mr-robot/protocol'
import { keys, missionAtom, robotsAtom, useCommand, type MissionQuery } from '../client/api-atoms.ts'
import { MrRobotDrawer } from './MrRobotDrawer.tsx'
import { go } from '../route.ts'
import { renderResult } from './AtomView.tsx'
import { Avatar } from './Avatar.tsx'
import { TaskActions, TaskForm, TaskSheet, stateText, useNames } from './TaskSheets.tsx'
import { WindowedTable } from './WindowedTable.tsx'
import { assigneeKey, assigneeText, lastAttemptText, momentOf, whenText, type Names } from './task-words.ts'

const ROW_HEIGHT = 28

const STATES: ReadonlyArray<{ id: MissionState; label: string }> = [
  { id: 'open', label: 'Open' }, { id: 'done', label: 'Done' }, { id: 'cancelled', label: 'Cancelled' }, { id: 'all', label: 'All' },
]
const GROUPS: ReadonlyArray<{ id: MissionGroup; label: string }> = [
  { id: 'assignee', label: 'By doer' }, { id: 'parent', label: 'By parent' }, { id: 'time', label: 'By time' },
]

const WAKEUP_WORDS: Record<WakeupCause['kind'], string> = { member: 'message', task: 'task', robot: 'robot', channel: 'channel', takeover: 'takeover', platform: 'platform' }

/** What woke the Robot, in a few words: "message · Anna", "task · schedule". */
export function wokeText(wakeup: WakeupCause): string {
  return `${WAKEUP_WORDS[wakeup.kind]} · ${wakeup.from}`
}

/** How long ago, short: "40 s", "12 min", "3 h", "2 d". */
export function sinceText(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`
}

export type TaskRow =
  | { readonly kind: 'group'; readonly key: string; readonly label: string; readonly count: number }
  | { readonly kind: 'task'; readonly task: TaskView }

function timeBucket(task: TaskView, now: number): { key: string; label: string; order: number } {
  if (task.overdue) return { key: 'overdue', label: 'Overdue', order: 0 }
  const at = momentOf(task.timing)
  if (at === null) return { key: 'none', label: 'No date', order: 5 }
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const startOfToday = day.getTime()
  if (at < startOfToday + 86_400_000) return { key: 'today', label: at < now ? 'Earlier' : 'Today', order: 1 }
  if (at < startOfToday + 2 * 86_400_000) return { key: 'tomorrow', label: 'Tomorrow', order: 2 }
  if (at < startOfToday + 7 * 86_400_000) return { key: 'week', label: 'This week', order: 3 }
  return { key: 'later', label: 'Later', order: 4 }
}

/**
 * The loaded Tasks folded into groups with a header each (mc-m5ee): by doer, by parent (a Task with children heads
 * its own group), or by time (overdue, today, tomorrow, this week, later, no date). Groups keep the server's order
 * of their first Task; time groups are in time order.
 */
export function groupTasks(tasks: readonly TaskView[], group: MissionGroup, names: Names, now: number): TaskRow[] {
  const titles = new Map(tasks.map((task) => [task.id, task.title]))
  const groups = new Map<string, { label: string; order: number; tasks: TaskView[] }>()
  for (const task of tasks) {
    const { key, label, order } = group === 'assignee'
      ? { key: assigneeKey(task.assignee), label: assigneeText(task.assignee, names), order: 0 }
      : group === 'parent'
        ? task.parentId !== null ? { key: task.parentId, label: titles.get(task.parentId) ?? 'Part of another task', order: 0 }
          : task.children > 0 ? { key: task.id, label: task.title, order: 0 } : { key: 'none', label: 'Without a parent', order: 1 }
        : timeBucket(task, now)
    const entry = groups.get(key) ?? { label, order, tasks: [] }
    entry.tasks.push(task)
    groups.set(key, entry)
  }
  return [...groups.entries()]
    .map(([key, entry], index) => ({ key, ...entry, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .flatMap((entry): TaskRow[] => [{ kind: 'group', key: entry.key, label: entry.label, count: entry.tasks.length }, ...entry.tasks.map((task): TaskRow => ({ kind: 'task', task }))])
}

export function MissionControl({ me }: { me: Me }) {
  const command = useCommand()
  const [prefs, setPrefs] = useState<MissionPrefs>(me.mission)
  const [q, setQ] = useState('')
  const [fleetQ, setFleetQ] = useState('')
  const [pages, setPages] = useState({ fleet: 1, tasks: 1 })
  const [openTask, setOpenTask] = useState<string>()
  const [form, setForm] = useState<{ readonly parentId?: string; readonly task?: TaskView }>()
  const admin = me.role === 'admin'
  const remember = (patch: Partial<MissionPrefs>) => {
    setPrefs((current) => ({ ...current, ...patch }))
    setPages({ fleet: 1, tasks: 1 })
    void command((api) => api.updateMe({ mission: patch }), [keys.me])
  }
  const wanted: MissionQuery = { scope: admin && prefs.wholeSpace ? 'space' : 'mine', state: prefs.state, group: prefs.group, fleetQ: fleetQ.trim(), q: q.trim(), fleetPages: pages.fleet, taskPages: pages.tasks }
  const key = JSON.stringify(wanted)
  const result = useAtomValue(missionAtom(key))
  const refresh = useAtomRefresh(missionAtom(key))
  // The Fleet changes while it is on screen; it reads again every ten seconds.
  useEffect(() => {
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [refresh])
  // A new query keeps the last tables on screen until its answer comes.
  const [shown, setShown] = useState<MissionView>()
  useEffect(() => { if (AsyncResult.isSuccess(result)) setShown(result.value) }, [result])
  const chief = AsyncResult.getOrElse(useAtomValue(robotsAtom), () => []).find((robot) => robot.kind === 'mr-robot' && robot.ownerId === me.id)

  return (
    <div className="page mission">
      <h1>
        <button type="button" className="icon-button" aria-label="Back" onClick={() => go({ page: 'home' })}>‹</button>
        Mission Control
      </h1>
      <div className="mission-bar">
        <input type="search" aria-label="Search robots" placeholder="Search robots by name" value={fleetQ} onChange={(event) => { setFleetQ(event.target.value); setPages((current) => ({ ...current, fleet: 1 })) }} />
        <input type="search" aria-label="Search tasks" placeholder="Search tasks by title" value={q} onChange={(event) => { setQ(event.target.value); setPages((current) => ({ ...current, tasks: 1 })) }} />
        <div className="segmented compact" role="radiogroup" aria-label="Show tasks">
          {STATES.map((option) => <button key={option.id} type="button" role="radio" aria-checked={prefs.state === option.id} className={prefs.state === option.id ? 'segment active' : 'segment'} onClick={() => remember({ state: option.id })}>{option.label}</button>)}
        </div>
        <div className="segmented compact" role="radiogroup" aria-label="Group tasks">
          {GROUPS.map((option) => <button key={option.id} type="button" role="radio" aria-checked={prefs.group === option.id} className={prefs.group === option.id ? 'segment active' : 'segment'} onClick={() => remember({ group: option.id })}>{option.label}</button>)}
        </div>
        <span className="spacer" />
        <button type="button" className="button button-primary" onClick={() => setForm({})}>New task</button>
        {chief === undefined ? null : <button type="button" className={prefs.drawer ? 'button active' : 'button'} aria-pressed={prefs.drawer} onClick={() => remember({ drawer: !prefs.drawer })}>{chief.identity.name}</button>}
        {admin ? (
          <label className="inline">
            Whole Space
            <button type="button" role="switch" aria-checked={prefs.wholeSpace} aria-label="Whole Space" className={prefs.wholeSpace ? 'switch on' : 'switch'} onClick={() => remember({ wholeSpace: !prefs.wholeSpace })}><span /></button>
          </label>
        ) : null}
      </div>
      <div className="mission-body">
        <div className="mission-tables">
          {shown === undefined
            ? renderResult(result, { what: 'Mission Control', retry: refresh }, () => null)
            : <MissionTables view={shown} prefs={prefs} wholeSpace={wanted.scope === 'space'} onOpenTask={setOpenTask} onForm={setForm}
              onMoreFleet={() => setPages((current) => ({ ...current, fleet: current.fleet + 1 }))}
              onMoreTasks={() => setPages((current) => ({ ...current, tasks: current.tasks + 1 }))} />}
        </div>
        {prefs.drawer && chief !== undefined ? <MrRobotDrawer me={me} chief={chief} onTurnEnded={refresh} /> : null}
      </div>
      {openTask === undefined ? null : <TaskSheet taskId={openTask} working={shown?.fleet.some((robot) => robot.turn?.task?.id === openTask) === true} onClose={() => setOpenTask(undefined)} onOpenTask={setOpenTask} />}
      {form === undefined ? null : <TaskForm {...(form.task === undefined ? {} : { task: form.task })} {...(form.parentId === undefined ? {} : { parentId: form.parentId })} onClose={() => setForm(undefined)} />}
    </div>
  )
}

function MissionTables({ view, prefs, wholeSpace, onOpenTask, onForm, onMoreFleet, onMoreTasks }: {
  view: MissionView
  prefs: MissionPrefs
  wholeSpace: boolean
  onOpenTask: (id: string) => void
  onForm: (form: { readonly parentId?: string; readonly task?: TaskView }) => void
  onMoreFleet: () => void
  onMoreTasks: () => void
}) {
  const names = useNames()
  const command = useCommand()
  const now = Date.now()
  const [menu, setMenu] = useState<{ readonly task: TaskView; readonly x: number; readonly y: number }>()
  const workingOn = new Set(view.fleet.flatMap((robot) => (robot.turn?.task === null || robot.turn?.task === undefined ? [] : [robot.turn.task.id])))
  const rows = useMemo(() => groupTasks(view.tasks, prefs.group, names, now), [view.tasks, prefs.group, names, now])
  const titles = useMemo(() => new Map(view.tasks.map((task) => [task.id, task.title])), [view.tasks])
  const moreFleet = useCallback(() => { if (view.fleetNext !== null) onMoreFleet() }, [view.fleetNext, onMoreFleet])
  const moreTasks = useCallback(() => { if (view.tasksNext !== null) onMoreTasks() }, [view.tasksNext, onMoreTasks])
  const fleetColumns = `22px minmax(110px, 1.3fr) 108px minmax(110px, 1.2fr) minmax(100px, 1.2fr) minmax(80px, 0.9fr) 56px minmax(120px, 1.2fr) minmax(140px, 2fr)${wholeSpace ? ' minmax(80px, 0.8fr)' : ''} 76px`
  const taskColumns = '84px minmax(160px, 2.4fr) minmax(90px, 1fr) minmax(130px, 1.5fr) minmax(130px, 1.8fr) 46px 30px'
  return (
    <>
      <section className="mission-section" aria-label="Fleet">
        <h2>Fleet · {view.counts.robots} robots · {view.counts.working} working · {view.counts.waiting} waiting for you</h2>
        <WindowedTable<RobotSummary>
          label="Fleet"
          rows={view.fleet}
          rowKey={(robot) => robot.id}
          rowHeight={ROW_HEIGHT}
          columns={fleetColumns}
          header={<><span /><span>Robot</span><span>State</span><span>Woke by</span><span>Task</span><span>Tool</span><span>Since</span><span>Workspace</span><span>Last line</span>{wholeSpace ? <span>Owner</span> : null}<span /></>}
          renderRow={(robot) => <FleetCells robot={robot} now={now} wholeSpace={wholeSpace}
            onInterrupt={() => void command((api) => api.interrupt(robot.id), [keys.robots, keys.tasks, keys.robot(robot.id)])}
            onInterruptSubagent={(childId) => void command((api) => api.interruptSubagent(robot.id, childId), [keys.robots, keys.robot(robot.id)])} />}
          onRowClick={(robot) => go({ page: 'robot', id: robot.id, panel: false, from: 'mission' })}
          onEnd={moreFleet}
        />
      </section>
      <section className="mission-section" aria-label="Tasks">
        <h2>Tasks · {view.counts.openTasks} open</h2>
        <WindowedTable<TaskRow>
          label="Tasks"
          rows={rows}
          rowKey={(row) => (row.kind === 'group' ? `group:${row.key}` : row.task.id)}
          rowHeight={ROW_HEIGHT}
          columns={taskColumns}
          header={<><span>State</span><span>Title</span><span>Doer</span><span>When</span><span>Last attempt</span><span>Sub</span><span /></>}
          rowClass={(row) => (row.kind === 'group' ? 'wt-group' : row.task.overdue ? 'wt-overdue' : '')}
          renderRow={(row) => (row.kind === 'group'
            ? <span style={{ gridColumn: '1 / -1' }}>{row.label} · {row.count}</span>
            : <TaskCells task={row.task} names={names} parentTitle={row.task.parentId === null ? undefined : titles.get(row.task.parentId)}
              onMenu={(x, y) => setMenu({ task: row.task, x, y })} />)}
          onRowClick={(row) => { if (row.kind === 'task') onOpenTask(row.task.id) }}
          onEnd={moreTasks}
        />
      </section>
      {menu === undefined ? null : (
        <div className="menu-backdrop" onClick={() => setMenu(undefined)}>
          <div className="task-menu" role="menu" aria-label={`Actions of ${menu.task.title}`} style={{ left: Math.min(menu.x, window.innerWidth - 260), top: Math.min(menu.y, window.innerHeight - 320) }} onClick={(event) => event.stopPropagation()}>
            <TaskActions task={menu.task} working={workingOn.has(menu.task.id)} onDone={() => setMenu(undefined)}
              onAddChild={() => { setMenu(undefined); onForm({ parentId: menu.task.id }) }}
              onEdit={() => { setMenu(undefined); onForm({ task: menu.task }) }} />
          </div>
        </div>
      )}
    </>
  )
}

/**
 * "working · N Subagents" on a Fleet row (ao-j8t9): it opens one line per Subagent with its label, since when,
 * the tool it runs and Interrupt. The lines open over the table, so the windowed rows keep their height.
 */
function SubagentLines({ robot, now, onInterrupt }: { robot: RobotSummary; now: number; onInterrupt: (childId: string) => void }) {
  const [open, setOpen] = useState(false)
  const lines = robot.subagents ?? []
  return (
    <span className="subagent-lines">
      <button type="button" className="link" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen(!open) }}> · {lines.length} {lines.length === 1 ? 'Subagent' : 'Subagents'}</button>
      {open ? (
        <span className="subagent-popover" role="list" aria-label={`Subagents of ${robot.identity.name}`} onClick={(event) => event.stopPropagation()}>
          {lines.map((line) => (
            <span key={line.id} role="listitem" className="subagent-line">
              <span>{line.label}</span>
              <span className="muted">{sinceText(line.since, now)}</span>
              <span>{line.activity ?? ''}</span>
              <button type="button" className="link danger" onClick={() => onInterrupt(line.id)}>Interrupt</button>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

function FleetCells({ robot, now, wholeSpace, onInterrupt, onInterruptSubagent }: { robot: RobotSummary; now: number; wholeSpace: boolean; onInterrupt: () => void; onInterruptSubagent: (childId: string) => void }) {
  const cause: LastWakeup | null = robot.turn ?? robot.lastWakeup
  return (
    <>
      <Avatar seed={robot.identity.avatarSeed} color={robot.identity.avatarColor} size={18} state={robot.fleetState} />
      <span className="wt-cell-name">{robot.identity.name}</span>
      <span><span className={`state state-${robot.fleetState.split(' ')[0]}`}>{robot.fleetState}</span>{(robot.subagents ?? []).length === 0 ? null : <SubagentLines robot={robot} now={now} onInterrupt={onInterruptSubagent} />}</span>
      <span className={robot.turn === null ? 'muted' : ''}>{cause === null ? '' : wokeText(cause.wakeup)}</span>
      <span className={robot.turn === null ? 'muted' : ''}>{cause?.task?.title ?? (robot.turn === null ? '' : 'no task')}</span>
      <span>{robot.turn?.activity ?? ''}</span>
      <span>{robot.turn === null ? '' : sinceText(robot.turn.since, now)}</span>
      {/* Where it works (v1.21, cw-hiwf): its Workspace's Host and root, or nothing. */}
      <span className="muted" title={robot.workspace == null ? undefined : `${robot.workspace.host}: ${robot.workspace.root}`}>{robot.workspace == null ? '' : `${robot.workspace.host}: ${robot.workspace.root}`}</span>
      <span className="muted">{robot.lastLine}</span>
      {wholeSpace ? <span className="muted">{robot.ownerName}</span> : null}
      <span>{robot.turn === null ? null : <button type="button" className="link danger" onClick={(event) => { event.stopPropagation(); onInterrupt() }}>Interrupt</button>}</span>
    </>
  )
}

function TaskCells({ task, names, parentTitle, onMenu }: { task: TaskView; names: Names; parentTitle: string | undefined; onMenu: (x: number, y: number) => void }) {
  return (
    <>
      <span>{stateText(task)}</span>
      <span>{parentTitle === undefined ? null : <span className="muted">{parentTitle} › </span>}{task.title}</span>
      <span>{assigneeText(task.assignee, names)}</span>
      <span className="task-when">{whenText(task.timing)}</span>
      <span className="muted">{lastAttemptText(task)}</span>
      <span className="muted">{task.children === 0 ? '' : task.children}</span>
      <span>{task.state === 'open' ? <button type="button" className="icon-button small" aria-label={`Actions of ${task.title}`} onClick={(event) => {
        event.stopPropagation()
        // Under the button, whether it was clicked or pressed with the keyboard.
        const box = event.currentTarget.getBoundingClientRect()
        onMenu(box.right - 250, box.bottom + 4)
      }}>⋯</button> : null}</span>
    </>
  )
}
