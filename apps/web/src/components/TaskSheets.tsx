/**
 * A Task in the app (v1.13): the list a Robot's panel shows, and the detail sheet with its fields, children and
 * attempts that the panel and Mission Control open in place (mc-m9ii, mc-n6ff).
 */
import { useState } from 'react'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { TaskView } from '@mr-robot/protocol'
import { homeMembersAtom, keys, robotsAtom, taskAtom, tasksAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { renderResult } from './AtomView.tsx'
import { ClockIcon } from './ChatView.tsx'
import { ConfirmButton, Sheet } from './RobotSheets.tsx'
import { assigneeText, momentText, outcomeMark, whenText, type Names } from './task-words.ts'

/** The names of the people and Robots this Member knows, for a Task's doer. */
export function useNames(): Names {
  const members = AsyncResult.getOrElse(useAtomValue(homeMembersAtom), () => [])
  const robots = AsyncResult.getOrElse(useAtomValue(robotsAtom), () => [])
  return { members: new Map(members.map((member) => [member.id, member.name])), robots: new Map(robots.map((robot) => [robot.id, robot.identity.name])) }
}

/** "Open", "Done", "Cancelled", and "Overdue" for an open Task whose moment passed. */
export function stateText(task: TaskView): string {
  return task.state === 'open' ? (task.overdue ? 'Overdue' : task.timing.kind === 'recurring' && task.timing.paused ? 'Paused' : 'Open') : task.state === 'done' ? 'Done' : 'Cancelled'
}

/** The Tasks of a Robot as its panel lists them (mc-n6ff). */
export function TaskList({ tasks, onOpen }: { tasks: readonly TaskView[]; onOpen: (task: TaskView) => void }) {
  if (tasks.length === 0) return <div className="muted">No tasks.</div>
  return (
    <ul className="task-cards">
      {tasks.map((task) => (
        <li key={task.id}>
          <button type="button" className="task-card" onClick={() => onOpen(task)}>
            <span className="task-icon"><ClockIcon /></span>
            <span className="task-card-text">
              <span className="task-name">{task.title}</span>
              <span className="muted">{whenText(task.timing)}</span>
            </span>
            <span className={task.state === 'open' && !task.overdue ? 'task-status' : 'task-status paused'}>{stateText(task)}</span>
            <span className="chevron">›</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** One Task in place: its fields, children and attempts, and what may be done with it (mc-m9ii). */
export function TaskSheet({ taskId, onClose, onBack, onOpenTask }: { taskId: string; onClose: () => void; onBack?: () => void; onOpenTask?: (id: string) => void }) {
  const result = useAtomValue(taskAtom(taskId))
  return <>{renderResult(result, { what: 'the task' }, (task) => <TaskDetail task={task} onClose={onClose} {...(onBack === undefined ? {} : { onBack })} {...(onOpenTask === undefined ? {} : { onOpenTask })} />)}</>
}

function TaskDetail({ task, onClose, onBack, onOpenTask }: { task: TaskView; onClose: () => void; onBack?: () => void; onOpenTask?: (id: string) => void }) {
  const names = useNames()
  const command = useCommand()
  const [error, setError] = useState<string>()
  const children = AsyncResult.getOrElse(useAtomValue(tasksAtom(`state=all&parent=${encodeURIComponent(task.id)}`)), () => ({ tasks: [], next: null })).tasks
  const robotKey = task.assignee.kind === 'robot' ? [keys.robot(task.assignee.robotId)] : []
  const act = async (run: Parameters<typeof command>[0]) => setError(exitFailure(await command(run, [keys.tasks, ...robotKey])))
  const open = task.state === 'open'
  return (
    <Sheet
      title={task.title}
      onClose={onClose}
      {...(onBack === undefined ? {} : { onBack })}
      footer={open ? (
        <>
          <ConfirmButton label="Cancel task" confirm="Cancel it" onConfirm={() => void act((api) => api.cancelTask(task.id))} />
          <span className="spacer" />
          {task.timing.kind === 'recurring' ? <button type="button" className="button" onClick={() => void act((api) => api.pauseTask(task.id, !(task.timing.kind === 'recurring' && task.timing.paused)))}>{task.timing.paused ? 'Resume' : 'Pause'}</button> : null}
          <button type="button" className="button button-primary" onClick={() => void act((api) => api.finishTask(task.id))}>Done</button>
        </>
      ) : null}
    >
      <dl className="detail-rows">
        <div><dt>State</dt><dd>{stateText(task)}</dd></div>
        <div><dt>Doer</dt><dd>{assigneeText(task.assignee, names)}</dd></div>
        <div><dt>When</dt><dd>{whenText(task.timing)}{task.timing.kind === 'recurring' ? <div className="muted">{task.timing.timeZone}</div> : null}</dd></div>
        {task.remind.kind === 'before' ? <div><dt>Remind</dt><dd>{task.remind.minutes} minutes before</dd></div> : null}
        <div><dt>Created by</dt><dd>{task.createdBy.kind === 'platform' ? 'the platform' : task.createdBy.name}</dd></div>
        {task.parentId === null ? null : <div><dt>Part of</dt><dd><button type="button" className="link" onClick={() => onOpenTask?.(task.parentId!)}>the parent task</button></dd></div>}
      </dl>
      <h3 className="panel-section">Instructions</h3>
      <div className={task.instructions === '' ? 'detail-block muted' : 'detail-block'}>{task.instructions === '' ? 'None' : task.instructions}</div>
      {children.length === 0 ? null : (
        <>
          <h3 className="panel-section">Children</h3>
          <TaskList tasks={children} onOpen={(child) => onOpenTask?.(child.id)} />
        </>
      )}
      <h3 className="panel-section">Attempts</h3>
      {task.attempts.length === 0 ? <div className="detail-block muted">No attempts yet</div> : (
        <ul className="detail-block runs">
          {task.attempts.map((attempt) => (
            <li key={`${attempt.startedAt}-${attempt.outcome}`}>
              <span className={`run-${attempt.outcome}`} title={attempt.outcome}>{outcomeMark(attempt.outcome)}</span>
              <span className="muted">{momentText(attempt.startedAt)}{attempt.finishedAt === null ? '' : ` – ${new Date(attempt.finishedAt).toLocaleTimeString()}`}</span>
              <span>{attempt.outcome === 'skipped' ? `Skipped: ${attempt.firstLine}` : attempt.firstLine}</span>
            </li>
          ))}
        </ul>
      )}
      {error === undefined ? null : <div className="muted">{error}</div>}
    </Sheet>
  )
}
