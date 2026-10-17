/**
 * A Task in the app (v1.13): the list a Robot's panel shows, and the detail sheet with its fields, children and
 * attempts that the panel and Mission Control open in place (mc-m9ii, mc-n6ff).
 */
import { useState, type ReactNode } from 'react'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { RecurringSchedule, Remind, TaskAssignee, TaskInput, TaskTimingInput, TaskView } from '@mr-robot/protocol'
import { homeMembersAtom, keys, robotsAtom, taskAtom, tasksAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { renderResult } from './AtomView.tsx'
import { SaveButton } from './SaveButton.tsx'
import { ClockIcon } from './ChatView.tsx'
import { ConfirmButton, Sheet } from './RobotSheets.tsx'
import { assigneeKey, assigneeText, momentText, outcomeMark, whenText, type Names } from './task-words.ts'

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

/** A doer chosen in a select: "nobody", "member:<id>", "robot:<id>". */
export function parseAssigneeKey(key: string): TaskAssignee {
  if (key.startsWith('member:')) return { kind: 'member', memberId: key.slice('member:'.length) }
  if (key.startsWith('robot:')) return { kind: 'robot', robotId: key.slice('robot:'.length) }
  return { kind: 'nobody' }
}

/** The doers a Member may choose: the Members of the Home, the Robots he reaches, and nobody (mc-n2bb). */
export function AssigneeOptions() {
  const members = AsyncResult.getOrElse(useAtomValue(homeMembersAtom), () => [])
  const robots = AsyncResult.getOrElse(useAtomValue(robotsAtom), () => [])
  return (
    <>
      <option value="nobody">Nobody</option>
      <optgroup label="People">{members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}</optgroup>
      <optgroup label="Robots">{robots.map((robot) => <option key={robot.id} value={`robot:${robot.id}`}>{robot.identity.name}</option>)}</optgroup>
    </>
  )
}

/**
 * What can be done with a Task (mc-n1aa): Done, Cancel, Pause or Resume (recurring), Run now (a Robot's Task nobody
 * works on), Assign to… (refused while a Robot works on it), Add child and Edit. `working`: a Robot works on it now.
 */
export function TaskActions({ task, working, onAddChild, onEdit, onDone }: { task: TaskView; working: boolean; onAddChild: () => void; onEdit: () => void; onDone?: () => void }) {
  const command = useCommand()
  const [error, setError] = useState<string>()
  const robotKey = task.assignee.kind === 'robot' ? [keys.robot(task.assignee.robotId)] : []
  const act = async (run: Parameters<typeof command>[0]) => {
    const failure = exitFailure(await command(run, [keys.tasks, keys.robots, ...robotKey]))
    setError(failure)
    if (failure === undefined) onDone?.()
  }
  if (task.state !== 'open') return null
  const recurring = task.timing.kind === 'recurring'
  const paused = task.timing.kind === 'recurring' && task.timing.paused
  return (
    <div className="task-actions">
      <button type="button" className="button button-primary" onClick={() => void act((api) => api.finishTask(task.id))}>Done</button>
      {recurring ? <button type="button" className="button" onClick={() => void act((api) => api.pauseTask(task.id, !paused))}>{paused ? 'Resume' : 'Pause'}</button> : null}
      {task.assignee.kind === 'robot' && !working ? <button type="button" className="button" onClick={() => void act((api) => api.runTask(task.id))}>Run now</button> : null}
      <select aria-label="Assign to" value="" disabled={working} title={working ? 'A Robot is working on it' : undefined}
        onChange={(event) => { const assignee = parseAssigneeKey(event.target.value); if (event.target.value !== '') void act((api) => api.assignTask(task.id, assignee)) }}>
        <option value="" disabled>Assign to…</option>
        <AssigneeOptions />
      </select>
      <button type="button" className="button" onClick={onAddChild}>Add child</button>
      <button type="button" className="button" onClick={onEdit}>Edit</button>
      <ConfirmButton label="Cancel task" confirm="Cancel it" onConfirm={() => void act((api) => api.cancelTask(task.id))} />
      {error === undefined ? null : <div className="muted" role="alert">{error}</div>}
    </div>
  )
}

/** One Task in place: its fields, children and attempts, and what may be done with it (mc-m9ii). */
export function TaskSheet({ taskId, working = false, onClose, onBack, onOpenTask }: { taskId: string; working?: boolean; onClose: () => void; onBack?: () => void; onOpenTask?: (id: string) => void }) {
  const result = useAtomValue(taskAtom(taskId))
  const [form, setForm] = useState<{ readonly kind: 'edit' } | { readonly kind: 'child' }>()
  return <>{renderResult(result, { what: 'the task' }, (task) => form === undefined
    ? <TaskDetail task={task} working={working} onClose={onClose} onEdit={() => setForm({ kind: 'edit' })} onAddChild={() => setForm({ kind: 'child' })} {...(onBack === undefined ? {} : { onBack })} {...(onOpenTask === undefined ? {} : { onOpenTask })} />
    : <TaskForm {...(form.kind === 'edit' ? { task } : { parentId: task.id })} onClose={() => setForm(undefined)} />)}</>
}

function TaskDetail({ task, working, onClose, onBack, onOpenTask, onEdit, onAddChild }: { task: TaskView; working: boolean; onClose: () => void; onBack?: () => void; onOpenTask?: (id: string) => void; onEdit: () => void; onAddChild: () => void }) {
  const names = useNames()
  const parentId = task.parentId
  const children = AsyncResult.getOrElse(useAtomValue(tasksAtom(`state=all&parent=${encodeURIComponent(task.id)}`)), () => ({ tasks: [], next: null })).tasks
  return (
    <Sheet title={task.title} onClose={onClose} {...(onBack === undefined ? {} : { onBack })} footer={task.state === 'open' ? <TaskActions task={task} working={working} onEdit={onEdit} onAddChild={onAddChild} /> : null}>
      <dl className="detail-rows">
        <div><dt>State</dt><dd>{stateText(task)}</dd></div>
        <div><dt>Doer</dt><dd>{assigneeText(task.assignee, names)}</dd></div>
        <div><dt>When</dt><dd>{whenText(task.timing)}{task.timing.kind === 'recurring' ? <div className="muted">{task.timing.timeZone}</div> : null}</dd></div>
        {task.remind.kind === 'before' ? <div><dt>Remind</dt><dd>{task.remind.minutes} minutes before</dd></div> : null}
        <div><dt>Created by</dt><dd>{task.createdBy.kind === 'platform' ? 'the platform' : task.createdBy.name}</dd></div>
        {parentId === null ? null : <div><dt>Part of</dt><dd><button type="button" className="link" onClick={() => onOpenTask?.(parentId)}>the parent task</button></dd></div>}
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
    </Sheet>
  )
}

type TimingChoice = 'none' | 'at' | 'every'
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const REMIND_CHOICES: ReadonlyArray<{ readonly minutes: number | null; readonly label: string }> = [
  { minutes: null, label: 'No reminder' }, { minutes: 0, label: 'At the time' }, { minutes: 5, label: '5 minutes before' }, { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' }, { minutes: 60, label: '1 hour before' }, { minutes: 1440, label: '1 day before' },
]

/** A moment as a datetime-local input shows it, in this device's zone. */
function localInput(at: number | null): string {
  if (at === null) return ''
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const instant = (value: string): number | null => (value === '' ? null : new Date(value).getTime())

/**
 * The short Task form (mc-n3cc): title, instructions, doer, parent, and the timing as a choice of none / at / every
 * with a date-time or a schedule. A deadline only for none and at; a reminder only for a person with a moment.
 * The server's refusals (a deadline before the start, too frequent) show under the form.
 */
export function TaskForm({ task, parentId, onClose, onSaved }: { task?: TaskView; parentId?: string; onClose: () => void; onSaved?: (task: TaskView) => void }) {
  const command = useCommand()
  const open = AsyncResult.getOrElse(useAtomValue(tasksAtom('state=open')), () => ({ tasks: [], next: null })).tasks
  const timing = task?.timing
  const [title, setTitle] = useState(task?.title ?? '')
  const [instructions, setInstructions] = useState(task?.instructions ?? '')
  const [doer, setDoer] = useState(task === undefined ? 'nobody' : assigneeKey(task.assignee))
  const [parent, setParent] = useState(task?.parentId ?? parentId ?? '')
  const [choice, setChoice] = useState<TimingChoice>(timing?.kind === 'scheduled' ? 'at' : timing?.kind === 'recurring' ? 'every' : 'none')
  const [at, setAt] = useState(localInput(timing?.kind === 'scheduled' ? timing.at : null))
  const [deadline, setDeadline] = useState(localInput(timing !== undefined && timing.kind !== 'recurring' ? timing.deadline : null))
  const [schedule, setSchedule] = useState<RecurringSchedule>(timing?.kind === 'recurring' ? timing.schedule : { kind: 'daily', time: '09:00' })
  const [remind, setRemind] = useState<number | null>(task?.remind.kind === 'before' ? task.remind.minutes : null)
  const [error, setError] = useState<string>()
  const person = doer.startsWith('member:')
  const canRemind = person && choice !== 'none'
  const timingInput = (): TaskTimingInput => choice === 'at'
    ? { kind: 'scheduled', at: instant(at) ?? Date.now(), deadline: instant(deadline) }
    : choice === 'every' ? { kind: 'recurring', schedule } : { kind: 'unscheduled', deadline: instant(deadline) }
  const remindInput: Remind = canRemind && remind !== null ? { kind: 'before', minutes: remind } : { kind: 'none' }
  const save = async () => {
    if (choice === 'at' && at === '') { setError('Choose when the Task starts.'); return false }
    const assignee = parseAssigneeKey(doer)
    const exit = task === undefined
      ? await command((api) => api.createTask({ title, instructions, assignee, parentId: parent === '' ? null : parent, timing: timingInput(), remind: remindInput } satisfies TaskInput), [keys.tasks, keys.robots])
      : await command((api) => api.updateTask(task.id, { title, instructions, parentId: parent === '' ? null : parent, timing: timingInput(), remind: remindInput }), [keys.tasks, keys.robots])
    let failure = exitFailure(exit)
    if (failure === undefined && task !== undefined && doer !== assigneeKey(task.assignee)) failure = exitFailure(await command((api) => api.assignTask(task.id, assignee), [keys.tasks, keys.robots]))
    setError(failure)
    if (failure === undefined) {
      if (exit._tag === 'Success') onSaved?.(exit.value)
      onClose()
    }
    return failure === undefined
  }
  const segment = (value: TimingChoice, label: string): ReactNode => (
    <button type="button" role="radio" aria-checked={choice === value} className={choice === value ? 'segment active' : 'segment'} onClick={() => setChoice(value)}>{label}</button>
  )
  return (
    <Sheet title={task === undefined ? 'New task' : 'Edit task'} onClose={onClose} footer={<SaveButton onSave={save} disabled={title.trim() === ''} />}>
      <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Instructions<textarea rows={3} value={instructions} placeholder="What the doer is told when it is woken" onChange={(event) => setInstructions(event.target.value)} /></label>
      <label>Doer<select value={doer} onChange={(event) => setDoer(event.target.value)}><AssigneeOptions /></select></label>
      <label>Parent<select value={parent} onChange={(event) => setParent(event.target.value)}>
        <option value="">No parent</option>
        {open.filter((entry) => entry.id !== task?.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
      </select></label>
      <div className="segmented" role="radiogroup" aria-label="When">{segment('none', 'None')}{segment('at', 'At')}{segment('every', 'Every')}</div>
      {choice === 'at' ? <label>Starts<input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} /></label> : null}
      {choice === 'every' ? <ScheduleEditor value={schedule} onChange={setSchedule} /> : null}
      {choice === 'every' ? null : <label>Deadline (optional)<input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>}
      {canRemind ? (
        <label>Remind<select value={remind === null ? '' : String(remind)} onChange={(event) => setRemind(event.target.value === '' ? null : Number(event.target.value))}>
          {REMIND_CHOICES.map((option) => <option key={option.label} value={option.minutes === null ? '' : String(option.minutes)}>{option.label}</option>)}
        </select></label>
      ) : null}
      {error === undefined ? null : <div className="muted" role="alert">{error}</div>}
    </Sheet>
  )
}

/** A recurring rule: every N minutes, daily or weekly at a time, or a cron line. */
function ScheduleEditor({ value, onChange }: { value: RecurringSchedule; onChange: (schedule: RecurringSchedule) => void }) {
  const time = value.kind === 'daily' || value.kind === 'weekly' ? value.time : '09:00'
  return (
    <div className="schedule-editor">
      <label>Repeats<select value={value.kind} onChange={(event) => {
        const kind = event.target.value as RecurringSchedule['kind']
        onChange(kind === 'interval' ? { kind, everyMinutes: 60 } : kind === 'daily' ? { kind, time } : kind === 'weekly' ? { kind, time, weekdays: [1] } : { kind, expression: '0 9 * * 1-5' })
      }}>
        <option value="interval">Every N minutes</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="cron">Cron</option>
      </select></label>
      {value.kind === 'interval' ? <label>Minutes<input type="number" min={5} value={value.everyMinutes} onChange={(event) => onChange({ kind: 'interval', everyMinutes: Number(event.target.value) })} /></label> : null}
      {value.kind === 'daily' || value.kind === 'weekly' ? <label>Time<input type="time" value={value.time} onChange={(event) => onChange({ ...value, time: event.target.value })} /></label> : null}
      {value.kind === 'weekly' ? (
        <div className="weekdays" role="group" aria-label="Weekdays">
          {WEEKDAYS.map((label, index) => {
            const day = index + 1
            const on = value.weekdays.includes(day)
            return <label key={label} className="inline"><input type="checkbox" checked={on} onChange={() => onChange({ ...value, weekdays: on ? value.weekdays.filter((entry) => entry !== day) : [...value.weekdays, day].sort() })} />{label}</label>
          })}
        </div>
      ) : null}
      {value.kind === 'cron' ? <label>Cron<input value={value.expression} onChange={(event) => onChange({ kind: 'cron', expression: event.target.value })} /></label> : null}
    </div>
  )
}
