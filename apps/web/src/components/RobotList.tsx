import { go } from '../route.ts'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { GroupPlace, ListPrefPatch, MemberAvatar, RobotGroup, RobotSummary } from '@mr-robot/protocol'
import { listTime } from '../time.ts'
import { Avatar, MemberFace } from './Avatar.tsx'
import { ConfirmByName } from './ConfirmByName.tsx'
import { InlineEdit } from './InlineEdit.tsx'
import { saveSucceeded, type SaveOutcome } from './SaveButton.tsx'
import { CLEAR_GOES, CLEAR_STAYS, START_OVER_GOES, START_OVER_STAYS, type DangerAction } from './danger-words.ts'
import { keys, useCommand } from '../client/api-atoms.ts'

/** A change to the person's own groups, as the sidebar asks for it (ux-wxbm, ux-o7po, ux-xbvi). */
export type GroupChange =
  /** A new group, last; with a Robot, that Robot moves into it ("Move to…" → "New group…"). */
  | { readonly kind: 'create'; readonly name: string; readonly robotId?: string }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  | { readonly kind: 'collapse'; readonly id: string; readonly collapsed: boolean }
  /** Every group id once, in the new order. */
  | { readonly kind: 'order'; readonly ids: readonly string[] }
  /** Its Robots return to the ungrouped list. */
  | { readonly kind: 'delete'; readonly id: string }

export interface RobotListProps {
  readonly robots: readonly RobotSummary[]
  /** The person's own groups, in their order (ux-wxbm, ux-oltg). */
  readonly groups: readonly RobotGroup[]
  readonly selected: string | undefined
  readonly meName: string
  /** The Member's own avatar in the sidebar foot (ux-2ft4). */
  readonly meAvatar: MemberAvatar
  readonly isAdmin: boolean
  readonly onSelect: (id: string) => void
  readonly onCreate: () => void
  readonly onAdmin: () => void
  readonly onProfile: () => void
  readonly onListPref: (id: string, change: ListPrefPatch) => void
  /** A failed change keeps a name field open; a failed collapse shows the stored state again. */
  readonly onGroupChange: (change: GroupChange) => Promise<SaveOutcome>
  readonly onEditProfile: (id: string) => void
  readonly onAdvanced: (id: string) => void
  readonly onFiles: (id: string) => void
  /** Only the owner may delete or clear a Robot. */
  readonly meId?: string
  /** A Robot was deleted or cleared. */
  readonly onRemoved?: (id: string, deleted: boolean) => void
}

/** What a drag carries (HTML drag API, ux-0qjq): a Robot row or a group header. */
const ROBOT_DRAG = 'application/x-mr-robot-robot'
const GROUP_DRAG = 'application/x-mr-robot-group'

/** Pinned first, otherwise the list's own order (robot-q4b2, ux-x62j). */
const pinnedFirst = (list: readonly RobotSummary[]) => [...list].sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true))

/**
 * The robot list (robot-q4b2, robot-mktj): the ungrouped Robots, then the person's groups, then the
 * built-in Hidden group, collapsed (ux-dice); pinned first in each, unread marked, a menu on every Robot.
 * A Robot moves by drag and drop or by "Move to…" (ux-0qjq, ux-sj2f). A search lists every match,
 * collapsed or not, with its group under it (ux-gieb).
 */
