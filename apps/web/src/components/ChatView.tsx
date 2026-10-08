import { Fragment, type ReactNode , useState } from 'react'
import type { ChatItem, ProposalView, WorkDetails } from '@mr-robot/protocol'
import { Markdown } from './Markdown.tsx'
import { ThinkingRow, ToolCards } from './WorkDetails.tsx'
import { separatorTime } from '../time.ts'
import { Avatar } from './Avatar.tsx'

export interface ChatViewProps {
  readonly items: readonly ChatItem[]
  readonly meId: string
  readonly working: boolean
  /** The tool running now, while working. */
  readonly activity?: string
  readonly canAnswer: boolean
  readonly onAnswer?: (proposal: ProposalView, approve: boolean) => void
  readonly now?: number
  /** How much of the Robot's work to show (pl-6eir); Compact by default. */
  readonly workDetails?: WorkDetails
  /** The reply and thinking streaming in now (pl-jzr7). */
  readonly stream?: { readonly text: string; readonly thinking: string }
  /** For attachment links. */
  readonly robotId?: string
  /** The search match to scroll to and mark (pl-8594). */
  readonly highlight?: string
}

const GAP_MS = 60 * 60 * 1000

/** The simple chat view of a Conversation, in the style of the reference screens (robot-q4b2). */
export function ChatView({ items, meId, working, activity, canAnswer, onAnswer, now, workDetails = 'compact', stream, robotId, highlight }: ChatViewProps) {
  const rows: ReactNode[] = []
  let lastAt = 0
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    if (item.at - lastAt > GAP_MS) rows.push(<div key={`t-${item.id}`} className="chat-separator">{separatorTime(item.at, now)}</div>)
    lastAt = item.at
    const previous = items[index - 1]
    if (item.kind === 'message' && item.sender.kind === 'robot' && !(previous?.kind === 'message' && previous.sender.kind === 'robot')) {
      const senders: { name: string; color: string }[] = []
      for (let next = index; next < items.length; next += 1) {
        const candidate = items[next]!
        if (candidate.kind !== 'message' || candidate.sender.kind !== 'robot') break
        if (!senders.some((sender) => sender.name === (candidate.sender as { name: string }).name)) {
          senders.push({ name: candidate.sender.name, color: candidate.sender.avatarColor })
        }
      }
      rows.push(
        <div key={`h-${item.id}`} className="chat-separator" data-testid="robot-messages-header">
          Messages from {senders.map((sender, position) => (
            <Fragment key={sender.name}>
              {position > 0 ? (position === senders.length - 1 ? ' and ' : ', ') : ''}
              <span className="inline-robot"><Avatar color={sender.color} size={14} /> {sender.name}</span>
            </Fragment>
          ))}
        </div>,
      )
    }
    rows.push(<div key={item.id} data-item={item.id} className={highlight === item.id ? 'chat-item search-hit' : 'chat-item'}><Item item={item} meId={meId} canAnswer={canAnswer} level={workDetails} {...(robotId === undefined ? {} : { robotId })} {...(onAnswer === undefined ? {} : { onAnswer })} /></div>)
  }
  const showThinking = workDetails === 'detailed' || workDetails === 'verbose'
  if (working && stream !== undefined && showThinking && stream.thinking !== '') rows.push(<ThinkingRow key="live-thinking" text={stream.thinking} level={workDetails} running={stream.text === ''} />)
  if (working && stream !== undefined && stream.text !== '') {
    rows.push(<div key="live" className="row"><div className="bubble bubble-robot"><Markdown text={stream.text} streaming /></div></div>)
  } else if (working) {
    rows.push(activity === undefined
      ? <div key="working" className="bubble bubble-robot typing" aria-label="working"><span /><span /><span /></div>
      : <div key="working" className="activity-now" aria-label="working"><span className="spinner" /> Using {toolLabel(activity)}…</div>)
  }
  return <div className="chat">{rows}</div>
}

function Item({ item, meId, canAnswer, onAnswer, level, robotId }: { item: ChatItem; meId: string; canAnswer: boolean; onAnswer?: ChatViewProps['onAnswer']; level: WorkDetails; robotId?: string }) {
  switch (item.kind) {
    case 'message': {
      const own = item.sender.kind === 'member' && item.sender.memberId === meId
      const label = item.sender.kind === 'robot'
        ? <span className="inline-robot" style={{ color: item.sender.avatarColor }}><Avatar color={item.sender.avatarColor} size={14} /> {item.sender.name}</span>
        : item.sender.kind === 'member' && !own
          ? <span className="sender">{item.sender.name}</span>
          : item.sender.kind === 'channel'
            ? <span className="sender">{item.sender.channel} · {item.sender.from}</span>
            : null
      return (
        <div className={own ? 'row row-own' : 'row'}>
          <div className={own ? 'bubble bubble-own' : 'bubble bubble-robot'}>
            {label === null ? null : <>{label} </>}
            <RichText text={item.text} />
            {item.attachments.length > 0 ? (
              <div className="attachments">{item.attachments.map((file) => robotId === undefined
                ? <span key={file.path} className="attachment">📎 {file.name}</span>
                : <span key={file.path} className="attachment"><a href={`/api/robots/${encodeURIComponent(robotId)}/raw?path=${encodeURIComponent(file.path)}`} target="_blank" rel="noreferrer">📎 {file.name}</a> <a className="attachment-download" href={`/api/robots/${encodeURIComponent(robotId)}/raw?path=${encodeURIComponent(file.path)}&download=1`} download aria-label={`Download ${file.name}`}>↓</a></span>)}</div>
            ) : null}
          </div>
          {item.reaction === null ? null : <span className="reaction" aria-label={`reacted ${item.reaction}`}>{item.reaction}</span>}
        </div>
      )
    }
    case 'reply':
      return <div className="row"><div className="bubble bubble-robot"><Markdown text={item.text} /></div></div>
    case 'routine':
      return (
        <div className="chat-separator routine-line">
          {item.action === 'ran' ? null : <span>{routineVerb(item.action)} </span>}
          <span className="routine-name"><ClockIcon /> {item.name}</span>
        </div>
      )
    case 'notice':
      return <div className="chat-separator notice">{item.text}</div>
    case 'activity':
      return level === 'compact' || item.calls === undefined ? (item.tools.length === 0 ? null : <ActivityLine tools={item.tools} />) : <ToolCards calls={item.calls} level={level} />
    case 'thinking':
      return level === 'detailed' || level === 'verbose' ? <ThinkingRow text={item.text} level={level} /> : null
    case 'question':
      // The ask itself is answered where the owner types (rb-dat4); the stream keeps one line of it.
      return <div className="chat-separator ask-line" data-status={item.proposal.status}>{`${askTitle(item.proposal)} · ${item.proposal.status === 'open' ? (canAnswer ? 'answer below' : 'waiting for the owner') : statusText(item.proposal.status)}`}</div>
    case 'working':
      return null
  }
}

