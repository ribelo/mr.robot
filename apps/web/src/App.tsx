import { Empty as EmptyState, ErrorState } from './components/States.tsx'
import { hostBridge } from './components/ThisComputer.tsx'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import * as Effect from 'effect/Effect'
import { AsyncResult } from 'effect/reactivity'
import type { Conversation as ConversationData, Me, ProposalView, RobotGroup, RobotPanel, RobotSummary } from '@mr-robot/protocol'
import { conversationAtom, groupsAtom, keys, meAtom, panelAtom, robotsAtom, useCommand } from './client/api-atoms.ts'
import { exitFailure } from './client/api-failure.ts'
import { robotFeedAtom } from './client/robot-feed.ts'
import { renderResult } from './components/AtomView.tsx'
import { go, goBack, useRoute, type Route } from './route.ts'
import { Avatar } from './components/Avatar.tsx'
import { ChatView } from './components/ChatView.tsx'
import { Composer } from './components/Composer.tsx'
import { ChatScroll } from './components/ChatScroll.tsx'
import { usePendingSends, type OutgoingMessage } from './components/use-pending-sends.ts'
import { AskBar } from './components/AskBar.tsx'
import type { AskReply } from './components/ask-reply.ts'
import { Panel } from './components/Panel.tsx'
import { RobotList, type GroupChange } from './components/RobotList.tsx'
import type { SaveOutcome } from './components/SaveButton.tsx'
import { Pages } from './pages.tsx'
import { applyTheme } from './theme/theme.ts'
import { NewRobot } from './components/NewRobot.tsx'
import { EditProfileSheet } from './components/RobotSheets.tsx'
import { TaskSheet } from './components/TaskSheets.tsx'
import { SubagentsControl } from './components/SubagentsControl.tsx'

export function App() {
  const meResult = useAtomValue(meAtom)
  return <>{renderResult(meResult, { errorTitle: 'Mr. Robot cannot be reached' }, (me) => <SignedIn me={me} />)}</>
}

function SignedIn({ me }: { me: Me }) {
  const route = useRoute()
  const robotsResult = useAtomValue(robotsAtom)
  const refreshRobots = useAtomRefresh(robotsAtom)
  const robots: readonly RobotSummary[] = AsyncResult.getOrElse(robotsResult, () => [])
  const groups = AsyncResult.getOrElse(useAtomValue(groupsAtom), () => NO_GROUPS)
  const command = useCommand()
  // The Member's stored theme wins over this device's remembered one (ap-itj1).
  useEffect(() => { applyTheme(me.theme ?? 'system') }, [me.theme])
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
          onOpenTask={(task) => setSheet({ kind: 'task', taskId: task.id, fromProfile: sheet.robotId })}
        />
      ) : null}
      {sheet?.kind === 'task' ? (
        <TaskSheet
          taskId={sheet.taskId}
          onClose={() => setSheet(undefined)}
          onOpenTask={(taskId) => setSheet({ ...sheet, taskId })}
          {...(sheet.fromProfile === null ? {} : { onBack: () => setSheet({ kind: 'profile', robotId: sheet.fromProfile! }) })}
        />
      ) : null}
      <RobotList
        robots={robots}
        groups={groups}
        selected={selected}
        meName={me.name}
        meAvatar={me.avatar}
        isAdmin={me.role === 'admin'}
        onSelect={(id) => go({ page: 'robot', id, panel: false })}
        onCreate={() => void create()}
        onAdmin={() => go({ page: 'admin' })}
        onProfile={() => go({ page: 'profile' })}
        onListPref={(id, change) => void command((api) => api.listPref(id, change), [keys.robots])}
        onGroupChange={(change) => changeGroups(command, change)}
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

/** One empty list while the groups load, so the sidebar sees the same value on every render. */
const NO_GROUPS: readonly RobotGroup[] = []

