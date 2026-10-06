import { useState } from 'react'
import type { RewindView, Trajectory, TrajectoryEvent } from '@mr-robot/protocol'

export interface TrajectoryViewProps {
  readonly trajectory: Trajectory
  readonly canRewind: boolean
  readonly onRewind: (atSeq: number) => void
  readonly onUndo: (rewind: RewindView) => void
}

/** The full Trajectory of a Conversation (robot-h5v3) with rewind and undo (robot-0q6a, robot-8v1t). */
export function TrajectoryView({ trajectory, canRewind, onRewind, onUndo }: TrajectoryViewProps) {
  const latest = [...trajectory.rewinds].reverse().find((rewind) => !rewind.undone && rewind.liveSessionId === trajectory.sessionId)
  const groups = groupByTurn(trajectory.events)
  return (
    <div className="trajectory">
      {latest === undefined ? null : (
        <div className="question">
          <div className="question-title">Rewound</div>
          <div className="question-purpose">This Conversation was rewound {new Date(latest.at).toLocaleString()}. The previous log is in the archive.</div>
          {canRewind ? <div className="question-actions"><button type="button" className="button" onClick={() => onUndo(latest)}>Undo rewind</button></div> : null}
        </div>
      )}
      {groups.map((group) => (
        <section key={`${group.turn}-${group.events[0]?.seq}`}>
          <div className="turn-head">{group.turn === null ? 'Between turns' : `Turn ${group.turn}`}</div>
          {group.events.map((event) => <EventRow key={event.seq} event={event} canRewind={canRewind} onRewind={onRewind} />)}
        </section>
      ))}
    </div>
  )
}

function EventRow({ event, canRewind, onRewind }: { event: TrajectoryEvent; canRewind: boolean; onRewind: (atSeq: number) => void }) {
  const [open, setOpen] = useState(false)
  const data = parse(event.data)
  const summary = summarize(event.type, data)
  const isMemberMessage = event.type === 'user/message' && (data as { source?: { kind?: string } }).source?.kind === 'member'
  return (
    <div className="event" data-type={event.type}>
      <div className="event-head">
        <span className="muted">#{event.seq}</span>
        <button type="button" className="event-type" onClick={() => setOpen(!open)}>{event.type}</button>
        <span className="muted">{summary}</span>
        <span className="spacer" />
        {canRewind && isMemberMessage && event.seq > 0
          ? <button type="button" className="link" onClick={() => onRewind(event.seq - 1)}>Rewind to before this</button>
          : null}
      </div>
      {open ? <pre>{JSON.stringify(data, null, 2)}</pre> : null}
    </div>
  )
}

function groupByTurn(events: readonly TrajectoryEvent[]): { turn: number | null; events: TrajectoryEvent[] }[] {
  const groups: { turn: number | null; events: TrajectoryEvent[] }[] = []
  for (const event of events) {
    const last = groups.at(-1)
    if (last !== undefined && last.turn === event.turn) last.events.push(event)
    else groups.push({ turn: event.turn, events: [event] })
  }
  return groups
}

function parse(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

function summarize(type: string, data: unknown): string {
  const value = data as Record<string, unknown>
  switch (type) {
    case 'user/message': return text((value as { content?: unknown }).content).slice(0, 120)
    case 'assistant/message': return text((value['message'] as { content?: unknown } | undefined)?.content).slice(0, 120)
    case 'tool/call': return `${String(value['name'])}(${String(value['arguments'] ?? '').slice(0, 100)})`
    case 'tool/result': return text((value['message'] as { content?: unknown } | undefined)?.content).slice(0, 120)
    default: return ''
  }
}

function text(content: unknown): string {
  return Array.isArray(content) ? content.map((block) => (typeof block?.text === 'string' ? block.text : block?.type === 'tool-call' ? `→ ${block.name}` : '')).join(' ') : ''
}