function routineVerb(action: 'created' | 'updated' | 'deleted' | 'ran'): string {
  return action === 'created' ? 'Created routine' : action === 'updated' ? 'Updated routine' : action === 'deleted' ? 'Deleted routine' : ''
}

export function askTitle(proposal: ProposalView): string {
  return proposal.kind === 'setup' ? 'Approve these Grants to finish setup'
    : proposal.kind === 'grants' ? 'Asks for more Grants'
      : proposal.kind === 'member-file' ? `Proposes an edit to ${proposal.file?.name ?? 'your file'}`
        : proposal.kind === 'skill' ? 'Proposes a skill for the library'
          : 'Needs you'
}

export function QuestionCard({ proposal, canAnswer, onAnswer, counter }: { proposal: ProposalView; canAnswer: boolean; onAnswer?: ChatViewProps['onAnswer']; counter?: string }) {
  const title = askTitle(proposal)
  const grants = proposal.grants
  const lines = grants === null ? [] : [
    ...grants.tools.map((name) => ['Tool', name]),
    ...grants.skills.map((name) => ['Skill', name]),
    ...grants.recipients.map((name) => ['Recipient', name]),
    ...grants.secrets.map((name) => ['Login', name]),
  ]
  return (
    <div className="question" data-status={proposal.status}>
      <div className="question-title">{title}{counter === undefined ? null : <span className="ask-counter">{counter}</span>}</div>
      <div className="question-purpose">{proposal.purpose}</div>
      {lines.length > 0 ? (
        <ul className="grant-list">{lines.map(([kind, name]) => <li key={`${kind}-${name}`}><span className="grant-kind">{kind}</span> {name}</li>)}</ul>
      ) : grants !== null ? <div className="question-purpose">No Grants.</div> : null}
      {proposal.file === null ? null : <pre className="file-preview">{proposal.file.content}</pre>}
      {proposal.skill === null ? null : <div className="question-purpose"><b>{proposal.skill.name}</b>: {proposal.skill.description}</div>}
      {proposal.status === 'open' && canAnswer ? (
        <div className="question-actions">
          <button type="button" className="button" onClick={() => onAnswer?.(proposal, false)}>Reject</button>
          <button type="button" className="button button-primary" onClick={() => onAnswer?.(proposal, true)}>Approve</button>
        </div>
      ) : <div className="question-status">{statusText(proposal.status)}</div>}
    </div>
  )
}

export function statusText(status: ProposalView['status']): string {
  switch (status) {
    case 'open': return 'Waiting for the owner'
    case 'approved': return 'Approved'
    case 'rejected': return 'Rejected'
    case 'superseded': return 'Replaced by a newer proposal'
    case 'done': return 'Done'
  }
}

/** Plain text with **bold**, `code` and line breaks; nothing else is interpreted. */
export function RichText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <span className="rich">
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br /> : null}
          {inline(line)}
        </Fragment>
      ))}
    </span>
  )
}

function inline(line: string): ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <b key={index}>{part.slice(2, -2)}</b>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>
    return <Fragment key={index}>{part}</Fragment>
  })
}

export function ClockIcon() {
  return (
    <svg className="icon-inline" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.6V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** Tool names as people read them. */
export function toolLabel(name: string): string {
  return name === 'code' ? 'a code program' : name.replace(/_/g, ' ')
}

/** The tools of one step, collapsed to one line; tap to see them (robot-gr94). */
function ActivityLine({ tools }: { tools: readonly string[] }) {
  const [open, setOpen] = useState(false)
  const unique = [...new Set(tools)]
  const summary = unique.length <= 2 ? unique.map(toolLabel).join(', ') : `${toolLabel(unique[0]!)} and ${unique.length - 1} more`
  return (
    <div className="activity-line">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Used {summary}</button>
      {open ? <ul>{tools.map((tool, index) => <li key={index}>{toolLabel(tool)}</li>)}</ul> : null}
    </div>
  )
}
