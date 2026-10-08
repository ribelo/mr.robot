import { Empty as EmptyState, ErrorState } from './components/States.tsx'
import { hostBridge } from './components/ThisComputer.tsx'
import { useEffect, useState, type ReactNode } from 'react'
import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import * as Effect from 'effect/Effect'
import { AsyncResult } from 'effect/reactivity'
import type { Conversation as ConversationData, Me, ProposalView, RobotPanel, RobotSummary } from '@mr-robot/protocol'
import { conversationAtom, keys, meAtom, panelAtom, robotsAtom, useCommand } from './client/api-atoms.ts'
import { exitFailure } from './client/api-failure.ts'
import { robotFeedAtom } from './client/robot-feed.ts'
import { renderResult } from './components/AtomView.tsx'
import { go, useRoute, type Route } from './route.ts'
import { Avatar } from './components/Avatar.tsx'
import { ChatView } from './components/ChatView.tsx'
import { Composer } from './components/Composer.tsx'
import { AskBar } from './components/AskBar.tsx'
import { Panel } from './components/Panel.tsx'
import { RobotList } from './components/RobotList.tsx'
import { Pages } from './pages.tsx'
import { NewRobot } from './components/NewRobot.tsx'
import { EditProfileSheet, RoutineSheet } from './components/RobotSheets.tsx'

export function App() {
  const meResult = useAtomValue(meAtom)
  return <>{renderResult(meResult, { errorTitle: 'Mr. Robot cannot be reached' }, (me) => <SignedIn me={me} />)}</>
}

function SignedIn({ me }: { me: Me }) {
  const route = useRoute()
  const robotsResult = useAtomValue(robotsAtom)
  const refreshRobots = useAtomRefresh(robotsAtom)
  const robots: readonly RobotSummary[] = AsyncResult.getOrElse(robotsResult, () => [])
  const command = useCommand()
  // The desktop app's tray badge follows the list's unread robots (pl-mhyg).
  const unreadCount = robots.filter((robot) => robot.unread).length
  // Re-sent on every list refresh: the app may have counted notifications on top of it meanwhile.
  useEffect(() => { void hostBridge()?.setUnread?.(unreadCount) }, [robots, unreadCount])
  // Robots this person does not have open change too; the list reads again every half minute.
  useEffect(() => {
    const timer = setInterval(refreshRobots, 30_000)
    return () => clearInterval(timer)
  }, [refreshRobots])

  const [creating, setCreating] = useState(false)
  const [sheet, setSheet] = useState<Sheet>()

  const selected = 'id' in route ? route.id : undefined
  const create = () => setCreating(true)
  const created = (id: string) => {
    setCreating(false)
    go({ page: 'robot', id, panel: false })
  }

  return (
    <div className={`app page-${route.page}`}>
      {creating ? <NewRobot onCancel={() => setCreating(false)} onCreated={created} /> : null}
      {sheet?.kind === 'profile' ? (
        <EditProfileSheet
          robotId={sheet.robotId}
          onClose={() => setSheet(undefined)}
          onOpenRoutine={(routine) => setSheet({ kind: 'routine', robotId: sheet.robotId, routineId: routine.id, fromProfile: true })}
        />
      ) : null}
      {sheet?.kind === 'routine' ? (
        <RoutineSheet
          robotId={sheet.robotId}
          routineId={sheet.routineId}
          canEdit={robots.find((entry) => entry.id === sheet.robotId)?.ownerId === me.id}
          onClose={() => setSheet(undefined)}
          {...(sheet.fromProfile ? { onBack: () => setSheet({ kind: 'profile', robotId: sheet.robotId }) } : {})}
        />
      ) : null}
      <RobotList
        robots={robots}
        selected={selected}
        meName={me.name}
        isAdmin={me.role === 'admin'}
        onSelect={(id) => go({ page: 'robot', id, panel: false })}
        onCreate={() => void create()}
        onAdmin={() => go({ page: 'admin' })}
        onProfile={() => go({ page: 'profile' })}
        onListPref={(id, change) => void command((api) => api.listPref(id, change), [keys.robots])}
        onEditProfile={(id) => setSheet({ kind: 'profile', robotId: id })}
        onAdvanced={(id) => go({ page: 'advanced', id })}
        onFiles={(id) => go({ page: 'files', id, path: null })}
        meId={me.id}
        onRemoved={(id, deleted) => { if (deleted && selected === id) go({ page: 'home' }) }}
      />
      <main className="main">
        {route.page === 'robot'
          ? <RobotView key={route.id} route={route} me={me} robot={robots.find((robot) => robot.id === route.id)} onSheet={setSheet} />
          : route.page === 'home'
            ? <Empty />
            : <Pages route={route} me={me} robots={robots} />}
      </main>
    </div>
  )
}

