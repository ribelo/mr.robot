import { go } from '../route.ts'
import { useEffect, useRef, useState } from 'react'
import type { MemberAvatar, RobotSummary } from '@mr-robot/protocol'
import { listTime } from '../time.ts'
import { Avatar, MemberFace } from './Avatar.tsx'
import { ConfirmByName } from './ConfirmByName.tsx'
import { CLEAR_GOES, CLEAR_STAYS, START_OVER_GOES, START_OVER_STAYS, type DangerAction } from './danger-words.ts'
import { keys, useCommand } from '../client/api-atoms.ts'

export interface RobotListProps {
  readonly robots: readonly RobotSummary[]
  readonly selected: string | undefined
  readonly meName: string
  /** The Member's own avatar in the sidebar foot (ux-2ft4). */
  readonly meAvatar: MemberAvatar
  readonly isAdmin: boolean
  readonly onSelect: (id: string) => void
  readonly onCreate: () => void
  readonly onAdmin: () => void
  readonly onProfile: () => void
  readonly onListPref: (id: string, change: { pinned?: boolean; hidden?: boolean; unread?: boolean }) => void
  readonly onEditProfile: (id: string) => void
  readonly onAdvanced: (id: string) => void
  readonly onFiles: (id: string) => void
  /** Only the owner may delete or clear a Robot. */
  readonly meId?: string
  /** A Robot was deleted or cleared. */
  readonly onRemoved?: (id: string, deleted: boolean) => void
}

/** The robot list (robot-q4b2, robot-mktj): pinned first, unread marked, a menu on every Robot. */
export function RobotList({ robots, selected, meName, meAvatar, isAdmin, onSelect, onCreate, onAdmin, onProfile, onListPref, onEditProfile, onAdvanced, onFiles, meId, onRemoved }: RobotListProps) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<string>()
  const [danger, setDanger] = useState<{ robot: RobotSummary; action: DangerAction }>()
  const command = useCommand()
  const [showHidden, setShowHidden] = useState(false)
  const matching = robots.filter((robot) => robot.identity.name.toLowerCase().includes(query.toLowerCase()))
  const visible = matching.filter((robot) => robot.hidden !== true).sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true))
  const hidden = matching.filter((robot) => robot.hidden === true)
  const row = (robot: RobotSummary) => (
    <li key={robot.id} className="robot-item" onContextMenu={(event) => { event.preventDefault(); setMenu(robot.id) }}>
      <button type="button" className={robot.id === selected ? 'robot-row selected' : 'robot-row'} onClick={() => onSelect(robot.id)}>
        <Avatar seed={robot.identity.avatarSeed} color={robot.identity.avatarColor} size={34} state={robot.fleetState} />
        <span className="robot-row-text">
          <span className="robot-row-top">
            <span className={robot.unread ? 'robot-name unread' : 'robot-name'}>{robot.pinned === true ? <span className="pin" aria-label="pinned">📌 </span> : null}{robot.identity.name}</span>
            <span className="robot-time">{listTime(robot.lastAt)}{robot.unread ? <span className="unread-dot" aria-label="unread" /> : null}</span>
          </span>
          <span className={robot.fleetState === 'blocked' ? 'robot-last blocked' : 'robot-last'}>{robot.status === 'paused' ? 'Paused' : robot.lastLine || robot.identity.description || ' '}</span>
        </span>
      </button>
      <button type="button" className="row-menu-button" aria-label={`${robot.identity.name} menu`} onClick={() => setMenu(menu === robot.id ? undefined : robot.id)}>⋯</button>
      {menu === robot.id ? (
        <RowMenu
          robot={robot}
          onClose={() => setMenu(undefined)}
          onListPref={(change) => { setMenu(undefined); onListPref(robot.id, change) }}
          onEditProfile={() => { setMenu(undefined); onEditProfile(robot.id) }}
          onAdvanced={() => { setMenu(undefined); onAdvanced(robot.id) }}
          onFiles={() => { setMenu(undefined); onFiles(robot.id) }}
          {...(meId !== undefined && robot.ownerId === meId ? { onDanger: (action: DangerAction) => { setMenu(undefined); setDanger({ robot, action }) } } : {})}
        />
      ) : null}
    </li>
  )
  return (
    <nav className="sidebar">
      {danger === undefined ? null : danger.action === 'delete' ? (
        <ConfirmByName
          title={`Delete ${danger.robot.identity.name}`}
          name={danger.robot.identity.name}
          goes="The robot, its conversation, files, memory and routines are deleted, and other robots stop being able to message it."
          action="Delete robot"
          onCancel={() => setDanger(undefined)}
          onConfirm={async () => {
            const exit = await command((api) => api.remove(danger.robot.id, danger.robot.identity.name), [keys.robots, keys.robot(danger.robot.id)])
            if (exit._tag === 'Success') { setDanger(undefined); onRemoved?.(danger.robot.id, true) }
            return exit
          }}
        />
      ) : danger.action === 'start-over' ? (
        <ConfirmByName
          title={`Start ${danger.robot.identity.name} over`}
          name={danger.robot.identity.name}
          goes={START_OVER_GOES}
          stays={START_OVER_STAYS}
          action="Start over"
          onCancel={() => setDanger(undefined)}
          onConfirm={async () => {
            const exit = await command((api) => api.startOver(danger.robot.id, danger.robot.identity.name), [keys.robots, keys.robot(danger.robot.id), keys.files(danger.robot.id)])
            if (exit._tag === 'Success') { setDanger(undefined); onRemoved?.(danger.robot.id, false) }
            return exit
          }}
        />
      ) : (
        <ConfirmByName
          title={`Clear ${danger.robot.identity.name}'s history`}
          name={danger.robot.identity.name}
          goes={CLEAR_GOES}
          stays={CLEAR_STAYS}
          action="Clear history"
          onCancel={() => setDanger(undefined)}
          onConfirm={async () => {
            const exit = await command((api) => api.clearHistory(danger.robot.id, danger.robot.identity.name), [keys.robots, keys.robot(danger.robot.id), keys.files(danger.robot.id)])
            if (exit._tag === 'Success') { setDanger(undefined); onRemoved?.(danger.robot.id, false) }
            return exit
          }}
        />
      )}
      <div className="sidebar-head">
        <span className="brand">Mr. Robot</span>
        <button type="button" className="icon-button" aria-label="New robot" onClick={onCreate}>+</button>
      </div>
      <label className="search">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
      </label>
      <ul className="robot-list">
        {visible.length === 0 && hidden.length === 0 ? <li className="empty">{query === '' ? 'No robots yet.' : `No robot matches “${query}”.`}</li> : null}
        {visible.map(row)}
        {hidden.length === 0 ? null : (
          <li className="hidden-group">
            <button type="button" className="link" onClick={() => setShowHidden(!showHidden)}>{showHidden ? '▾' : '▸'} Hidden ({hidden.length})</button>
          </li>
        )}
        {showHidden ? hidden.map(row) : null}
      </ul>
      <div className="sidebar-foot">
        <button type="button" className="me" title={meName} onClick={onProfile}>
          <MemberFace memberId={meId ?? ''} name={meName} avatar={meAvatar} /><span className="me-name">{meName}</span>
        </button>
        <button type="button" className="link" onClick={() => go({ page: 'plugins' })}>Plugins</button>
        {isAdmin ? <button type="button" className="link" onClick={onAdmin}>Admin</button> : null}
      </div>
    </nav>
  )
}