export function RobotList({ robots, groups, selected, meName, meAvatar, isAdmin, onSelect, onCreate, onAdmin, onProfile, onListPref, onGroupChange, onEditProfile, onAdvanced, onFiles, meId, onRemoved }: RobotListProps) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<string>()
  const [groupMenu, setGroupMenu] = useState<string>()
  const [renaming, setRenaming] = useState<string>()
  const [naming, setNaming] = useState(false)
  const [danger, setDanger] = useState<{ robot: RobotSummary; action: DangerAction }>()
  const command = useCommand()
  const [hiddenOpen, setHiddenOpen] = useState(false)
  // A collapse sent and not read back yet: group id → the stored value it turns over (ux-xbvi).
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [dropOn, setDropOn] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const dragActive = useRef(false)

  // Once the list reads the new state back, the turned-over value is no longer needed.
  useEffect(() => {
    setToggled((map) => {
      const settled = [...map].filter(([id, from]) => groups.find((group) => group.id === id)?.collapsed !== from)
      if (settled.length === 0) return map
      const rest = new Map(map)
      for (const [id] of settled) rest.delete(id)
      return rest
    })
  }, [groups])

  const known = new Set(groups.map((group) => group.id))
  /** The Robot's group, while that group exists. */
  const groupOf = (robot: RobotSummary) => (robot.groupId !== undefined && known.has(robot.groupId) ? robot.groupId : undefined)
  const isCollapsed = (group: RobotGroup) => (toggled.get(group.id) === group.collapsed ? !group.collapsed : group.collapsed)
  const toggle = (group: RobotGroup) => {
    const next = !isCollapsed(group)
    const forget = (map: ReadonlyMap<string, boolean>) => { const rest = new Map(map); rest.delete(group.id); return rest }
    setToggled((map) => (next === group.collapsed ? forget(map) : new Map(map).set(group.id, group.collapsed)))
    void onGroupChange({ kind: 'collapse', id: group.id, collapsed: next }).then((outcome) => { if (!saveSucceeded(outcome)) setToggled(forget) })
  }
  /** Into a group or out of every group; a hidden Robot shows again. */
  const move = (robot: RobotSummary, place: GroupPlace) => {
    const current = groupOf(robot)
    const same = place.kind === 'ungrouped' ? current === undefined : current === place.groupId
    if (same && robot.hidden !== true) return
    onListPref(robot.id, { group: place, ...(robot.hidden === true ? { hidden: false } : {}) })
  }
  /** The dragged group takes the target's place. */
  const reorder = (dragged: string, target: string) => {
    const ids = groups.map((group) => group.id)
    const from = ids.indexOf(dragged)
    const to = ids.indexOf(target)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(from, 1)
    ids.splice(to, 0, dragged)
    void onGroupChange({ kind: 'order', ids })
  }
  const endDrag = () => { dragActive.current = false; setDragging(false); setDropOn(undefined) }
  /** A part of the list that takes a dropped Robot, and a dropped group when it is a group itself. */
  const dropZone = (key: string, accept: { readonly robot: (robot: RobotSummary) => void; readonly group?: (id: string) => void }) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      const types = event.dataTransfer.types
      if (!types.includes(ROBOT_DRAG) && !(accept.group !== undefined && types.includes(GROUP_DRAG))) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dropOn !== key) setDropOn(key)
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropOn((on) => (on === key ? undefined : on))
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      endDrag()
      const robot = robots.find((entry) => entry.id === event.dataTransfer.getData(ROBOT_DRAG))
      if (robot !== undefined) accept.robot(robot)
      const group = event.dataTransfer.getData(GROUP_DRAG)
      if (group !== '' && accept.group !== undefined) accept.group(group)
    },
  })
  const zoneClass = (key: string, extra = '') => `robot-group${extra}${dropOn === key ? ' drop-target' : ''}`

  const row = (robot: RobotSummary, place?: string) => (
    <li key={robot.id} className="robot-item" draggable={query === ''}
      onDragStart={(event) => {
        event.dataTransfer.setData(ROBOT_DRAG, robot.id)
        event.dataTransfer.effectAllowed = 'move'
        setMenu(undefined)
        // After the drag has started (a changed list would end it): the Hidden group appears as a target even when it is empty.
        dragActive.current = true
        setTimeout(() => { if (dragActive.current) setDragging(true) }, 0)
      }}
      onDragEnd={endDrag}
      onContextMenu={(event) => { event.preventDefault(); setMenu(robot.id) }}>
      <button type="button" className={robot.id === selected ? 'robot-row selected' : 'robot-row'} onClick={() => onSelect(robot.id)}>
        <Avatar seed={robot.identity.avatarSeed} color={robot.identity.avatarColor} size={34} state={robot.fleetState} />
        <span className="robot-row-text">
          <span className="robot-row-top">
            <span className={robot.unread ? 'robot-name unread' : 'robot-name'}>{robot.pinned === true ? <span className="pin" aria-label="pinned">📌 </span> : null}{robot.identity.name}</span>
            <span className="robot-time">{listTime(robot.lastAt)}{robot.unread ? <span className="unread-dot" aria-label="unread" /> : null}</span>
          </span>
          <span className={robot.fleetState === 'blocked' ? 'robot-last blocked' : 'robot-last'}>{robot.status === 'paused' ? 'Paused' : robot.lastLine || robot.identity.description || ' '}</span>
          {place === undefined ? null : <span className="robot-place">{place}</span>}
        </span>
      </button>
      <button type="button" className="row-menu-button" aria-label={`${robot.identity.name} menu`} onClick={() => setMenu(menu === robot.id ? undefined : robot.id)}>⋯</button>
      {menu === robot.id ? (
        <RowMenu
          robot={robot}
          groups={groups}
          place={groupOf(robot)}
          onClose={() => setMenu(undefined)}
          onListPref={(change) => { setMenu(undefined); onListPref(robot.id, change) }}
          onMove={(target) => { setMenu(undefined); move(robot, target) }}
          onNewGroup={(name) => onGroupChange({ kind: 'create', name, robotId: robot.id })}
          onEditProfile={() => { setMenu(undefined); onEditProfile(robot.id) }}
          onAdvanced={() => { setMenu(undefined); onAdvanced(robot.id) }}
          onFiles={() => { setMenu(undefined); onFiles(robot.id) }}
          {...(meId !== undefined && robot.ownerId === meId ? { onDanger: (action: DangerAction) => { setMenu(undefined); setDanger({ robot, action }) } } : {})}
        />
      ) : null}
    </li>
  )

  const shown = robots.filter((robot) => robot.hidden !== true)
  const hidden = robots.filter((robot) => robot.hidden === true)
  const ungrouped = shown.filter((robot) => groupOf(robot) === undefined)

  const groupSection = (group: RobotGroup, index: number) => {
    const inside = shown.filter((robot) => groupOf(robot) === group.id)
    const closed = isCollapsed(group)
    const neighbour = (by: -1 | 1) => groups[index + by]
    return (
      <li key={group.id} className={zoneClass(group.id)} {...dropZone(group.id, { robot: (robot) => move(robot, { kind: 'group', groupId: group.id }), group: (dragged) => reorder(dragged, group.id) })}>
        <div className="group-head" draggable={renaming !== group.id}
          onDragStart={(event) => { event.dataTransfer.setData(GROUP_DRAG, group.id); event.dataTransfer.effectAllowed = 'move'; setGroupMenu(undefined) }}
          onDragEnd={endDrag}>
          <InlineEdit editing={renaming === group.id} value={group.name} label="Name of this group" onSave={(name) => onGroupChange({ kind: 'rename', id: group.id, name })} onClose={() => setRenaming(undefined)}>
            <button type="button" className="group-toggle" aria-expanded={!closed} onClick={() => toggle(group)}>
              <span className="group-caret" aria-hidden="true">{closed ? '▸' : '▾'}</span>
              <span className="group-name">{group.name}</span>{' '}
              <span className="group-count">{inside.length}</span>
              {closed && inside.some((robot) => robot.unread) ? <span className="unread-dot" aria-label="unread" /> : null}
            </button>
            <button type="button" className="group-menu-button" aria-label={`${group.name} group menu`} onClick={() => setGroupMenu(groupMenu === group.id ? undefined : group.id)}>⋯</button>
          </InlineEdit>
          {groupMenu === group.id ? (
            <Popup label={`${group.name} group`} onClose={() => setGroupMenu(undefined)}>
              <button type="button" role="menuitem" onClick={() => { setGroupMenu(undefined); setRenaming(group.id) }}>Rename</button>
              <button type="button" role="menuitem" disabled={neighbour(-1) === undefined} onClick={() => { setGroupMenu(undefined); reorder(group.id, neighbour(-1)!.id) }}>Move up</button>
              <button type="button" role="menuitem" disabled={neighbour(1) === undefined} onClick={() => { setGroupMenu(undefined); reorder(group.id, neighbour(1)!.id) }}>Move down</button>
              <hr />
              <button type="button" role="menuitem" onClick={() => { setGroupMenu(undefined); void onGroupChange({ kind: 'delete', id: group.id }) }}>Delete group</button>
            </Popup>
          ) : null}
        </div>
        {closed ? null : <ul>{pinnedFirst(inside).map((robot) => row(robot))}</ul>}
      </li>
    )
  }

  const placeOf = (robot: RobotSummary) => (robot.hidden === true ? 'Hidden' : groups.find((group) => group.id === groupOf(robot))?.name)
  const matching = robots.filter((robot) => robot.identity.name.toLowerCase().includes(query.toLowerCase()))
  const list: ReactNode = query !== '' ? (
    matching.length === 0 ? <li className="empty">{`No robot matches “${query}”.`}</li> : pinnedFirst(matching).map((robot) => row(robot, placeOf(robot)))
  ) : (
    <>
      {robots.length === 0 ? <li className="empty">No robots yet.</li> : null}
      <li className={zoneClass('ungrouped')} {...dropZone('ungrouped', { robot: (robot) => move(robot, { kind: 'ungrouped' }) })}>
        {groups.length === 0 ? null : <div className="group-head"><span className="group-label"><span className="group-name">No group</span>{' '}<span className="group-count">{ungrouped.length}</span></span></div>}
        <ul>{pinnedFirst(ungrouped).map((robot) => row(robot))}</ul>
      </li>
      {groups.map(groupSection)}
      {hidden.length === 0 && !dragging ? null : (
        <li className={zoneClass('hidden', ' hidden-group')} {...dropZone('hidden', { robot: (robot) => { if (robot.hidden !== true) onListPref(robot.id, { hidden: true }) } })}>
          <div className="group-head">
            <button type="button" className="group-toggle" aria-expanded={hiddenOpen} onClick={() => setHiddenOpen(!hiddenOpen)}>
              <span className="group-caret" aria-hidden="true">{hiddenOpen ? '▾' : '▸'}</span>
              <span className="group-name">Hidden</span>{' '}
              <span className="group-count">{hidden.length}</span>
            </button>
          </div>
          {hiddenOpen ? <ul>{pinnedFirst(hidden).map((robot) => row(robot))}</ul> : null}
        </li>
      )}
      <li className="new-group">
        <InlineEdit editing={naming} value="" label="Name of the new group" placeholder="Work, Home, a project" onSave={(name) => onGroupChange({ kind: 'create', name })} onClose={() => setNaming(false)}>
          <button type="button" className="link" onClick={() => setNaming(true)}>New group…</button>
        </InlineEdit>
      </li>
    </>
  )

  return (
    <nav className="sidebar">
      {danger === undefined ? null : danger.action === 'delete' ? (
        <ConfirmByName
          title={`Delete ${danger.robot.identity.name}`}
          name={danger.robot.identity.name}
          goes="The robot, its conversation, files and memory are deleted, and other robots stop being able to message it. Its open Tasks stay, without a doer."
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
      <ul className="robot-list">{list}</ul>
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

/** A menu over the list: a click outside it or Escape closes it. */
function Popup({ label, onClose, children }: { readonly label: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (event: MouseEvent) => { if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape) }
  }, [onClose])
  return <div ref={ref} className="row-menu" role="menu" aria-label={label}>{children}</div>
}

function RowMenu({ robot, groups, place, onClose, onListPref, onMove, onNewGroup, onEditProfile, onAdvanced, onFiles, onDanger }: {
  robot: RobotSummary
  groups: readonly RobotGroup[]
  /** The group the Robot is in; undefined: ungrouped. */
  place: string | undefined
  onClose: () => void
  onListPref: (change: ListPrefPatch) => void
  onMove: (place: GroupPlace) => void
  onNewGroup: (name: string) => Promise<SaveOutcome>
  onEditProfile: () => void
  onAdvanced: () => void
  onFiles: () => void
  onDanger?: (action: DangerAction) => void
}) {
  const [moving, setMoving] = useState(false)
  const [naming, setNaming] = useState(false)
  // Where it already is is not offered, unless it is hidden: moving shows it again.
  const here = (target: string | undefined) => target === place && robot.hidden !== true
  return (
    <Popup label={`${robot.identity.name} menu`} onClose={onClose}>
      <button type="button" role="menuitem" onClick={() => onListPref({ pinned: robot.pinned !== true })}>{robot.pinned === true ? 'Unpin' : 'Pin'}</button>
      <button type="button" role="menuitem" onClick={() => onListPref({ unread: !robot.unread })}>{robot.unread ? 'Mark as read' : 'Mark as unread'}</button>
      <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={moving} onClick={() => setMoving(!moving)}>Move to…</button>
      {moving ? (
        <div className="row-submenu" role="menu" aria-label="Move to">
          {groups.map((group) => <button key={group.id} type="button" role="menuitem" disabled={here(group.id)} onClick={() => onMove({ kind: 'group', groupId: group.id })}>{group.name}</button>)}
          <button type="button" role="menuitem" disabled={here(undefined)} onClick={() => onMove({ kind: 'ungrouped' })}>No group</button>
          <InlineEdit editing={naming} value="" label="Name of the new group" placeholder="Work, Home, a project" onSave={onNewGroup} onClose={onClose}>
            <button type="button" role="menuitem" onClick={() => setNaming(true)}>New group…</button>
          </InlineEdit>
        </div>
      ) : null}
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
    </Popup>
  )
}
