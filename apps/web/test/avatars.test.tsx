import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type AdminView, type ChatItem, type Me, type RobotPanel, type RobotSummary } from '@mr-robot/protocol'
import { RobotConversation } from '../src/App.tsx'
import { Admin } from '../src/components/Admin.tsx'
import { ChatView } from '../src/components/ChatView.tsx'
import { RobotList } from '../src/components/RobotList.tsx'
import { EditProfileSheet } from '../src/components/RobotSheets.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const at = Date.parse('2026-10-14T10:00:00Z')
const identity = { name: 'Sales Outbound', title: 'Sales', description: 'Works the pipeline overnight.', avatarColor: '#f4a03a', avatarSeed: 'seed-sales' }
const summary: RobotSummary = {
  id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null,
  identity, lastLine: 'Done.', lastAt: 0, unread: false,
}
const usage = { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0, breakdown: { model: { robot: 0, review: 0, subagent: 0 }, browser: 0, computer: 0, services: 0, total: 0 }, limit: { limit: { kind: 'none' as const }, from: 'home' as const } }
const panel: RobotPanel = {
  summary,
  settings: {
    identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' },
    chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }], contextBudget: 128000,
    codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants,
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'home' }, homeSpendLimit: { kind: 'none' },
    discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, homeReviewer: null,
  },
  tasks: [], screen: null, usage, canEdit: true, takeover: null,
}
const me = { id: 'm-1', email: 'a@example.com', name: 'Anna Nowak', role: 'admin', status: 'active', avatar: { kind: 'picture', color: '#6c63ff', key: 'avatar-0123456789abcdef01234567' } } as Me

/** The seed each rendered Robot avatar is drawn from, and the ball drawn. */
const faces = (root: ParentNode) => [...root.querySelectorAll('.avatar-face')].map((node) => ({ seed: node.getAttribute('data-seed'), look: node.innerHTML }))

interface Call { readonly method: string; readonly path: string; readonly body: string }

function stubApi(answer: (path: string) => unknown): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const method = request?.method ?? init?.method ?? 'GET'
    const path = new URL(request?.url ?? String(input), 'http://localhost').pathname
    const body = request === undefined ? (ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : typeof init?.body === 'string' ? init.body : '') : await request.clone().text()
    calls.push({ method, path, body })
    return Response.json(answer(path) ?? {})
  }))
  return calls
}

