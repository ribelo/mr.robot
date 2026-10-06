import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Conversation as ConversationData, Me, ProposalView, RobotPanel, RobotSummary } from '@mr-robot/protocol'
import { api, ApiError } from './api.ts'
import { useLive } from './live.ts'
import { go, useRoute, type Route } from './route.ts'
import { Avatar } from './components/Avatar.tsx'
import { ChatView } from './components/ChatView.tsx'
import { Composer } from './components/Composer.tsx'
import { Panel } from './components/Panel.tsx'
import { RobotList } from './components/RobotList.tsx'
import { Pages } from './pages.tsx'
import { NewRobot } from './components/NewRobot.tsx'
import { EditProfileSheet, RoutineSheet } from './components/RobotSheets.tsx'

export function App() {
  const route = useRoute()
  const [me, setMe] = useState<Me>()
  const [robots, setRobots] = useState<RobotSummary[]>([])
  const [error, setError] = useState<string>()

  const refreshRobots = useCallback(() => api.robots().then(setRobots).catch(() => undefined), [])
  useEffect(() => {
    api.me().then(setMe, (cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'cannot reach Mr. Robot'))
    void refreshRobots()
    const timer = setInterval(() => void refreshRobots(), 30_000)
    return () => clearInterval(timer)
  }, [refreshRobots])

  const [creating, setCreating] = useState(false)
  const [sheet, setSheet] = useState<Sheet>()
  const [sheetVersion, setSheetVersion] = useState(0)

  if (error !== undefined) return <div className="fatal">{error}</div>
  if (me === undefined) return <div className="fatal">Loading…</div>

  const selected = 'id' in route ? route.id : undefined
  const create = () => setCreating(true)
  const created = async (id: string) => {
    setCreating(false)
    await refreshRobots()
    go({ page: 'robot', id, panel: false })
  }

  return (
    <div className={`app page-${route.page}`}>
      {creating ? <NewRobot onCancel={() => setCreating(false)} onCreated={(id) => void created(id)} /> : null}
      {sheet?.kind === 'profile' ? (
        <EditProfileSheet
          robotId={sheet.robotId}
          onClose={() => setSheet(undefined)}
          onChanged={() => { void refreshRobots(); setSheetVersion((version) => version + 1) }}
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
          onChanged={() => { void refreshRobots(); setSheetVersion((version) => version + 1) }}
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
        onListPref={(id, change) => void api.listPref(id, change).then(refreshRobots)}
        onEditProfile={(id) => setSheet({ kind: 'profile', robotId: id })}
      />
      <main className="main">
        {route.page === 'robot'
          ? <RobotView key={`${route.id}-${sheetVersion}`} route={route} me={me} robot={robots.find((robot) => robot.id === route.id)} onChanged={refreshRobots} onSheet={setSheet} />
          : route.page === 'home'
            ? <Empty />
            : <Pages route={route} me={me} robots={robots} onChanged={refreshRobots} />}
      </main>
    </div>
  )
}

function Empty() {
  return <div className="empty-main">Pick a robot, or tap + to make a new one.</div>
}

/** The sheet open over the app: a Robot's profile or one of its Routines. */
type Sheet = { kind: 'profile'; robotId: string } | { kind: 'routine'; robotId: string; routineId: string; fromProfile: boolean }

function RobotView({ route, me, robot, onChanged, onSheet }: { route: Extract<Route, { page: 'robot' }>; me: Me; robot: RobotSummary | undefined; onChanged: () => void; onSheet: (sheet: Sheet) => void }) {
  const [conversation, setConversation] = useState<ConversationData>()
  const [panel, setPanel] = useState<RobotPanel>()
  const [failure, setFailure] = useState<string>()
  const id = route.id

  const refresh = useCallback(async () => {
    try {
      const [nextConversation, nextPanel] = await Promise.all([api.conversation(id), api.panel(id)])
      setConversation(nextConversation)
      setPanel(nextPanel)
      setFailure(undefined)
    } catch (cause) {
      setFailure(cause instanceof ApiError ? cause.message : 'cannot load this robot')
    }
  }, [id])

  useEffect(() => { void refresh() }, [refresh])
  useLive(id, () => { void refresh(); onChanged() })

  useEffect(() => {
    const end = document.querySelector('.chat-scroll')
    end?.scrollTo({ top: end.scrollHeight })
  }, [conversation?.items.length, conversation?.working])

  if (failure !== undefined) return <div className="empty-main">{failure}</div>
  if (conversation === undefined || panel === undefined) return <div className="empty-main">Loading…</div>

  const answer = async (proposal: ProposalView, approve: boolean) => {
    try {
      await api.answer(id, proposal, approve)
    } catch (cause) {
      alert(cause instanceof ApiError ? cause.message : 'could not answer')
    }
    await refresh()
  }

  const identity = robot?.identity ?? panel.summary.identity
  const header: ReactNode = (
    <header className="conversation-head">
      <button type="button" className="icon-button back" aria-label="Back" onClick={() => go({ page: 'home' })}>‹</button>
      <Avatar color={identity.avatarColor} size={22} />
      <span className="conversation-name">{identity.name}</span>
      {panel.summary.status === 'setup' ? <span className="pill">setup</span> : null}
      {panel.summary.status === 'paused' ? <span className="pill">paused</span> : null}
      {panel.summary.status === 'blocked' ? <span className="pill pill-warn">blocked</span> : null}
      <span className="spacer" />
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
          <ChatView items={conversation.items} meId={me.id} working={conversation.working} {...(conversation.activity === undefined ? {} : { activity: conversation.activity })} canAnswer={panel.canEdit} onAnswer={(proposal, approve) => void answer(proposal, approve)} />
          {conversation.canRetry === true && panel.canEdit && !conversation.working ? (
            <div className="retry">
              <button type="button" className="button" onClick={() => void api.retry(id).then(refresh)}>Try again</button>
              <button type="button" className="link" onClick={() => go({ page: 'advanced', id })}>Change the model</button>
            </div>
          ) : null}
        </div>
        <Composer
          placeholder={`Message ${identity.name}`}
          onUpload={(file) => api.upload(id, file)}
          onSend={async (text, attachments) => {
            await api.send(id, { text, attachments })
            await refresh()
          }}
        />
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
        />
      ) : null}
    </div>
  )
}