function Empty() {
  return <div className="empty-main"><EmptyState title="Pick a robot" hint="Choose one on the left, or tap + to make a new one." /></div>
}

/** The sheet open over the app: a Robot's profile or one of its Routines. */
type Sheet = { kind: 'profile'; robotId: string } | { kind: 'routine'; robotId: string; routineId: string; fromProfile: boolean }

function RobotView({ route, me, robot, onSheet }: { route: Extract<Route, { page: 'robot' }>; me: Me; robot: RobotSummary | undefined; onSheet: (sheet: Sheet) => void }) {
  const id = route.id
  const details = me.workDetails !== 'compact'
  const conversationResult = useAtomValue(conversationAtom(details ? `${id}|details` : id))
  const panelResult = useAtomValue(panelAtom(id))
  const refreshConversation = useAtomRefresh(conversationAtom(details ? `${id}|details` : id))
  const refreshPanel = useAtomRefresh(panelAtom(id))
  // Subscribing keeps the Robot's live feed open while its conversation is on screen (fe-xp06).
  const feed = AsyncResult.getOrElse(useAtomValue(robotFeedAtom(id)), () => ({ stream: null, changes: 0 }))
  const both = AsyncResult.all([conversationResult, panelResult])
  // Loading and errors fill the main area centred, as before; the conversation lays itself out.
  if (!AsyncResult.isSuccess(both)) return <div className="empty-main">{renderResult(both, { what: 'the conversation', errorTitle: 'This robot cannot be opened', retry: () => { refreshConversation(); refreshPanel() }, back: { label: 'All robots', onClick: () => go({ page: 'home' }) } }, ([conversation, panel]) => (
    <RobotConversation route={route} me={me} robot={robot} conversation={conversation} panel={panel} stream={feed.stream} onSheet={onSheet} />
  ))}</div>
  const [conversation, panel] = both.value
  return <RobotConversation route={route} me={me} robot={robot} conversation={conversation} panel={panel} stream={feed.stream} onSheet={onSheet} />
}

