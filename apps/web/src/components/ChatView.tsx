import { Fragment, type ReactNode, type RefObject, useEffect, useMemo, useState } from 'react'
import { useMeasuredRows, useRowWindow } from './row-window.ts'
import type { Attachment, ChatItem, GrantLevels, ProposalView, TaskAction, ThreadEvent, ThreadView, ToolCallDetail, WorkDetails } from '@mr-robot/protocol'
import { Markdown } from './Markdown.tsx'
import { ThinkingRow, ToolCards } from './WorkDetails.tsx'
import { separatorTime } from '../time.ts'
import { Avatar } from './Avatar.tsx'
import { FOLLOW_THRESHOLD_PX } from './ChatScroll.tsx'
import type { PendingSend } from './pending-sends.ts'
import { robotTint } from './tint.ts'
import { href } from '../route.ts'
import type { AskReply } from './ask-reply.ts'
import { DraftCard } from './DraftCard.tsx'
import { PageCard } from './PageList.tsx'

export interface ChatViewProps {
  readonly items: readonly ChatItem[]
  readonly meId: string
  readonly working: boolean
  /** The tool running now, while working. */
  readonly activity?: string
  readonly canAnswer: boolean
  /** note: a tool-call Ask's optional text from the owner (why a call was rejected). */
  readonly onAnswer?: (proposal: ProposalView, approve: boolean, approved?: readonly string[], scope?: string, note?: string) => void
  /** The owner's text for a request for help, also after Mr. Robot answered it (sk-q86i). */
  readonly onHelp?: (proposal: ProposalView, text: string) => void
  /** The owner's answer to a question or a credential request (v1.15). */
  readonly onReply?: (proposal: ProposalView, reply: AskReply) => void
  readonly now?: number
  /** How much of the Robot's work to show (pl-6eir); Compact by default. */
  readonly workDetails?: WorkDetails
  /** At Code: the page's calls read in full from the log, by call id (cw-sc3z). */
  readonly callDetails?: ReadonlyMap<string, ToolCallDetail>
  /** The reply and thinking streaming in now (pl-jzr7). */
  readonly stream?: { readonly text: string; readonly thinking: string }
  /** Messages sent but not yet in the Conversation, shown after its items (ap-3si6). */
  readonly pending?: readonly PendingSend[]
  /** The colour of the Robot whose Conversation this is: its replies are tinted with it (ap-yzs4). */
  readonly robotColor?: string
  /** Send a failed message again with the same client id (ap-ceqx). */
  readonly onRetry?: (clientId: string) => void
  /** For attachment links. */
  readonly robotId?: string
  /** The search match to scroll to and mark (pl-8594). */
  readonly highlight?: string
  /** The scrolling element around the chat; long conversations render only the rows in view (fe-3ckb). */
  readonly scrollRef?: RefObject<HTMLElement | null>
  /** Whether the view follows the end (ChatScroll decides); without it the row window decides by distance alone. */
  readonly following?: RefObject<boolean>
}

/** Conversations longer than this render through the row window. */
const WINDOW_THRESHOLD = 80
const ESTIMATED_ROW_PX = 64
const ROW_GAP_PX = 8

const GAP_MS = 60 * 60 * 1000

/** The simple chat view of a Conversation, in the style of the reference screens (robot-q4b2). */
export function ChatView({ items, meId, working, activity, canAnswer, onAnswer, onHelp, onReply, now, workDetails = 'compact', callDetails, stream, robotId, highlight, scrollRef, following, pending = [], onRetry, robotColor }: ChatViewProps) {
  const rows: ReactNode[] = []
  let lastAt = 0
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    if (item.at - lastAt > GAP_MS) rows.push(<div key={`t-${item.id}`} className="chat-separator">{separatorTime(item.at, now)}</div>)
    lastAt = item.at
    const previous = items[index - 1]
    if (item.kind === 'message' && item.sender.kind === 'robot' && !(previous?.kind === 'message' && previous.sender.kind === 'robot')) {
      const senders: { name: string; color: string; seed: string }[] = []
      for (let next = index; next < items.length; next += 1) {
        const candidate = items[next]!
        if (candidate.kind !== 'message' || candidate.sender.kind !== 'robot') break
        if (!senders.some((sender) => sender.name === (candidate.sender as { name: string }).name)) {
          senders.push({ name: candidate.sender.name, color: candidate.sender.avatarColor, seed: candidate.sender.avatarSeed })
        }
      }
      rows.push(
        <div key={`h-${item.id}`} className="chat-separator" data-testid="robot-messages-header">
          Messages from {senders.map((sender, position) => (
            <Fragment key={sender.name}>
              {position > 0 ? (position === senders.length - 1 ? ' and ' : ', ') : ''}
              <span className="inline-robot"><Avatar seed={sender.seed} color={sender.color} size={14} /> {sender.name}</span>
            </Fragment>
          ))}
        </div>,
      )
    }
    rows.push(<div key={item.id} data-item={item.id} className={highlight === item.id ? 'chat-item search-hit' : 'chat-item'}><Item item={item} meId={meId} robotColor={robotColor} canAnswer={canAnswer} level={workDetails} details={callDetails} {...(robotId === undefined ? {} : { robotId })} {...(onAnswer === undefined ? {} : { onAnswer })} {...(onHelp === undefined ? {} : { onHelp })} {...(onReply === undefined ? {} : { onReply })} /></div>)
  }
  for (const send of pending) rows.push(<PendingBubble key={`pending-${send.clientId}`} send={send} {...(onRetry === undefined ? {} : { onRetry })} />)
  const showThinking = workDetails === 'detailed' || workDetails === 'verbose'
  if (working && stream !== undefined && showThinking && stream.thinking !== '') rows.push(<ThinkingRow key="live-thinking" text={stream.thinking} level={workDetails} running={stream.text === ''} />)
  if (working && stream !== undefined && stream.text !== '') {
    rows.push(<div key="live" className="row"><div className="bubble bubble-robot" style={robotTint(robotColor)}><Markdown text={stream.text} streaming /></div></div>)
  } else if (working) {
    rows.push(activity === undefined
      ? <div key="working" className="bubble bubble-robot typing" style={robotTint(robotColor)} aria-label="working"><span /><span /><span /></div>
      : <div key="working" className="activity-now" aria-label="working"><span className="spinner" /> Using {toolLabel(activity)}…</div>)
  }
  return <ChatRows rows={rows} highlight={highlight} {...(scrollRef === undefined ? {} : { scrollRef })} {...(following === undefined ? {} : { following })} />
}

