import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ListPrefPatch, RobotGroup, RobotSummary } from '@mr-robot/protocol'
import { RobotList, type GroupChange } from '../src/components/RobotList.tsx'

afterEach(cleanup)

const robot = (id: string, name: string, more: Partial<RobotSummary> = {}): RobotSummary => ({
  id, ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null,
  identity: { name, title: '', description: '', avatarColor: '#888888', avatarSeed: id }, lastLine: '', lastAt: 0, unread: false, ...more,
})

/** What the API keeps for the person: their Robots' list settings and their groups. */
interface Server { robots: RobotSummary[]; groups: RobotGroup[]; changes: Array<GroupChange | { kind: 'list'; id: string; change: ListPrefPatch }> }

const placed = (entry: RobotSummary, change: ListPrefPatch): RobotSummary => {
  const { groupId, ...rest } = entry
  const group = change.group === undefined ? (groupId === undefined ? {} : { groupId }) : change.group.kind === 'group' ? { groupId: change.group.groupId } : {}
  return {
    ...rest, ...group,
    ...(change.pinned === undefined ? {} : { pinned: change.pinned }),
    ...(change.hidden === undefined ? {} : { hidden: change.hidden }),
    ...(change.unread === undefined ? {} : { unread: change.unread }),
  }
}

/** The sidebar over a stand-in for the API: every change is recorded and read back, as the app does. */
function Sidebar({ server }: { server: Server }) {
  const [, setVersion] = useState(0)
  const saved = () => setVersion((version) => version + 1)
  const listPref = (id: string, change: ListPrefPatch) => {
    server.changes.push({ kind: 'list', id, change })
    server.robots = server.robots.map((entry) => (entry.id === id ? placed(entry, change) : entry))
    saved()
  }
  const groupChange = async (change: GroupChange) => {
    server.changes.push(change)
    switch (change.kind) {
      case 'create': {
        const group = { id: `g-${change.name}`, name: change.name, collapsed: false }
        server.groups = [...server.groups, group]
        if (change.robotId !== undefined) server.robots = server.robots.map((entry) => (entry.id === change.robotId ? placed(entry, { group: { kind: 'group', groupId: group.id }, hidden: false }) : entry))
        break
      }
      case 'rename': server.groups = server.groups.map((group) => (group.id === change.id ? { ...group, name: change.name } : group)); break
      case 'collapse': server.groups = server.groups.map((group) => (group.id === change.id ? { ...group, collapsed: change.collapsed } : group)); break
      case 'order': server.groups = change.ids.map((id) => server.groups.find((group) => group.id === id)!); break
      case 'delete':
        server.groups = server.groups.filter((group) => group.id !== change.id)
        server.robots = server.robots.map((entry) => (entry.groupId === change.id ? placed(entry, { group: { kind: 'ungrouped' } }) : entry))
        break
    }
    saved()
    return true
  }
  const noop = () => undefined
  return (
    <RobotList robots={server.robots} groups={server.groups} selected={undefined} meName="Anna" meAvatar={{ kind: 'initials', color: '#6c63ff' }} meId="m-1" isAdmin={false}
      onSelect={noop} onCreate={noop} onAdmin={noop} onProfile={noop} onListPref={listPref} onGroupChange={groupChange} onEditProfile={noop} onAdvanced={noop} onFiles={noop} />
  )
}

const show = (server: Server) => render(<RegistryProvider><Sidebar server={server} /></RegistryProvider>)