function RobotConversation({ route, me, robot, conversation, panel, stream, onSheet }: {
  route: Extract<Route, { page: 'robot' }>
  me: Me
  robot: RobotSummary | undefined
  conversation: ConversationData
  panel: RobotPanel
  stream: { readonly text: string; readonly thinking: string } | null
  onSheet: (sheet: Sheet) => void
}) {
  const id = route.id
  const command = useCommand()
  const [replyingInstead, setReplyingInstead] = useState(false)
  const [search, setSearch] = useState<{ query: string; index: number }>()
  const [failure, setFailure] = useState<string>()

  useEffect(() => {
    const end = document.querySelector('.chat-scroll')
    end?.scrollTo({ top: end.scrollHeight })
  }, [conversation.items.length, conversation.working, stream?.text.length])

  const answer = async (proposal: ProposalView, approve: boolean) => {
    setFailure(exitFailure(await command((api) => api.answer(id, proposal, approve), [keys.robot(id), keys.robots])))
  }

  // Open asks, oldest first, take the composer's place for the owner (rb-dat4).
  const asks = panel.canEdit ? conversation.items.flatMap((item) => (item.kind === 'question' && item.proposal.status === 'open' ? [item.proposal] : [])) : []
  const identity = robot?.identity ?? panel.summary.identity
  // Search within the conversation (pl-8594): every item's text, newest match first.
  const needle = search?.query.trim().toLowerCase() ?? ''
  const matches = needle === '' ? [] : conversation.items.filter((item) => searchText(item).toLowerCase().includes(needle)).map((item) => item.id).reverse()
  const current = matches.length === 0 || search === undefined ? undefined : matches[Math.min(search.index, matches.length - 1)]
  const jump = (index: number) => {
    setSearch((value) => (value === undefined ? value : { ...value, index }))
    const target = matches[index]
    if (target !== undefined) requestAnimationFrame(() => document.querySelector(`[data-item="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'center' }))
  }
  const header: ReactNode = (
    <header className="conversation-head">
      <button type="button" className="icon-button back" aria-label="Back" onClick={() => go({ page: 'home' })}>‹</button>
      <Avatar color={identity.avatarColor} size={22} />
      <span className="conversation-name">{identity.name}</span>
      {panel.summary.status === 'setup' ? <span className="pill">setup</span> : null}
      {panel.summary.status === 'paused' ? <span className="pill">paused</span> : null}
      {panel.summary.status === 'blocked' ? <span className="pill pill-warn">blocked</span> : null}
      <span className="spacer" />
      {search === undefined
        ? <button type="button" className="icon-button" aria-label="Search this conversation" onClick={() => setSearch({ query: '', index: 0 })}><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></button>
        : (
          <span className="conversation-search">
            <input autoFocus aria-label="Search this conversation" placeholder="Search this conversation" value={search.query}
              onChange={(event) => setSearch({ query: event.target.value, index: 0 })}
              onKeyDown={(event) => { if (event.key === 'Enter') jump(matches.length === 0 ? 0 : (search.index + (event.shiftKey ? matches.length - 1 : 1)) % matches.length); if (event.key === 'Escape') setSearch(undefined) }} />
            <span className="muted">{needle === '' ? '' : matches.length === 0 ? 'none' : `${Math.min(search.index, matches.length - 1) + 1} of ${matches.length}`}</span>
            <button type="button" className="icon-button small" aria-label="Previous match" disabled={matches.length === 0} onClick={() => jump((search.index + 1) % matches.length)}>↑</button>
            <button type="button" className="icon-button small" aria-label="Next match" disabled={matches.length === 0} onClick={() => jump((search.index + matches.length - 1) % matches.length)}>↓</button>
            <button type="button" className="icon-button small" aria-label="Close search" onClick={() => setSearch(undefined)}>×</button>
          </span>
        )}
      {panel.canEdit ? <button type="button" className="head-button" onClick={() => go({ page: 'advanced', id })}>Settings</button> : null}
      <button
        type="button"
        className={route.panel ? 'icon-button active' : 'icon-button'}
        aria-label="Robot panel"
        onClick={() => go({ page: 'robot', id, panel: !route.panel })}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
      </button>
    </header>
  )

  return (
    <div className={route.panel ? 'conversation with-panel' : 'conversation'}>
      <section className="conversation-main">
        {header}
        <div className="chat-scroll">
          {failure === undefined ? null : <div className="retry"><ErrorState title="That did not work" message={failure} /></div>}
          <ChatView items={conversation.items} meId={me.id} robotId={id} {...(current === undefined ? {} : { highlight: current })} working={conversation.working} workDetails={me.workDetails ?? 'compact'} {...(stream === null ? {} : { stream })} {...(conversation.activity === undefined ? {} : { activity: conversation.activity })} canAnswer={panel.canEdit} onAnswer={(proposal, approve) => void answer(proposal, approve)} />
          {conversation.canRetry === true && panel.canEdit && !conversation.working ? (
            <div className="retry">
              <button type="button" className="button" onClick={() => void command((api) => api.retry(id), [keys.robot(id)]).then((exit) => setFailure(exitFailure(exit)))}>Try again</button>
              <button type="button" className="link" onClick={() => go({ page: 'advanced', id })}>Change the model</button>
            </div>
          ) : null}
        </div>
        {asks.length > 0 && !replyingInstead ? (
          <AskBar asks={asks} onAnswer={(proposal, approve) => void answer(proposal, approve)} onReplyInstead={() => setReplyingInstead(true)} />
        ) : (
        <Composer
          placeholder={`Message ${identity.name}`}
          onUpload={async (file) => {
            const bytes = new Uint8Array(await file.arrayBuffer())
            return command((api) => api.upload(id, { name: file.name, type: file.type, bytes }), [keys.files(id)])
          }}
          onSend={async (text, attachments) => {
            const sent = await command((api) => api.send(id, { text, attachments }), [keys.robot(id), keys.robots])
            setReplyingInstead(false)
            return sent
          }}
        />
        )}
      </section>
      {route.panel ? (
        <Panel
          panel={panel}
          onClose={() => go({ page: 'robot', id, panel: false })}
          onOpenRoutine={(routine) => onSheet({ kind: 'routine', robotId: id, routineId: routine, fromProfile: false })}
          onEditProfile={() => onSheet({ kind: 'profile', robotId: id })}
          onOpenScreen={() => go({ page: 'takeover', id })}
          onAdvanced={() => go({ page: 'advanced', id })}
          onTrajectory={() => go({ page: 'trajectory', id })}
          onFiles={() => go({ page: 'files', id, path: null })}
        />
      ) : null}
    </div>
  )
}

/** The words of a chat item a search can find. */
function searchText(item: ConversationData['items'][number]): string {
  switch (item.kind) {
    case 'message': return item.text + ' ' + item.attachments.map((file) => file.name).join(' ')
    case 'reply': case 'notice': case 'thinking': return item.text
    case 'routine': return item.name
    case 'question': return item.proposal.purpose
    default: return ''
  }
}