/** The rows, all of them for a short conversation, the rows in view for a long one (fe-3ckb). */
function ChatRows({ rows, highlight, scrollRef, following }: { rows: ReactNode[]; highlight: string | undefined; scrollRef?: RefObject<HTMLElement | null>; following?: RefObject<boolean> }) {
  const keys = useMemo(() => rows.map((row, index) => String((row as { key?: string | null }).key ?? index)), [rows])
  const windowed = scrollRef !== undefined && rows.length > WINDOW_THRESHOLD
  const measured = useMeasuredRows(windowed ? keys : [], ESTIMATED_ROW_PX)
  const rowWindow = useRowWindow({
    rows: measured.rows,
    scrollElement: scrollRef ?? { current: null },
    enabled: windowed,
    overscan: 6,
    margin: 0,
    initialViewport: 900,
    followThreshold: FOLLOW_THRESHOLD_PX,
    ...(following === undefined ? {} : { following }),
  })
  // A search match far up the conversation is brought into view, then outlined (pl-8594).
  useEffect(() => {
    if (highlight === undefined) return
    const index = keys.indexOf(highlight)
    if (index === -1) return
    if (windowed) rowWindow.scrollToIndex(index, { align: 'center', behavior: 'auto' })
    // The window renders the target after the scroll event; centre it exactly once it is in the page.
    const timer = setTimeout(() => document.querySelector(`[data-item="${CSS.escape(highlight)}"]`)?.scrollIntoView({ block: 'center' }), 80)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump once per new match
  }, [highlight])
  if (!windowed) return <div className="chat">{rows}</div>
  const { start, end } = rowWindow.range
  return (
    <div className="chat chat-windowed" style={{ paddingTop: rowWindow.paddingTop, paddingBottom: rowWindow.paddingBottom }}>
      {rows.slice(start, end).map((row, offset) => {
        const index = start + offset
        const key = keys[index]!
        return <div key={key} ref={measured.measure(key)} className="chat-cell" style={index === 0 ? undefined : { paddingTop: ROW_GAP_PX }}>{row}</div>
      })}
    </div>
  )
}

/** A message not in the Conversation yet: a clock instead of a time while pending, "Not sent" with the error and Retry when refused (ap-7b3p, ap-ceqx). */
function PendingBubble({ send, onRetry }: { send: PendingSend; onRetry?: (clientId: string) => void }) {
  return (
    <div className={send.state === 'failed' ? 'row row-own pending-send failed' : 'row row-own pending-send'} data-state={send.state}>
      <div className="bubble bubble-own">
        <RichText text={send.text} />
        {send.attachments.length > 0 ? <div className="attachments">{send.attachments.map((file) => <span key={file.path} className="attachment">📎 {file.name}</span>)}</div> : null}
      </div>
      {send.state === 'pending'
        ? <span className="pending-mark" role="img" aria-label="sending"><ClockIcon /></span>
        : (
          <span className="pending-mark failed" role="alert">
            Not sent{send.error === undefined ? '' : `: ${send.error}`}
            {onRetry === undefined ? null : <> <button type="button" className="link" onClick={() => onRetry(send.clientId)}>Retry</button></>}
          </span>
        )}
    </div>
  )
}

