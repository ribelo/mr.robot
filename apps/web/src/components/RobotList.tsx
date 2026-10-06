import { useState } from 'react'
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
}

/** The robot list: avatar, name, last line and time (robot-q4b2). */
export function RobotList({ robots, selected, meName, isAdmin, onSelect, onCreate, onAdmin, onProfile }: RobotListProps) {
  const [query, setQuery] = useState('')
  const shown = robots.filter((robot) => robot.identity.name.toLowerCase().includes(query.toLowerCase()))
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
        {shown.length === 0 ? <li className="empty">No robots yet.</li> : null}
        {shown.map((robot) => (
          <li key={robot.id}>
            <button type="button" className={robot.id === selected ? 'robot-row selected' : 'robot-row'} onClick={() => onSelect(robot.id)}>
              <Avatar color={robot.identity.avatarColor} size={34} badge={robot.fleetState === 'waiting for you'} />
              <span className="robot-row-text">
                <span className="robot-row-top">
                  <span className="robot-name">{robot.identity.name}</span>
                  <span className="robot-time">{listTime(robot.lastAt)}</span>
                </span>
                <span className="robot-last">{robot.status === 'paused' ? 'Paused' : robot.lastLine || robot.identity.description || ' '}</span>
              </span>
            </button>
          </li>
        ))}
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

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('') || '?'
}
