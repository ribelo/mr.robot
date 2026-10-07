import { useRef } from 'react'
import type { ProposalView } from '@mr-robot/protocol'
import { QuestionCard } from './ChatView.tsx'

/**
 * Pending asks in place of the composer (rb-dat4, rb-f5um): the oldest first, counted within the
 * batch (1/2, then 2/2); "Reply instead" brings the composer back without answering (rb-r0oj).
 */
export function AskBar({ asks, onAnswer, onReplyInstead }: { asks: readonly ProposalView[]; onAnswer: (proposal: ProposalView, approve: boolean) => void; onReplyInstead: () => void }) {
  const batch = useRef(new Set<string>())
  for (const ask of asks) batch.current.add(ask.id)
  const current = asks[0]!
  const total = batch.current.size
  const position = total - asks.length + 1
  return (
    <div className="ask-bar">
      <QuestionCard proposal={current} canAnswer onAnswer={onAnswer} {...(total > 1 ? { counter: `${position}/${total}` } : {})} />
      <button type="button" className="link ask-reply" onClick={onReplyInstead}>Reply instead</button>
    </div>
  )
}