function Item({ item, meId, canAnswer, onAnswer, onHelp, onReply, level, details, robotId, robotColor }: { robotColor: string | undefined; item: ChatItem; meId: string; canAnswer: boolean; onAnswer?: ChatViewProps['onAnswer']; onHelp?: ChatViewProps['onHelp']; onReply?: ChatViewProps['onReply']; level: WorkDetails; details?: ReadonlyMap<string, ToolCallDetail> | undefined; robotId?: string }) {
  switch (item.kind) {
    case 'message': {
      const own = item.sender.kind === 'member' && item.sender.memberId === meId
      const label = item.sender.kind === 'robot'
        ? <span className="inline-robot" style={{ color: item.sender.avatarColor }}><Avatar seed={item.sender.avatarSeed} color={item.sender.avatarColor} size={14} /> {item.sender.name}</span>
        : item.sender.kind === 'member' && !own
          ? <span className="sender">{item.sender.name}</span>
          : item.sender.kind === 'channel'
            ? <span className="sender">{item.sender.channel} · {item.sender.from}</span>
            : null
      return (
        <div className={own ? 'row row-own' : 'row'}>
          <div className={own ? 'bubble bubble-own' : 'bubble bubble-robot'} style={item.sender.kind === 'robot' ? robotTint(item.sender.avatarColor) : undefined}>
            {label === null ? null : <>{label} </>}
            {item.thread === undefined ? null : <span className="thread-tag muted">in Thread “{item.thread.topic}”</span>}
            {item.question === true ? <span className="thread-tag muted">question</span> : null}
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
      return <div className="row"><div className="bubble bubble-robot" style={robotTint(robotColor)}><Markdown text={item.text} />{item.attachments === undefined || item.attachments.length === 0 ? null : <ReplyAttachments attachments={item.attachments} {...(robotId === undefined ? {} : { robotId })} />}</div></div>
    case 'task':
      return (
        <div className="chat-separator task-line">
          {item.action === 'ran' ? null : <span>{item.by === undefined ? taskVerb(item.action) : `Task ${item.action} by ${item.by}`} </span>}
          <span className="task-name"><ClockIcon /> {item.title}</span>
        </div>
      )
    case 'notice':
      return <div className="chat-separator notice">{item.text}</div>
    case 'thread':
      return <ThreadCard thread={item.thread} event={item.event} />
    case 'activity':
      return level === 'compact' || item.calls === undefined ? (item.tools.length === 0 ? null : <ActivityLine tools={item.tools} />) : <ToolCards calls={item.calls} level={level} details={details} />
    case 'thinking':
      return level === 'detailed' || level === 'verbose' ? <ThinkingRow text={item.text} level={level} /> : null
    case 'proposal':
      // The ask itself is answered where the owner types (rb-dat4); the stream keeps one line of it.
      // An answered request for help stays whole, so the Conversation holds the exchange.
      // The owner may still answer after Mr. Robot did, from this card (sk-q86i).
      if (item.proposal.kind === 'help' && item.proposal.status !== 'open') return <QuestionCard proposal={item.proposal} canAnswer={canAnswer} {...(onHelp === undefined ? {} : { onHelp })} />
      // A question the owner has answered keeps its answer in the Conversation (v1.15).
      if ((item.proposal.kind === 'question' || item.proposal.kind === 'credential') && item.proposal.status !== 'open') return <QuestionCard proposal={item.proposal} canAnswer={false} />
      // A sent or discarded draft stays readable as the message it was (v1.17).
      if (item.proposal.toolCall?.draft != null && item.proposal.status !== 'open') return <QuestionCard proposal={item.proposal} canAnswer={false} />
      return <div className="chat-separator ask-line" data-status={item.proposal.status}>{`${askTitle(item.proposal)} · ${item.proposal.status === 'open' ? (canAnswer ? 'answer below' : 'waiting for the owner') : statusText(item.proposal)}`}</div>
    case 'working':
      return null
    case 'delegation':
      return <DelegationCard item={item} {...(robotId === undefined ? {} : { robotId })} />
  }
}

/**
 * The files a say handed over (v1.15, gb-ekga): an image inside the message, any other file as a card to open or download.
 * A stored screenshot has the path `screen:<name>`; a Workspace file its path.
 */
export function ReplyAttachments({ attachments, robotId }: { attachments: readonly Attachment[]; robotId?: string }) {
  const url = (file: Attachment, download = false) => file.path.startsWith('screen:')
    ? `/api/robots/${encodeURIComponent(robotId ?? '')}/attachments/${encodeURIComponent(file.path)}`
    : `/api/robots/${encodeURIComponent(robotId ?? '')}/raw?path=${encodeURIComponent(file.path)}${download ? '&download=1' : ''}`
  return (
    <div className="attachments reply-attachments">
      {attachments.map((file) => robotId === undefined
        ? <span key={file.path} className="attachment">📎 {file.name}</span>
        : file.page !== undefined
          ? <PageCard key={file.path} robotId={robotId} path={file.path} title={file.page.title} excerpt={file.page.excerpt} />
        : file.contentType.startsWith('image/')
          ? <a key={file.path} className="reply-image-link" href={url(file)} target="_blank" rel="noreferrer"><img className="reply-image" src={url(file)} alt={file.name} loading="lazy" /></a>
          : (
            <span key={file.path} className="attachment file-card">
              <a href={url(file)} target="_blank" rel="noreferrer">📎 {file.name}</a> <small className="muted">{formatSize(file.size)}</small>{' '}
              <a className="attachment-download" href={url(file, true)} download aria-label={`Download ${file.name}`}>↓</a>
            </span>
          ))}
    </div>
  )
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const DELEGATION_STATES: Record<Extract<ChatItem, { kind: 'delegation' }>['status'], string> = { running: 'working', done: 'done', interrupted: 'interrupted', failed: 'failed', archived: 'archived' }

/** One delegation to a Subagent (ao-15ui), in the family of the Task cards: label, model, state, first line of its report. */
export function DelegationCard({ item, robotId }: { item: Extract<ChatItem, { kind: 'delegation' }>; robotId?: string }) {
  const body = (
    <>
      <span className="task-name">{item.mode === 'fork' ? 'Forked' : 'Delegated'}: {item.label}</span>
      <span className="muted"> · {item.model === null ? '' : `${item.model.model} · `}{DELEGATION_STATES[item.status]}</span>
      {item.result === null ? null : <span className="delegation-result">{item.result}</span>}
    </>
  )
  return (
    <div className="chat-separator delegation-line" data-status={item.status} aria-label={`Subagent ${item.label}`}>
      {robotId === undefined ? body : <a href={href({ page: 'subagent', id: robotId, child: item.subagentId, tab: 'chat' })}>{body}</a>}
    </div>
  )
}


function taskVerb(action: TaskAction): string {
  switch (action) {
    case 'created': return 'Created task'
    case 'updated': return 'Updated task'
    case 'assigned': return 'Assigned task'
    case 'done': return 'Done'
    case 'cancelled': return 'Cancelled task'
    case 'paused': return 'Paused task'
    case 'resumed': return 'Resumed task'
    case 'ran': return ''
  }
}

export function askTitle(proposal: ProposalView): string {
  return proposal.kind === 'setup' ? 'Approve these Grants to finish setup'
    : proposal.kind === 'grants' ? 'Asks for more Grants'
      : proposal.kind === 'member-file' ? `Proposes an edit to ${proposal.file?.name ?? 'your file'}`
        : proposal.kind === 'skill' ? 'Proposes a skill for the library'
          : proposal.kind === 'review' ? `Review: ${proposal.review?.title ?? proposal.purpose}`
            : proposal.kind === 'help' ? (proposal.help?.urgent === true ? 'Asks for help (urgent)' : 'Asks for help')
            : proposal.kind === 'tool-call' && proposal.toolCall?.draft != null ? `${proposal.toolCall.robot} wrote ${proposal.toolCall.draft.medium === 'email' ? 'an e-mail' : 'a message'} for you to check`
            : proposal.kind === 'tool-call' ? `${proposal.toolCall?.robot ?? 'The Robot'} wants to use ${proposal.toolCall?.tool ?? 'a tool'}`
            : proposal.kind === 'question' ? (proposal.question?.urgent === true ? `Urgent: ${proposal.question.prompt}` : proposal.question?.prompt ?? 'A question')
            : proposal.kind === 'credential' ? `Asks for ${proposal.credential?.credential === 'secret' ? 'a secret' : 'a login'} for ${proposal.credential?.service ?? 'a service'}`
            : proposal.kind === 'thread' ? (proposal.thread?.phase === 'continue' ? 'Go on with the Thread?' : proposal.thread?.phase === 'invitation-out' ? 'Invite to a Thread' : 'Thread invitation')
              : 'Needs you'
}

export function QuestionCard({ proposal, canAnswer, onAnswer, onHelp, onReply, counter }: { proposal: ProposalView; canAnswer: boolean; onAnswer?: ChatViewProps['onAnswer']; onHelp?: (proposal: ProposalView, text: string) => void; onReply?: (proposal: ProposalView, reply: AskReply) => void; counter?: string }) {
  const title = askTitle(proposal)
  const grants = proposal.grants
  // Each item with its level (sk-746n); allow is the plain case.
  const items = (kind: string, levels: GrantLevels) => Object.entries(levels).map(([name, level]) => [kind, level === 'allow' ? name : `${name} (${level === 'ask' ? 'ask each time' : 'deny'})`] as const)
  const lines = grants === null ? [] : [
    ...items('Tool', grants.tools),
    ...items('Skill', grants.skills),
    ...items('Recipient', grants.recipients),
    ...items('Login', grants.secrets),
    ...items('Host', grants.hosts),
    ...items('Connection', grants.connections),
    ...(proposal.requiresHosts === true ? [['Setting', 'do not run while any of my Hosts is offline'] as const] : []),
  ]
  return (
    <div className="question" data-status={proposal.status}>
      <div className="question-title">{title}{counter === undefined ? null : <span className="ask-counter">{counter}</span>}</div>
      {proposal.help === undefined && proposal.toolCall === undefined && proposal.question === undefined && proposal.credential === undefined ? <div className="question-purpose">{proposal.purpose}</div> : null}
      {proposal.question === undefined ? null : <QuestionAnswerPanel key={`${proposal.id}:${proposal.revision}`} proposal={proposal} canAnswer={canAnswer} {...(onReply === undefined ? {} : { onReply })} />}
      {proposal.credential === undefined ? null : <CredentialForm key={`${proposal.id}:${proposal.revision}`} proposal={proposal} canAnswer={canAnswer} {...(onReply === undefined ? {} : { onReply })} />}
      {proposal.toolCall?.draft == null ? null : <DraftCard key={`${proposal.id}:${proposal.revision}`} proposal={proposal} canAnswer={canAnswer} {...(onAnswer === undefined ? {} : { onAnswer })} {...(onReply === undefined ? {} : { onReply })} />}
      {proposal.toolCall === undefined || proposal.toolCall.draft !== null ? null : <ToolCallAnswer key={`${proposal.id}:${proposal.revision}`} proposal={proposal} canAnswer={canAnswer} {...(onAnswer === undefined ? {} : { onAnswer })} {...(onReply === undefined ? {} : { onReply })} />}
      {proposal.help === undefined ? null : <HelpAnswer key={`${proposal.id}:${proposal.revision}`} proposal={proposal} canAnswer={canAnswer} {...(onHelp === undefined ? {} : { onHelp })} />}
      {lines.length > 0 ? (
        <ul className="grant-list">{lines.map(([kind, name]) => <li key={`${kind}-${name}`}><span className="grant-kind">{kind}</span> {name}</li>)}</ul>
      ) : grants !== null ? <div className="question-purpose">No Grants.</div> : null}
      {proposal.file === null ? null : <pre className="file-preview">{proposal.file.content}</pre>}
      {proposal.review === undefined ? null : <ReviewItems key={`${proposal.id}:${proposal.revision}`} proposal={proposal} canAnswer={canAnswer} {...(onAnswer === undefined ? {} : { onAnswer })} />}
      {proposal.skill === null ? null : <div className="question-purpose"><b>{proposal.skill.name}</b>: {proposal.skill.description}</div>}
      {proposal.thread !== undefined ? <ThreadAnswer key={`${proposal.id}:${proposal.revision}`} proposal={proposal} canAnswer={canAnswer} {...(onAnswer === undefined ? {} : { onAnswer })} /> : null}
      {proposal.help !== undefined || proposal.toolCall !== undefined || proposal.question !== undefined || proposal.credential !== undefined ? null : proposal.thread !== undefined ? null : proposal.review !== undefined ? (proposal.status === 'open' && canAnswer ? null : <div className="question-status">{statusText(proposal)}</div>)
      : proposal.status === 'open' && canAnswer ? (
        <div className="question-actions">
          <button type="button" className="button" onClick={() => onAnswer?.(proposal, false)}>Reject</button>
          <button type="button" className="button button-primary" onClick={() => onAnswer?.(proposal, true)}>Approve</button>
        </div>
      ) : <div className="question-status">{statusText(proposal)}</div>}
    </div>
  )
}

/**
 * A question Ask (v1.15, gb-k88x): the prompt and its help, one button per option (primary and danger styles, the description under its label),
 * a text field when the Robot allows the owner's own words, and Dismiss. Answered, it says what was chosen.
 */
function QuestionAnswerPanel({ proposal, canAnswer, onReply }: { proposal: ProposalView; canAnswer: boolean; onReply?: (proposal: ProposalView, reply: AskReply) => void }) {
  const question = proposal.question!
  const open = proposal.status === 'open' && canAnswer
  const [text, setText] = useState('')
  const answer = question.answer
  return (
    <>
      <div className="question-prompt">{question.prompt}</div>
      {question.help === null ? null : <div className="question-purpose">{question.help}</div>}
      {open && question.multiSelect ? <MultiSelectPanel proposal={proposal} {...(onReply === undefined ? {} : { onReply })} /> : open ? (
        <>
          <div className="question-options">
            {question.options.map((option) => (
              <button key={option.value} type="button" className={option.style === 'primary' ? 'button button-primary question-option' : option.style === 'danger' ? 'button button-danger question-option' : 'button question-option'} onClick={() => onReply?.(proposal, { kind: 'option', value: option.value })}>
                <span>{option.label}</span>
                {option.description === null ? null : <small className="muted">{option.description}</small>}
              </button>
            ))}
          </div>
          {question.allowCustom ? (
            <div className="question-custom">
              <input value={text} placeholder="Or write your own answer" aria-label="Your own answer" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && text.trim() !== '') onReply?.(proposal, { kind: 'custom', text: text.trim() }) }} />
              <button type="button" className="button" disabled={text.trim() === ''} onClick={() => onReply?.(proposal, { kind: 'custom', text: text.trim() })}>Send</button>
            </div>
          ) : null}
          <div className="question-actions"><button type="button" className="link" onClick={() => onReply?.(proposal, { kind: 'dismiss' })}>Dismiss</button></div>
        </>
      ) : answer === null ? <div className="question-status">{statusText(proposal)}</div> : (
        <div className="question-status">{answer.kind === 'option' ? `You chose: ${answer.label}` : answer.kind === 'selected' ? `You chose: ${answer.selected.map((option) => option.label).join(', ')}${answer.text === null ? '' : ` · ${answer.text}`}` : answer.kind === 'custom' ? `You answered: ${answer.text}` : answer.reason === 'moved-on' ? 'Dismissed: you moved on' : 'Dismissed'}</div>
      )}
    </>
  )
}

