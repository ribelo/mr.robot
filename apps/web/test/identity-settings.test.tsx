import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type Me, type RobotPanel, type RobotSummary } from '@mr-robot/protocol'
import { RobotConversation } from '../src/App.tsx'
import { RobotList } from '../src/components/RobotList.tsx'
import { EditProfileSheet } from '../src/components/RobotSheets.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const identity = { name: 'Flat Watcher', title: 'Flat hunter', description: 'Watches Otodom and tells me about new flats.', avatarColor: '#10b981', avatarSeed: 'seed-flat' }
const summary: RobotSummary = {
  id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null,
  identity, lastLine: 'Done.', lastAt: 0, unread: false,
}
const usage = { month: '2026-10', inputTokens: 0, outputTokens: 0, costUsd: 0, breakdown: { model: { robot: 0, review: 0, subagent: 0, memory: 0 }, browser: 0, box: 0, services: 0, total: 0 }, limit: { limit: { kind: 'none' as const }, from: 'space' as const } }
const panel = (canEdit: boolean): RobotPanel => ({
  summary,
  settings: {
    identity, sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' },
    chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }], contextBudget: 128000,
    codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants,
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'space' }, spaceSpendLimit: { kind: 'none' },
    discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, spaceReviewer: null, subagentModels: [],
  },
  tasks: [], screen: null, usage, canEdit, takeover: null,
})
const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' } } as Me

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

describe('identity after setup (gb-4563)', () => {
  it("shows the title and description the Robot set, and leaves the name to the owner: they change it and save", async () => {
    const calls = stubApi((path) => (path === '/api/robots/r-1/panel' ? panel(true) : path === '/api/robots/r-1/settings' ? panel(true).settings : undefined))
    render(<RegistryProvider><EditProfileSheet robotId="r-1" onClose={() => {}} onOpenTask={() => {}} /></RegistryProvider>)
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement
    expect((screen.getByLabelText('Title (optional)') as HTMLInputElement).value).toBe('Flat hunter')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Watches Otodom and tells me about new flats.')
    expect(name.disabled).toBe(false)
    fireEvent.change(name, { target: { value: 'Flat Keeper' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const saved = JSON.parse(calls.find((call) => call.method === 'PATCH')!.body) as { identity: { name: string; title: string } }
    expect(saved.identity).toMatchObject({ name: 'Flat Keeper', title: 'Flat hunter' })
  })

  it('a Member who only shares the Robot cannot rename it', async () => {
    stubApi((path) => (path === '/api/robots/r-1/panel' ? panel(false) : undefined))
    render(<RegistryProvider><EditProfileSheet robotId="r-1" onClose={() => {}} onOpenTask={() => {}} /></RegistryProvider>)
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).disabled).toBe(true)
  })

  it("shows the Robot in the sidebar and in the Conversation header under the name its owner gave", () => {
    const list = render(<RegistryProvider><RobotList robots={[summary]} selected={undefined} meName={me.name} meAvatar={me.avatar} meId={me.id} isAdmin={false} onSelect={() => {}} onCreate={() => {}} onAdmin={() => {}} onProfile={() => {}} groups={[]} onGroupChange={async () => true} onListPref={() => {}} onEditProfile={() => {}} onAdvanced={() => {}} onFiles={() => {}} /></RegistryProvider>)
    expect(list.container.querySelector('.robot-row')?.textContent).toContain('Flat Watcher')
    cleanup()
    const header = render(<RegistryProvider><RobotConversation route={{ page: 'robot', id: 'r-1', panel: false }} me={me} robot={summary} conversation={{ robotId: 'r-1', items: [], working: false }} panel={panel(true)} stream={null} onSheet={() => {}} /></RegistryProvider>)
    expect(header.container.querySelector('.conversation-head')?.textContent).toContain('Flat Watcher')
  })
})