describe('Robot avatars (ux-0zm6, ux-n1mw)', () => {
  it('draws the same robot for the same seed and another one for another seed', () => {
    const items: ChatItem[] = [
      { kind: 'message', id: 'a', seq: 1, at, sender: { kind: 'robot', robotId: 'r-2', name: 'Chief', avatarColor: '#8b5cf6', avatarSeed: 'seed-chief' }, text: 'One', attachments: [], reaction: null },
      { kind: 'message', id: 'b', seq: 2, at, sender: { kind: 'robot', robotId: 'r-3', name: 'Clerk', avatarColor: '#8b5cf6', avatarSeed: 'seed-clerk' }, text: 'Two', attachments: [], reaction: null },
    ]
    const { container } = render(<ChatView items={items} meId="m-1" working={false} canAnswer={false} now={at} />)
    // The header line names both senders, then each message carries its sender's avatar.
    const drawn = faces(container)
    expect(drawn.map((face) => face.seed)).toEqual(['seed-chief', 'seed-clerk', 'seed-chief', 'seed-clerk'])
    expect(drawn[0]!.look).toBe(drawn[2]!.look)
    expect(drawn[0]!.look).not.toBe(drawn[1]!.look)
  })

  it('shows the avatar in the sidebar and the conversation header, and the Member in the sidebar foot', () => {
    const list = render(<RegistryProvider><RobotList robots={[summary]} selected={undefined} meName={me.name} meAvatar={me.avatar} meId={me.id} isAdmin={false} onSelect={() => {}} onCreate={() => {}} onAdmin={() => {}} onProfile={() => {}} groups={[]} onGroupChange={async () => true} onListPref={() => {}} onEditProfile={() => {}} onAdvanced={() => {}} onFiles={() => {}} /></RegistryProvider>)
    expect(faces(list.container.querySelector('.robot-row')!).map((face) => face.seed)).toEqual(['seed-sales'])
    expect(list.container.querySelector('.sidebar-foot img.member-face')?.getAttribute('src')).toBe('/api/members/m-1/avatar/avatar-0123456789abcdef01234567')
    cleanup()
    const initials = render(<RegistryProvider><RobotList robots={[]} selected={undefined} meName="Anna Nowak" meAvatar={{ kind: 'initials', color: '#10b981' }} meId="m-1" isAdmin={false} onSelect={() => {}} onCreate={() => {}} onAdmin={() => {}} onProfile={() => {}} groups={[]} onGroupChange={async () => true} onListPref={() => {}} onEditProfile={() => {}} onAdvanced={() => {}} onFiles={() => {}} /></RegistryProvider>)
    const face = initials.getByRole('img', { name: 'Anna Nowak' })
    expect(face.textContent).toBe('AN')
    expect(face.style.background).toBe('rgb(16, 185, 129)')
    cleanup()
    const header = render(<RegistryProvider><RobotConversation route={{ page: 'robot', id: 'r-1', panel: false }} me={me} robot={summary} conversation={{ robotId: 'r-1', items: [], working: false }} panel={panel} stream={null} onSheet={() => {}} /></RegistryProvider>)
    expect(faces(header.container.querySelector('.conversation-head')!).map((face) => face.seed)).toEqual(['seed-sales'])
  })

  it('shows Robots and Members with their avatars in the Admin tables', async () => {
    const view: AdminView = {
      fleet: [{ ...summary, grants: emptyGrants, model: panel.settings.model, usage }],
      robotsToMigrate: 0,
      members: [{ id: 'm-1', email: 'a@example.com', name: 'Anna Nowak', role: 'admin', status: 'active', avatar: me.avatar, usage }, { id: 'm-2', email: 'b@example.com', name: 'Ben', role: 'member', status: 'active', avatar: { kind: 'initials', color: '#3b82f6' }, usage }],
      skills: [], skillRepository: null, providers: [],
      settings: { defaultModel: panel.settings.model, workersAiEnabled: true, defaultBrowserBackend: 'browser-run', robotSpendLimit: { kind: 'none' }, memberSpendLimit: { kind: 'none' }, defaultReviewer: null, models: [] },
    }
    stubApi((path) => (path === '/api/admin' ? view : path === '/api/home-memory' ? { content: '' } : undefined))
    const { container } = render(<RegistryProvider><Admin /></RegistryProvider>)
    await screen.findByText('Sales Outbound')
    expect(faces(container).map((face) => face.seed)).toEqual(['seed-sales'])
    expect(container.querySelector('img.member-face')?.getAttribute('src')).toBe('/api/members/m-1/avatar/avatar-0123456789abcdef01234567')
    expect(screen.getByRole('img', { name: 'Ben' }).textContent).toBe('B')
  })
})

describe('Another look (ux-h0s4)', () => {
  it('draws a new seed into the preview and saves it with the profile', async () => {
    const calls = stubApi((path) => (path === '/api/robots/r-1/panel' ? panel : path === '/api/robots/r-1/settings' ? panel.settings : undefined))
    render(<RegistryProvider><EditProfileSheet robotId="r-1" onClose={() => {}} onOpenTask={() => {}} /></RegistryProvider>)
    await screen.findByText('Another look')
    const preview = () => faces(document.querySelector('.sheet-avatar')!)[0]!
    const before = preview()
    expect(before.seed).toBe('seed-sales')
    fireEvent.click(screen.getByText('Another look'))
    const after = preview()
    expect(after.seed).not.toBe('seed-sales')
    expect(after.look).not.toBe(before.look)
    // Nothing is saved until Save.
    expect(calls.filter((call) => call.method === 'PATCH')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const saved = JSON.parse(calls.find((call) => call.method === 'PATCH')!.body) as { identity: { avatarSeed: string; avatarColor: string } }
    expect(saved.identity).toMatchObject({ avatarSeed: after.seed, avatarColor: '#f4a03a' })
  })
})