/** A multi-select question (v1.17, dp-53uq): a checkbox per option, the owner's own words alongside when allowed, Submit and Dismiss. */
function MultiSelectPanel({ proposal, onReply }: { proposal: ProposalView; onReply?: (proposal: ProposalView, reply: AskReply) => void }) {
  const question = proposal.question!
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const [text, setText] = useState('')
  const toggle = (value: string) => setChosen((current) => {
    const next = new Set(current)
    if (!next.delete(value)) next.add(value)
    return next
  })
  const words = text.trim()
  const values = question.options.filter((option) => chosen.has(option.value)).map((option) => option.value)
  return (
    <>
      <ul className="question-checks">
        {question.options.map((option) => (
          <li key={option.value}>
            <label className="check"><input type="checkbox" checked={chosen.has(option.value)} onChange={() => toggle(option.value)} /><span>{option.label}</span></label>
            {option.description === null ? null : <small className="muted">{option.description}</small>}
          </li>
        ))}
      </ul>
      {question.allowCustom ? <input className="question-custom-text" value={text} placeholder="Add your own words (optional)" aria-label="Your own answer" onChange={(event) => setText(event.target.value)} /> : null}
      <div className="question-actions">
        <button type="button" className="link" onClick={() => onReply?.(proposal, { kind: 'dismiss' })}>Dismiss</button>
        <button type="button" className="button button-primary" disabled={values.length === 0 && words === ''} onClick={() => onReply?.(proposal, { kind: 'options', values, ...(words === '' ? {} : { text: words }) })}>Submit</button>
      </div>
    </>
  )
}

