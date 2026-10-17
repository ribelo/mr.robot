/**
 * Mr. Robot in a side drawer of Mission Control (v1.13 ticket 08, mc-n4dd): the Member's chief's Conversation in
 * compact Work details with its Composer, so a Task is typed in words ("add a task: call mum on Friday at six").
 * When his Turn ends, Mission Control reads its tables again.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { Me, RobotSummary } from '@mr-robot/protocol'
import { conversationAtom, keys, useCommand } from '../client/api-atoms.ts'
import { robotFeedAtom } from '../client/robot-feed.ts'
import { renderResult } from './AtomView.tsx'
import { Avatar } from './Avatar.tsx'
import { ChatScroll } from './ChatScroll.tsx'
import { ChatView } from './ChatView.tsx'
import { Composer } from './Composer.tsx'
import { usePendingSends, type OutgoingMessage } from './use-pending-sends.ts'

export function MrRobotDrawer({ me, chief, onTurnEnded }: { me: Me; chief: RobotSummary; onTurnEnded: () => void }) {
  const id = chief.id
  const command = useCommand()
  const result = useAtomValue(conversationAtom(id))
  // Subscribing keeps the chief's live feed open while the drawer is open.
  const feed = AsyncResult.getOrElse(useAtomValue(robotFeedAtom(id)), () => ({ stream: null, changes: 0 }))
  const items = AsyncResult.isSuccess(result) ? result.value.items : []
  const working = AsyncResult.isSuccess(result) && result.value.working
  const post = useCallback((message: OutgoingMessage) => command((api) => api.send(id, message), [keys.robot(id), keys.robots]), [command, id])
  const outgoing = usePendingSends(items, me.id, post)
  const [sent, setSent] = useState(0)
  // A Turn of Mr. Robot just ended: what he did shows in the tables (mc-n4dd).
  const wasWorking = useRef(working)
  useEffect(() => {
    if (wasWorking.current && !working) onTurnEnded()
    wasWorking.current = working
  }, [working, onTurnEnded])
  return (
    <aside className="mission-drawer" aria-label={chief.identity.name}>
      <header className="conversation-head">
        <Avatar seed={chief.identity.avatarSeed} color={chief.identity.avatarColor} size={22} state={chief.fleetState} />
        <span className="conversation-name">{chief.identity.name}</span>
      </header>
      {renderResult(result, { what: 'the conversation' }, (conversation) => (
        <ChatScroll itemCount={conversation.items.length + outgoing.pending.length} pinSignal={sent} growth={(feed.stream?.text.length ?? 0) + (conversation.working ? 1 : 0)}>
          {(scrollRef, following) => (
            <ChatView robotColor={chief.identity.avatarColor} items={conversation.items} meId={me.id} robotId={id} scrollRef={scrollRef} following={following} working={conversation.working}
              workDetails="compact" canAnswer={false} pending={outgoing.pending} onRetry={outgoing.retry}
              {...(feed.stream === null ? {} : { stream: feed.stream })} {...(conversation.activity === undefined ? {} : { activity: conversation.activity })} />
          )}
        </ChatScroll>
      ))}
      <Composer
        placeholder={`Message ${chief.identity.name}`}
        onUpload={async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer())
          return command((api) => api.upload(id, { name: file.name, type: file.type, bytes }), [keys.files(id)])
        }}
        onSend={(text, attachments) => { outgoing.send(text, attachments); setSent((count) => count + 1) }}
      />
    </aside>
  )
}