/** A sidebar group change through the API (ux-wxbm, ux-o7po, ux-xbvi); the robot list reads again when Robots change group. */
function changeGroups(command: ReturnType<typeof useCommand>, change: GroupChange): Promise<SaveOutcome> {
  switch (change.kind) {
    case 'create': {
      const { name, robotId } = change
      return command((api) => robotId === undefined
        ? api.createGroup(name)
        : api.createGroup(name).pipe(Effect.flatMap((group) => api.listPref(robotId, { group: { kind: 'group', groupId: group.id }, hidden: false }))), [keys.groups, keys.robots])
    }
    case 'rename': return command((api) => api.updateGroup(change.id, { name: change.name }), [keys.groups])
    case 'collapse': return command((api) => api.updateGroup(change.id, { collapsed: change.collapsed }), [keys.groups])
    case 'order': return command((api) => api.orderGroups(change.ids), [keys.groups])
    case 'delete': return command((api) => api.deleteGroup(change.id), [keys.groups, keys.robots])
  }
}

function Empty() {
  return (
    <div className="empty-main">
      <EmptyState title="Pick a robot" hint="Choose one on the left, or tap + to make a new one."
        action={<button type="button" className="button" onClick={() => go({ page: 'mission' })}>Open Mission Control</button>} />
    </div>
  )
}

/** The sheet open over the app: a Robot's profile, or a Task (opened from that profile, or from the panel). */
type Sheet = { kind: 'profile'; robotId: string } | { kind: 'task'; taskId: string; fromProfile: string | null }

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