/** "mBank online" → "mbank-online": a name the owner can keep or change (login names use letters, digits, ".", "_" and "-"). */
export function entryNameFor(service: string): string {
  return service.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

/**
 * A credential Ask (v1.15, gb-1g9w): the Login entry form, or the secret form, pre-filled with what the Robot gave. Saving creates the entry
 * under the owner, grants it to the Robot and wakes it; the password is sent once, to the Space. Decline refuses.
 */
function CredentialForm({ proposal, canAnswer, onReply }: { proposal: ProposalView; canAnswer: boolean; onReply?: (proposal: ProposalView, reply: AskReply) => void }) {
  const ask = proposal.credential!
  const login = ask.credential === 'login'
  const open = proposal.status === 'open' && canAnswer
  const [name, setName] = useState(entryNameFor(ask.service))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [websites, setWebsites] = useState(ask.websites.join(', '))
  const [notes, setNotes] = useState(ask.scope === null ? '' : `Allowed: ${ask.scope}`)
  const [shared, setShared] = useState(false)
  const ready = name.trim() !== '' && password !== ''
  return (
    <>
      <div className="question-purpose"><b>{ask.service}</b>: {ask.why}</div>
      {ask.scope === null ? null : <div className="question-purpose">For: {ask.scope}</div>}
      {open ? (
        <form className="credential-form" onSubmit={(event) => { event.preventDefault(); if (ready) onReply?.(proposal, { kind: 'save', entry: { name: name.trim(), username: login ? username.trim() : '', password, websites: login ? websites.split(/[,\n]/).map((site) => site.trim()).filter((site) => site !== '') : [], notes, allowRead: !login, shared } }) }}>
          <label>Name<input value={name} aria-label="Entry name" onChange={(event) => setName(event.target.value)} /></label>
          {login ? <label>Username<input value={username} autoComplete="off" aria-label="Username" onChange={(event) => setUsername(event.target.value)} /></label> : null}
          <label>{login ? 'Password' : 'Value'}<input type="password" value={password} autoComplete="off" aria-label={login ? 'Password' : 'Value'} onChange={(event) => setPassword(event.target.value)} /></label>
          {login ? <label>Websites<input value={websites} aria-label="Websites" onChange={(event) => setWebsites(event.target.value)} /></label> : null}
          <label>Notes<input value={notes} aria-label="Notes" onChange={(event) => setNotes(event.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /><span>Share with the Space</span></label>
          <div className="question-actions">
            <button type="button" className="button" onClick={() => onReply?.(proposal, { kind: 'decline' })}>Decline</button>
            <button type="submit" className="button button-primary" disabled={!ready}>Save and give access</button>
          </div>
        </form>
      ) : <div className="question-status">{ask.entry !== null ? `Saved as ${ask.entry} and given to the Robot` : ask.declined ? 'Declined' : statusText(proposal)}</div>}
    </>
  )
}

/** Longer argument values are cut in the card; the full value is in its title. */
const ARGUMENT_SHOWN = 240

/**
 * A tool-call Ask (sk-hx8j): the tool, its arguments one per line (long values cut, secrets already masked by
 * the server), the Robot's reason, and Approve or Reject with an optional text the Robot gets with the answer.
 */
function ToolCallAnswer({ proposal, canAnswer, onAnswer, onReply }: { proposal: ProposalView; canAnswer: boolean; onAnswer?: ChatViewProps['onAnswer']; onReply?: (proposal: ProposalView, reply: AskReply) => void }) {
  const call = proposal.toolCall!
  const open = proposal.status === 'open' && canAnswer
  const [note, setNote] = useState('')
  const text = note.trim()
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      {call.arguments.length === 0 ? <div className="question-purpose">No arguments.</div> : (
        <dl className="tool-call-args">
          {call.arguments.map((argument) => (
            <Fragment key={argument.name}>
              <dt>{argument.name}</dt>
              <dd {...(argument.value.length > ARGUMENT_SHOWN ? { title: argument.value } : {})}>{argument.value.length > ARGUMENT_SHOWN ? `${argument.value.slice(0, ARGUMENT_SHOWN)}…` : argument.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      <div className="tool-call-reason"><b>Why:</b> {call.reason}</div>
      {call.note === null ? null : <div className="question-purpose">Your note: {call.note}</div>}
      {open ? (
        <>
          <textarea className="tool-call-note" rows={2} value={note} placeholder="Optional: a note or why not" aria-label="Note for the Robot" onChange={(event) => setNote(event.target.value)} />
          <div className="question-actions">
            <button type="button" className="button" onClick={() => onAnswer?.(proposal, false, undefined, undefined, text === '' ? undefined : text)}>Reject</button>
            <button type="button" className="button button-primary" onClick={() => onAnswer?.(proposal, true, undefined, undefined, text === '' ? undefined : text)}>Approve</button>
          </div>
          {call.alwaysAllow === null || onReply === undefined ? null : (
            <AlwaysAllow confirming={confirming} onStart={() => setConfirming(true)} onCancel={() => setConfirming(false)} onConfirm={() => onReply(proposal, { kind: 'always-allow' })}
              question={`${call.robot} will use ${toolLabel(call.tool)} without asking you from now on, and this call runs now. You can change it back in its Grants.`} label="Always allow this" />
          )}
        </>
      ) : <div className="question-status">{statusText(proposal)}</div>}
    </>
  )
}

/** A standing yes in two steps (dp-u9z9, dp-ef0p): the button, then a confirmation that says what changes. */
export function AlwaysAllow({ confirming, onStart, onCancel, onConfirm, question, label }: { confirming: boolean; onStart: () => void; onCancel: () => void; onConfirm: () => void; question: string; label: string }) {
  if (!confirming) return <div className="question-actions always-allow"><button type="button" className="link" onClick={onStart}>{label}</button></div>
  return (
    <div className="always-allow-confirm" role="group" aria-label="Confirm">
      <div className="question-purpose">{question}</div>
      <div className="question-actions">
        <button type="button" className="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="button button-primary" onClick={onConfirm}>Yes, {label.charAt(0).toLowerCase()}{label.slice(1)}</button>
      </div>
    </div>
  )
}

/**
 * A help Ask (sk-fcr1): what the Robot is doing, tried and needs, with a text box for the owner's answer.
 * Answered, it shows the answer and who gave it.
 */
function HelpAnswer({ proposal, canAnswer, onHelp }: { proposal: ProposalView; canAnswer: boolean; onHelp?: (proposal: ProposalView, text: string) => void }) {
  const help = proposal.help!
  const open = proposal.status === 'open' && canAnswer
  // Mr. Robot answered first: the owner may answer once more, and that answer overrides his (sk-q86i).
  const overriding = proposal.status === 'done' && help.answeredBy === 'mr-robot' && help.override === null && canAnswer
  const [text, setText] = useState('')
  return (
    <>
      <dl className="help-request">
        <dt>Doing</dt><dd>{help.doing}</dd>
        <dt>Tried</dt><dd>{help.tried}</dd>
        <dt>Needs</dt><dd>{help.need}</dd>
      </dl>
      {help.urgent && help.answer === null ? <div className="help-urgent">Urgent</div> : null}
      {help.escalated && help.answer === null ? <div className="help-escalated">Mr. Robot has been asked</div> : null}
      {help.answer !== null ? <div className="help-answer"><b>{help.answeredBy === 'mr-robot' ? 'Mr. Robot answered' : 'You answered'}:</b> {help.answer}</div> : null}
      {help.override === null ? null : <div className="help-answer"><b>You answered afterwards:</b> {help.override}</div>}
      {open || overriding ? (
        <>
          <textarea className="help-text" rows={3} value={text} placeholder={overriding ? 'Your answer replaces Mr. Robot’s' : 'Your answer'} aria-label="Your answer" onChange={(event) => setText(event.target.value)} />
          <div className="question-actions">
            <button type="button" className="button button-primary" disabled={text.trim() === ''} onClick={() => onHelp?.(proposal, text.trim())}>Send</button>
          </div>
        </>
      ) : help.answer === null ? <div className="question-status">{statusText(proposal)}</div> : null}
    </>
  )
}

/**
 * A Thread Ask (ch-vrl7, ch-hikl, ch-408z): an invitation comes with a scope the owner edits before accepting,
 * and the edited text is what the answer carries. Going on after 20 messages needs no scope.
 */
function ThreadAnswer({ proposal, canAnswer, onAnswer }: { proposal: ProposalView; canAnswer: boolean; onAnswer?: ChatViewProps['onAnswer'] }) {
  const thread = proposal.thread!
  const invitation = thread.phase !== 'continue'
  const open = proposal.status === 'open' && canAnswer
  const [scope, setScope] = useState(thread.scope)
  return (
    <>
      {!invitation ? null : open ? (
        <label className="thread-scope">In this Thread you may use:
          <textarea rows={3} value={scope} placeholder="Nothing, unless you name it here" onChange={(event) => setScope(event.target.value)} />
        </label>
      ) : <div className="question-purpose">In this Thread your chief may use: {thread.scope.trim() === '' ? 'nothing' : thread.scope}</div>}
      {open ? (
        <div className="question-actions">
          <button type="button" className="button" onClick={() => onAnswer?.(proposal, false)}>{invitation ? 'Decline' : 'Stop'}</button>
          <button type="button" className="button button-primary" onClick={() => (invitation ? onAnswer?.(proposal, true, undefined, scope) : onAnswer?.(proposal, true))}>{invitation ? 'Accept' : 'Go on'}</button>
        </div>
      ) : <div className="question-status">{statusText(proposal)}</div>}
    </>
  )
}

const THREAD_EVENT: Record<ThreadEvent, string> = {
  opened: 'Thread opened', declined: 'Thread declined', closed: 'Thread closed', idle: 'Thread closed after 7 days without a message',
  expired: 'Invitation expired after 7 days without both answers', gone: 'Thread ended: the other chief is no longer in the Space',
}
const THREAD_STATE: Record<ThreadView['state'], string> = { invited: 'Invited', open: 'Open', closed: 'Closed', declined: 'Declined' }

/** The Thread card (ch-iy16, ch-6fcp): topic, the other chief, state and message count. */
export function ThreadCard({ thread, event }: { thread: ThreadView; event?: ThreadEvent }) {
  return (
    <div className="thread-card" data-state={thread.state}>
      {event === undefined ? null : <div className="thread-event muted">{THREAD_EVENT[event]}</div>}
      <div className="thread-topic">{thread.topic}</div>
      <div className="muted">with {thread.other.label}</div>
      <div className="thread-meta"><span className="thread-state">{THREAD_STATE[thread.state]}</span> · {thread.messageCount} {thread.messageCount === 1 ? 'message' : 'messages'}</div>
      {thread.summary === null ? null : <div className="thread-summary">{thread.summary}</div>}
    </div>
  )
}

/**
 * A review Ask (cd-ueft): per-item checkboxes and three actions, answered as one. Decided, it lists the
 * outcome per item. Keyed by proposal, so a selection never carries over to the next Ask.
 */
function ReviewItems({ proposal, canAnswer, onAnswer }: { proposal: ProposalView; canAnswer: boolean; onAnswer?: ChatViewProps['onAnswer'] }) {
  const review = proposal.review!
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const open = proposal.status === 'open' && canAnswer
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  return (
    <>
      <ul className="review-list">
        {review.items.map((item) => {
          const decided = review.decision === undefined ? undefined : review.decision.approved.includes(item.id) ? 'approved' : 'rejected'
          return (
            <li key={item.id} className="review-item" {...(decided === undefined ? {} : { 'data-decision': decided })}>
              {open ? <label><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} /> <b>{item.title}</b></label> : <span><b>{item.title}</b>{decided === undefined ? '' : ` · ${decided}`}</span>}
              {item.action === undefined ? null : <span className="review-action"> [{item.action}]</span>}
              <div className="question-purpose review-body">{item.body}</div>
            </li>
          )
        })}
      </ul>
      {open ? (
        <div className="question-actions">
          <button type="button" className="button" onClick={() => onAnswer?.(proposal, false)}>Reject</button>
          <button type="button" className="button" disabled={selected.size === 0} onClick={() => onAnswer?.(proposal, true, review.items.filter((item) => selected.has(item.id)).map((item) => item.id))}>Approve selected</button>
          <button type="button" className="button button-primary" onClick={() => onAnswer?.(proposal, true, review.items.map((item) => item.id))}>Approve all</button>
        </div>
      ) : null}
    </>
  )
}

/** The status line of an Ask; a decided review shows its counts (cd-ueft). */
export function statusText(proposal: ProposalView): string {
  const decision = proposal.review?.decision
  if (decision !== undefined) return `${decision.approved.length} approved, ${decision.rejected.length} rejected`
  switch (proposal.status) {
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
