import { useEffect, useRef, useState } from 'react'
import type { RobotSummary } from '@mr-robot/protocol'
import { listTime } from '../time.ts'
import { Avatar } from './Avatar.tsx'

export interface RobotListProps {
  readonly robots: readonly RobotSummary[]
  readonly selected: string | undefined
  readonly meName: string
  readonly isAdmin: boolean
  readonly onSelect: (id: string) => void
  readonly onCreate: () => void
  readonly onAdmin: () => void
  readonly onProfile: () => void
  readonly onListPref: (id: string, change: { pinned?: boolean; hidden?: boolean; unread?: boolean }) => void
  readonly onEditProfile: (id: string) => void
  readonly onAdvanced: (id: string) => void
}

/** The robot list (robot-q4b2, robot-mktj): pinned first, unread marked, a menu on every Robot. */
export function RobotList({ robots, selected, meName, isAdmin, onSelect, onCreate, onAdmin, onProfile, onListPref, onEditProfile, onAdvanced }: RobotListProps) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<string>()
  const [showHidden, setShowHidden] = useState(false)
  const matching = robots.filter((robot) => robot.identity.name.toLowerCase().includes(query.toLowerCase()))
  const visible = matching.filter((robot) => robot.hidden !== true).sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true))
  const hidden = matching.filter((robot) => robot.hidden === true)
  const row = (robot: RobotSummary) => (
    <li key={robot.id} className="robot-item" onContextMenu={(event) => { event.preventDefault(); setMenu(robot.id) }}>
      <button type="button" className={robot.id === selected ? 'robot-row selected' : 'robot-row'} onClick={() => onSelect(robot.id)}>
        <Avatar color={robot.identity.avatarColor} size={34} badge={robot.fleetState === 'waiting for you'} />
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
        />
      ) : null}
    </li>
  )
  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <span className="brand">Mr. Robot</span>
        <button type="button" className="icon-button" aria-label="New robot" onClick={onCreate}>+</button>
      </div>
      <label className="search">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
      </label>
      <ul className="robot-list">
        {visible.length === 0 && hidden.length === 0 ? <li className="empty">No robots yet.</li> : null}
        {visible.map(row)}
        {hidden.length === 0 ? null : (
          <li className="hidden-group">
            <button type="button" className="link" onClick={() => setShowHidden(!showHidden)}>{showHidden ? '▾' : '▸'} Hidden ({hidden.length})</button>
          </li>
        )}
        {showHidden ? hidden.map(row) : null}
      </ul>
      <div className="sidebar-foot">
        <button type="button" className="me" onClick={onProfile}>
          <span className="initials">{initials(meName)}</span> {meName}
        </button>
        {isAdmin ? <button type="button" className="link" onClick={onAdmin}>Admin</button> : null}
      </div>
    </nav>
  )
}

function RowMenu({ robot, onClose, onListPref, onEditProfile, onAdvanced }: {
  robot: RobotSummary
  onClose: () => void
  onListPref: (change: { pinned?: boolean; hidden?: boolean; unread?: boolean }) => void
  onEditProfile: () => void
  onAdvanced: () => void
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
      <hr />
      <button type="button" role="menuitem" onClick={() => onListPref({ hidden: robot.hidden !== true })}>{robot.hidden === true ? 'Show in sidebar' : 'Hide from sidebar'}</button>
    </div>
  )
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('') || '?'
}