export function RobotConversation({ route, me, robot, conversation, panel, stream, onSheet }: {
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
  const [sentCount, setSentCount] = useState(0)
  const post = useCallback((message: OutgoingMessage) => command((api) => api.send(id, message), [keys.robot(id), keys.robots]), [command, id])
  const outgoing = usePendingSends(conversation.items, me.id, post)
  const answerHelp = async (proposal: ProposalView, text: string) => {
    setFailure(exitFailure(await command((api) => api.answerHelp(id, proposal, text), [keys.robot(id), keys.robots])))
  }
  const reply = async (proposal: ProposalView, answered: AskReply) => {
    setFailure(exitFailure(await command((api) => answered.kind === 'save' ? api.saveCredential(id, proposal, answered.entry)
      : answered.kind === 'decline' ? api.answer(id, proposal, false)
        : api.choose(id, proposal, answered.kind === 'option' ? { value: answered.value } : answered.kind === 'options' ? { values: answered.values, ...(answered.text === undefined ? {} : { text: answered.text }) } : answered.kind === 'custom' ? { text: answered.text } : { dismiss: true }), [keys.robot(id), keys.robots, keys.secrets])))
  }
  const answer = async (proposal: ProposalView, approve: boolean, approved?: readonly string[], scope?: string, note?: string) => {
    setFailure(exitFailure(await command((api) => api.answer(id, proposal, approve, approved, scope, note), [keys.robot(id), keys.robots])))
  }

  // Open asks, oldest first, take the composer's place for the owner (rb-dat4).
  const asks = panel.canEdit ? conversation.items.flatMap((item) => (item.kind === 'proposal' && item.proposal.status === 'open' ? [item.proposal] : [])) : []
  const identity = robot?.identity ?? panel.summary.identity
  // Search within the conversation (pl-8594): every item's text, newest match first.
  const needle = search?.query.trim().toLowerCase() ?? ''
  const matches = needle === '' ? [] : conversation.items.filter((item) => searchText(item).toLowerCase().includes(needle)).map((item) => item.id).reverse()
  const current = matches.length === 0 || search === undefined ? undefined : matches[Math.min(search.index, matches.length - 1)]
  const jump = (index: number) => {
    setSearch((value) => (value === undefined ? value : { ...value, index }))
    const target = matches[index]
  }
  const header: ReactNode = (
    <header className="conversation-head">
      <button type="button" className="icon-button back" aria-label="Back" onClick={() => goBack(route.from === 'mission' ? { page: 'mission' } : { page: 'home' })}>‹</button>
      <Avatar seed={identity.avatarSeed} color={identity.avatarColor} size={22} state={robot?.fleetState ?? panel.summary.fleetState} />
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
      <SubagentsControl robotId={id} />
      {panel.canEdit ? <button type="button" className="head-button" onClick={() => go({ page: 'advanced', id })}>Settings</button> : null}
      <button
        type="button"
        className={route.panel ? 'icon-button active' : 'icon-button'}
        aria-label="Robot panel"
        onClick={() => go({ page: 'robot', id, panel: !route.panel, ...(route.from === undefined ? {} : { from: route.from }) })}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
      </button>
    </header>
  )

  return (
    <div className={route.panel ? 'conversation with-panel' : 'conversation'}>
      <section className="conversation-main">
        {header}
        <ChatScroll itemCount={conversation.items.length + outgoing.pending.length} pinSignal={sentCount} growth={(stream?.text.length ?? 0) + (stream?.thinking.length ?? 0) + (conversation.working ? 1 : 0)}>
          {(scrollRef, following) => (<>
          {failure === undefined ? null : <div className="retry"><ErrorState title="That did not work" message={failure} /></div>}
          <ChatView robotColor={identity.avatarColor} items={conversation.items} meId={me.id} robotId={id} scrollRef={scrollRef} following={following} {...(current === undefined ? {} : { highlight: current })} working={conversation.working} workDetails={me.workDetails ?? 'compact'} {...(stream === null ? {} : { stream })} {...(conversation.activity === undefined ? {} : { activity: conversation.activity })} canAnswer={panel.canEdit} onAnswer={(proposal, approve, approved, scope, note) => void answer(proposal, approve, approved, scope, note)} onHelp={(proposal, text) => void answerHelp(proposal, text)} pending={outgoing.pending} onRetry={outgoing.retry} />
          {conversation.canRetry === true && panel.canEdit && !conversation.working ? (
            <div className="retry">
              <button type="button" className="button" onClick={() => void command((api) => api.retry(id), [keys.robot(id)]).then((exit) => setFailure(exitFailure(exit)))}>Try again</button>
              <button type="button" className="link" onClick={() => go({ page: 'advanced', id })}>Change the model</button>
            </div>
          ) : null}
          </>)}
        </ChatScroll>
        {asks.length > 0 && !replyingInstead ? (
          <AskBar asks={asks} onAnswer={(proposal, approve, approved, scope, note) => void answer(proposal, approve, approved, scope, note)} onHelp={(proposal, text) => void answerHelp(proposal, text)} onReply={(proposal, answered) => void reply(proposal, answered)} onReplyInstead={() => setReplyingInstead(true)} />
        ) : (
        <Composer
          placeholder={`Message ${identity.name}`}
          onUpload={async (file) => {
            const bytes = new Uint8Array(await file.arrayBuffer())
            return command((api) => api.upload(id, { name: file.name, type: file.type, bytes }), [keys.files(id)])
          }}
          onSend={(text, attachments, followup) => {
            outgoing.send(text, attachments, followup)
            setReplyingInstead(false)
            setSentCount((count) => count + 1)
          }}
        />
        )}
      </section>
      {route.panel ? (
        <Panel
          panel={panel}
          onClose={() => go({ page: 'robot', id, panel: false })}
          onOpenTask={(taskId) => onSheet({ kind: 'task', taskId, fromProfile: null })}
          onEditProfile={() => onSheet({ kind: 'profile', robotId: id })}
          onOpenScreen={() => go({ page: 'takeover', id })}
          onAdvanced={() => go({ page: 'advanced', id })}
          onTrajectory={() => go({ page: 'trajectory', id })}
          onFiles={() => go({ page: 'files', id, path: null })}
          onOpenHelp={() => go({ page: 'robot', id, panel: false })}
          onStopBox={() => void command((api) => api.stopBox(id), [keys.robot(id)])}
          onStopJob={(jobId) => void command((api) => api.stopBoxJob(id, jobId), [keys.robot(id)])}
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
    case 'task': return item.title
    case 'proposal': return item.proposal.purpose
    case 'thread': return item.thread.topic
    default: return ''
  }
}