function RowMenu({ robot, onClose, onListPref, onEditProfile, onAdvanced, onFiles, onDanger }: {
  robot: RobotSummary
  onClose: () => void
  onListPref: (change: { pinned?: boolean; hidden?: boolean; unread?: boolean }) => void
  onEditProfile: () => void
  onAdvanced: () => void
  onFiles: () => void
  onDanger?: (action: DangerAction) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (event: MouseEvent) => { if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape) }
  }, [onClose])
  return (
    <div ref={ref} className="row-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => onListPref({ pinned: robot.pinned !== true })}>{robot.pinned === true ? 'Unpin' : 'Pin'}</button>
      <button type="button" role="menuitem" onClick={() => onListPref({ unread: !robot.unread })}>{robot.unread ? 'Mark as read' : 'Mark as unread'}</button>
      <hr />
      <button type="button" role="menuitem" onClick={onEditProfile}>Edit profile</button>
      <button type="button" role="menuitem" onClick={onAdvanced}>Advanced settings</button>
      <button type="button" role="menuitem" onClick={onFiles}>Files</button>
      <hr />
      <button type="button" role="menuitem" onClick={() => onListPref({ hidden: robot.hidden !== true })}>{robot.hidden === true ? 'Show in sidebar' : 'Hide from sidebar'}</button>
      {onDanger === undefined ? null : (
        <>
          <hr />
          <button type="button" role="menuitem" className="danger" onClick={() => onDanger('clear')}>Clear history…</button>
          <button type="button" role="menuitem" className="danger" onClick={() => onDanger('start-over')}>Start over…</button>
          {robot.kind === 'mr-robot' ? null : <button type="button" role="menuitem" className="danger" onClick={() => onDanger('delete')}>Delete robot…</button>}
        </>
      )}
    </div>
  )
}

