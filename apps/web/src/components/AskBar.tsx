import type { ProposalView } from '@mr-robot/protocol'
import { QuestionCard } from './ChatView.tsx'

/**
 * Pending asks in place of the composer (rb-dat4, rb-f5um): the oldest first, with a count when
 * there are several; "Reply instead" brings the composer back without answering (rb-r0oj).
 */
export function AskBar({ asks, onAnswer, onReplyInstead }: { asks: readonly ProposalView[]; onAnswer: (proposal: ProposalView, approve: boolean) => void; onReplyInstead: () => void }) {
  const current = asks[0]!
  return (
    <div className="ask-bar">
      <QuestionCard proposal={current} canAnswer onAnswer={onAnswer} {...(asks.length > 1 ? { counter: `1/${asks.length}` } : {})} />
      <button type="button" className="link ask-reply" onClick={onReplyInstead}>Reply instead</button>
    </div>
  )
}
