import { lazy, Suspense } from 'react'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { Me, RobotSummary, SubagentView } from '@mr-robot/protocol'
import { keys, subagentConversationAtom, subagentsAtom, useCommand } from '../client/api-atoms.ts'
import { robotFeedAtom } from '../client/robot-feed.ts'
import { go, goBack } from '../route.ts'
import { AtomView } from './AtomView.tsx'
import { ChatView } from './ChatView.tsx'

const RobotTrajectory = lazy(() => import('../dsh/RobotTrajectory.tsx').then((module) => ({ default: module.RobotTrajectory })))

const STATES: Record<SubagentView['status'], string> = { running: 'working', done: 'done', interrupted: 'interrupted', failed: 'failed', archived: 'archived' }

/**
 * A Subagent's own Chat and Trajectory (ao-ce55): the owner watches and stops it here, and talks only to its
 * Robot, so there is no composer.
 */
export function SubagentPage({ robotId, child, tab, robot, me }: { robotId: string; child: string; tab: 'chat' | 'trajectory'; robot: RobotSummary | undefined; me: Me }) {
  const command = useCommand()
  const list = AsyncResult.getOrElse(useAtomValue(subagentsAtom(robotId)), () => [] as readonly SubagentView[])
  const view = list.find((entry) => entry.id === child)
  const liveVersion = AsyncResult.getOrElse(useAtomValue(robotFeedAtom(robotId)), () => ({ changes: 0 })).changes
  return (
    <div className="page page-wide subagent-page">
      <h1>
        <button type="button" className="icon-button" aria-label="Back" onClick={() => goBack({ page: 'robot', id: robotId, panel: false })}>‹</button>
        {view?.label ?? 'Subagent'} <span className="muted">· Subagent of {robot?.identity.name ?? 'its Robot'}</span>
      </h1>
      <div className="question-actions">
        <span className="muted">{view === undefined ? '' : `${view.model.model} · ${STATES[view.status]}${view.activity === null ? '' : ` · ${view.activity}`}`}</span>
        <span className="spacer" />
        <div role="tablist" aria-label="Subagent view">
          <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'head-button active' : 'head-button'} onClick={() => go({ page: 'subagent', id: robotId, child, tab: 'chat' })}>Chat</button>
          <button type="button" role="tab" aria-selected={tab === 'trajectory'} className={tab === 'trajectory' ? 'head-button active' : 'head-button'} onClick={() => go({ page: 'subagent', id: robotId, child, tab: 'trajectory' })}>Trajectory</button>
        </div>
        {view?.status === 'running' ? <button type="button" className="button button-danger" onClick={() => void command((api) => api.interruptSubagent(robotId, child), [keys.robot(robotId), keys.robots])}>Stop</button> : null}
      </div>
      {tab === 'chat'
        ? (
          <AtomView atom={subagentConversationAtom(`${robotId}|${child}`)} what="the Subagent's Chat" errorTitle="The Subagent's Chat cannot be shown">
            {(conversation) => <ChatView items={conversation.items} meId={me.id} robotId={robotId} working={conversation.working} canAnswer={false} workDetails={me.workDetails ?? 'compact'} {...(conversation.activity === undefined ? {} : { activity: conversation.activity })} {...(robot === undefined ? {} : { robotColor: robot.identity.avatarColor })} />}
          </AtomView>
        )
        : (
          <Suspense fallback={<div className="muted">Loading the trajectory…</div>}>
            <RobotTrajectory robotId={robotId} child={child} liveVersion={liveVersion} />
          </Suspense>
        )}
    </div>
  )
}
