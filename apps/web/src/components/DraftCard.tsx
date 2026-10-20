import { Fragment, useState } from 'react'
import { diffWords } from 'diff'
import type { DraftRevision, ProposalView } from '@mr-robot/protocol'
import { Markdown } from './Markdown.tsx'
import type { AskReply } from './ask-reply.ts'
import { AlwaysAllow, statusText, type ChatViewProps } from './ChatView.tsx'

/**
 * A draft (v1.17, dp-si4p): a tool-call Ask of a send tool shown as the message it would send. Recipients, the subject, the body as Markdown and
 * the attachments; Edit turns the body (and an e-mail's subject) into fields, and Send sends exactly what they hold (dp-qbt7). Discard rejects
 * with a reason the Robot reads (dp-wd2q). A revised draft shows the words added and removed against the version before, with its history
 * (dp-o3st). "This Robot sends on its own" raises the Connection's write grant after a confirmation and sends (dp-ef0p).
 */
export function DraftCard({ proposal, canAnswer, onAnswer, onReply }: { proposal: ProposalView; canAnswer: boolean; onAnswer?: ChatViewProps['onAnswer']; onReply?: (proposal: ProposalView, reply: AskReply) => void }) {
  const call = proposal.toolCall!
  const draft = call.draft!
  const open = proposal.status === 'open' && canAnswer
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(draft.body)
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [discarding, setDiscarding] = useState(false)
  const [why, setWhy] = useState('')
  const [confirming, setConfirming] = useState(false)
  const edited = body !== draft.body || (draft.subject !== null && subject !== draft.subject)
  const edit = edited ? { body, ...(draft.subject === null ? {} : { subject }) } : undefined
  const send = (alone: boolean) => onReply?.(proposal, { kind: 'send', ...(edit === undefined ? {} : { edit }), ...(alone ? { alone: true as const } : {}) })
  const previous = draft.revisions.at(-2)
  const latest = draft.revisions.at(-1)
  return (
    <div className="draft-card" data-medium={draft.medium}>
      <dl className="draft-head">
        {draft.recipients.map((entry, index) => <Fragment key={`${entry.label}-${index}`}><dt>{entry.label}</dt><dd>{entry.value}</dd></Fragment>)}
        {draft.subject === null ? null : (
          <>
            <dt>Subject</dt>
            <dd>{editing ? <input className="draft-subject" aria-label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} /> : subject}</dd>
          </>
        )}
      </dl>
      {editing
        ? <textarea className="draft-body-edit" aria-label="Message" rows={Math.min(16, Math.max(5, body.split('\n').length + 1))} value={body} onChange={(event) => setBody(event.target.value)} />
        : <div className="draft-body"><Markdown text={body} /></div>}
      {draft.attachments.length === 0 ? null : <ul className="draft-attachments">{draft.attachments.map((path) => <li key={path}>📎 {path.split('/').pop()}</li>)}</ul>}
      {previous === undefined || latest === undefined ? null : <DraftChanges previous={previous} latest={latest} />}
      {draft.revisions.length === 0 ? null : <DraftHistory revisions={draft.revisions} />}
      <div className="tool-call-reason"><b>Why:</b> {call.reason}</div>
      {call.note === null ? null : <div className="question-purpose">Your note: {call.note}</div>}
      {!open ? <div className="question-status">{proposal.status === 'approved' ? 'Sent' : proposal.status === 'rejected' ? 'Discarded' : statusText(proposal)}</div>
        : discarding ? (
          <>
            <textarea className="tool-call-note" rows={2} value={why} placeholder="Optional: why not, for the Robot" aria-label="Why not" onChange={(event) => setWhy(event.target.value)} />
            <div className="question-actions">
              <button type="button" className="button" onClick={() => setDiscarding(false)}>Keep it</button>
              <button type="button" className="button button-danger" onClick={() => onAnswer?.(proposal, false, undefined, undefined, why.trim() === '' ? undefined : why.trim())}>Discard</button>
            </div>
          </>
        ) : (
          <>
            <div className="question-actions">
              <button type="button" className="button" onClick={() => setDiscarding(true)}>Discard</button>
              <button type="button" className="button" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? 'Preview' : 'Edit'}</button>
              <button type="button" className="button button-primary" onClick={() => send(false)}>Send</button>
            </div>
            {call.alwaysAllow === null ? null : (
              <AlwaysAllow confirming={confirming} onStart={() => setConfirming(true)} onCancel={() => setConfirming(false)} onConfirm={() => send(true)}
                label="This Robot sends on its own" question={`${call.robot} will send with this account without asking you from now on, and this message goes now. You can change it back in its Grants.`} />
            )}
          </>
        )}
    </div>
  )
}

/** The words added and removed between two versions (dp-o3st). */
function DraftChanges({ previous, latest }: { previous: DraftRevision; latest: DraftRevision }) {
  const parts = diffWords(previous.body, latest.body)
  return (
    <div className="draft-changes" aria-label="Changes">
      <div className="muted">Changes from version {previous.seq}{previous.subject !== latest.subject && latest.subject !== null ? ` · subject was "${previous.subject ?? ''}"` : ''}</div>
      <p className="draft-diff">{parts.map((part, index) => part.added ? <ins key={index}>{part.value}</ins> : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</p>
    </div>
  )
}

/** Every version of the draft, oldest first. */
function DraftHistory({ revisions }: { revisions: readonly DraftRevision[] }) {
  return (
    <details className="draft-history">
      <summary>{revisions.length} versions</summary>
      <ol>
        {revisions.map((revision) => (
          <li key={revision.seq}>
            <div className="muted">Version {revision.seq} · {revision.by === 'owner' ? 'you' : 'the Robot'} · {new Date(revision.at).toLocaleString()}</div>
            <pre className="draft-version">{revision.subject === null ? '' : `Subject: ${revision.subject}\n\n`}{revision.body}</pre>
          </li>
        ))}
      </ol>
    </details>
  )
}