/** The sections of the sidebar top to bottom: header (none for the ungrouped list without groups) and Robot names. */
const sections = () => [...document.querySelectorAll('.robot-list > .robot-group')].map((section) => [
  [...section.querySelectorAll('.group-head .group-name, .group-head .group-count')].map((part) => part.textContent).join(' '),
  ...[...section.querySelectorAll('.robot-name')].map((name) => name.textContent?.replace('📌 ', '')),
])
const header = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name} \\d`) })
const item = (name: string) => screen.getByText(name).closest('li')!
const section = (name: string) => header(name).closest('li')!

/** The browser's drag data between dragstart and drop (jsdom has no DataTransfer). */
function dataTransfer() {
  const data = new Map<string, string>()
  const types: string[] = []
  return { types, setData: (type: string, value: string) => { data.set(type, value); if (!types.includes(type)) types.push(type) }, getData: (type: string) => data.get(type) ?? '', dropEffect: 'none', effectAllowed: 'all' }
}
const drag = (from: Element, to: Element) => {
  const carried = dataTransfer()
  fireEvent.dragStart(from, { dataTransfer: carried })
  fireEvent.dragOver(to, { dataTransfer: carried })
  fireEvent.drop(to, { dataTransfer: carried })
}

describe('sidebar groups (v1.12 ticket 12)', () => {
  it('creates a group from the bottom of the list; the ungrouped list has a header only once groups exist (ux-wxbm)', async () => {
    const server: Server = { robots: [robot('r-1', 'Bills')], groups: [], changes: [] }
    show(server)
    expect(sections()).toEqual([['', 'Bills']])
    fireEvent.click(screen.getByRole('button', { name: 'New group…' }))
    const field = screen.getByRole('textbox', { name: 'Name of the new group' })
    fireEvent.change(field, { target: { value: ' Work ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(sections()).toEqual([['No group 1', 'Bills'], ['Work 0']]))
    expect(server.changes).toEqual([{ kind: 'create', name: 'Work' }])
    expect(screen.queryByRole('textbox', { name: 'Name of the new group' })).toBeNull()
  })

  it('renames, reorders and deletes a group from its menu; its Robots return to the ungrouped list (ux-o7po)', async () => {
    const server: Server = { robots: [robot('r-1', 'Bills', { groupId: 'g-1' }), robot('r-2', 'Gym')], groups: [{ id: 'g-1', name: 'Work', collapsed: false }, { id: 'g-2', name: 'Home', collapsed: false }], changes: [] }
    show(server)
    fireEvent.click(screen.getByRole('button', { name: 'Work group menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const field = screen.getByRole('textbox', { name: 'Name of this group' }) as HTMLInputElement
    expect(field.value).toBe('Work')
    fireEvent.change(field, { target: { value: 'Office' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(sections()).toEqual([['No group 1', 'Gym'], ['Office 1', 'Bills'], ['Home 0']]))

    fireEvent.click(screen.getByRole('button', { name: 'Home group menu' }))
    expect((screen.getByRole('menuitem', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }))
    await waitFor(() => expect(sections().map((entry) => entry[0])).toEqual(['No group 1', 'Home 0', 'Office 1']))

    fireEvent.click(screen.getByRole('button', { name: 'Office group menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete group' }))
    await waitFor(() => expect(sections()).toEqual([['No group 2', 'Bills', 'Gym'], ['Home 0']]))
    expect(server.changes).toEqual([
      { kind: 'rename', id: 'g-1', name: 'Office' },
      { kind: 'order', ids: ['g-2', 'g-1'] },
      { kind: 'delete', id: 'g-1' },
    ])
  })

  it('collapses a group, and the next sidebar opens it collapsed (ux-xbvi)', async () => {
    const server: Server = { robots: [robot('r-1', 'Bills', { groupId: 'g-1', unread: true })], groups: [{ id: 'g-1', name: 'Work', collapsed: false }], changes: [] }
    const first = show(server)
    expect(header('Work').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(header('Work'))
    await waitFor(() => expect(header('Work').getAttribute('aria-expanded')).toBe('false'))
    expect(screen.queryByText('Bills')).toBeNull()
    // A collapsed group still says a Robot in it has something unread.
    expect(within(header('Work')).getByLabelText('unread')).toBeTruthy()
    expect(server.changes).toEqual([{ kind: 'collapse', id: 'g-1', collapsed: true }])
    first.unmount()

    show(server)
    expect(header('Work').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Bills')).toBeNull()
    fireEvent.click(header('Work'))
    await waitFor(() => expect(screen.getByText('Bills')).toBeTruthy())
  })

  it('moves a Robot with "Move to…" in its menu: a group, no group, or a new group (ux-sj2f)', async () => {
    const server: Server = { robots: [robot('r-1', 'Bills'), robot('r-2', 'Gym')], groups: [{ id: 'g-1', name: 'Work', collapsed: false }], changes: [] }
    show(server)
    const moveTo = (name: string, target: string) => {
      fireEvent.click(screen.getByRole('button', { name: `${name} menu` }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }))
      fireEvent.click(within(screen.getByRole('menu', { name: 'Move to' })).getByRole('menuitem', { name: target }))
    }
    moveTo('Bills', 'Work')
    await waitFor(() => expect(sections()).toEqual([['No group 1', 'Gym'], ['Work 1', 'Bills']]))
    fireEvent.click(screen.getByRole('button', { name: 'Bills menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }))
    const submenu = screen.getByRole('menu', { name: 'Move to' })
    expect(within(submenu).getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual(['Work', 'No group', 'New group…'])
    expect((within(submenu).getByRole('menuitem', { name: 'Work' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(submenu).getByRole('menuitem', { name: 'No group' }))
    await waitFor(() => expect(sections()).toEqual([['No group 2', 'Bills', 'Gym'], ['Work 0']]))

    fireEvent.click(screen.getByRole('button', { name: 'Gym menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New group…' }))
    const field = screen.getByRole('textbox', { name: 'Name of the new group' })
    fireEvent.change(field, { target: { value: 'Health' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(sections()).toEqual([['No group 1', 'Bills'], ['Work 0'], ['Health 1', 'Gym']]))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(server.changes).toEqual([
      { kind: 'list', id: 'r-1', change: { group: { kind: 'group', groupId: 'g-1' } } },
      { kind: 'list', id: 'r-1', change: { group: { kind: 'ungrouped' } } },
      { kind: 'create', name: 'Health', robotId: 'r-2' },
    ])
  })

  it('moves a Robot by drag and drop, hides it by dropping it on Hidden, and reorders groups by their headers (ux-0qjq)', async () => {
    const server: Server = { robots: [robot('r-1', 'Bills'), robot('r-2', 'Gym', { groupId: 'g-1' })], groups: [{ id: 'g-1', name: 'Work', collapsed: false }, { id: 'g-2', name: 'Home', collapsed: true }], changes: [] }
    show(server)
    drag(item('Bills'), section('Home'))
    await waitFor(() => expect(sections()).toEqual([['No group 0'], ['Work 1', 'Gym'], ['Home 1']]))
    drag(item('Gym'), document.querySelector('.robot-list > .robot-group')!)
    await waitFor(() => expect(sections()).toEqual([['No group 1', 'Gym'], ['Work 0'], ['Home 1']]))

    // Hidden appears as a target while a Robot is dragged, even when nothing is hidden yet.
    const carried = dataTransfer()
    fireEvent.dragStart(item('Gym'), { dataTransfer: carried })
    await waitFor(() => expect(header('Hidden')).toBeTruthy())
    fireEvent.dragOver(section('Hidden'), { dataTransfer: carried })
    fireEvent.drop(section('Hidden'), { dataTransfer: carried })
    await waitFor(() => expect(sections()).toEqual([['No group 0'], ['Work 0'], ['Home 1'], ['Hidden 1']]))

    drag(section('Home').querySelector('.group-head')!, section('Work'))
    await waitFor(() => expect(sections().map((entry) => entry[0])).toEqual(['No group 0', 'Home 1', 'Work 0', 'Hidden 1']))
    expect(server.changes).toEqual([
      { kind: 'list', id: 'r-1', change: { group: { kind: 'group', groupId: 'g-2' } } },
      { kind: 'list', id: 'r-2', change: { group: { kind: 'ungrouped' } } },
      { kind: 'list', id: 'r-2', change: { hidden: true } },
      { kind: 'order', ids: ['g-2', 'g-1'] },
    ])
  })

  it('keeps hidden Robots in the built-in Hidden group, collapsed and last; moving one out shows it again (ux-dice)', async () => {
    const server: Server = { robots: [robot('r-1', 'Bills', { hidden: true, groupId: 'g-1' }), robot('r-2', 'Gym')], groups: [{ id: 'g-1', name: 'Work', collapsed: false }], changes: [] }
    show(server)
    expect(sections()).toEqual([['No group 1', 'Gym'], ['Work 0'], ['Hidden 1']])
    expect(header('Hidden').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(header('Hidden'))
    expect(sections().at(-1)).toEqual(['Hidden 1', 'Bills'])
    drag(item('Bills'), section('Work'))
    await waitFor(() => expect(sections()).toEqual([['No group 1', 'Gym'], ['Work 1', 'Bills']]))
    expect(server.changes).toEqual([{ kind: 'list', id: 'r-1', change: { group: { kind: 'group', groupId: 'g-1' }, hidden: false } }])
  })

  it('keeps pinned Robots on top of their group and unread marks as they were (ux-x62j)', () => {
    const server: Server = {
      robots: [robot('r-1', 'Bills', { groupId: 'g-1' }), robot('r-2', 'Gym', { groupId: 'g-1', pinned: true }), robot('r-3', 'Taxes', { groupId: 'g-1', unread: true }), robot('r-4', 'Flat', { pinned: true }), robot('r-5', 'News')],
      groups: [{ id: 'g-1', name: 'Work', collapsed: false }],
      changes: [],
    }
    show(server)
    expect(sections()).toEqual([['No group 2', 'Flat', 'News'], ['Work 3', 'Gym', 'Bills', 'Taxes']])
    expect(within(item('Taxes')).getByLabelText('unread')).toBeTruthy()
    expect(within(item('Gym')).getByLabelText('pinned')).toBeTruthy()
  })

  it('searches across collapsed groups and Hidden, and shows each match\'s group (ux-gieb)', () => {
    const server: Server = {
      robots: [robot('r-1', 'Gym Buddy', { groupId: 'g-1' }), robot('r-2', 'Gym Log', { hidden: true }), robot('r-3', 'Gym Free'), robot('r-4', 'Bills', { groupId: 'g-1' })],
      groups: [{ id: 'g-1', name: 'Health', collapsed: true }],
      changes: [],
    }
    show(server)
    expect(screen.queryByText('Gym Buddy')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'gym' } })
    const rows = [...document.querySelectorAll('.robot-item')].map((row) => [row.querySelector('.robot-name')?.textContent, row.querySelector('.robot-place')?.textContent ?? null])
    expect(rows).toEqual([['Gym Buddy', 'Health'], ['Gym Log', 'Hidden'], ['Gym Free', null]])
  })
})
