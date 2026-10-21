import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type RobotPanel, type SettingsCatalog, type SettingsPatch, type TaskView } from '@mr-robot/protocol'
import { Panel } from '../src/components/Panel.tsx'
import { AdvancedSettings } from '../src/components/AdvancedSettings.tsx'
import { EditProfileSheet } from '../src/components/RobotSheets.tsx'
import { TaskSheet } from '../src/components/TaskSheets.tsx'

afterEach(cleanup)

const panel: RobotPanel = {
  summary: {
    id: 'r-1', ownerId: 'm-1', ownerName: 'Anna', kind: 'robot', sharing: 'private', status: 'active', fleetState: 'sleeping', turn: null, lastWakeup: null,
    identity: { name: 'Sales Outbound', title: 'Sales', description: 'Works the pipeline overnight.', avatarColor: '#f4a03a', avatarSeed: 'seed-1' },
    lastLine: 'Done.', lastAt: 0, unread: false,
  },
  settings: {
    identity: { name: 'Sales Outbound', title: 'Sales', description: 'Works the pipeline overnight.', avatarColor: '#f4a03a', avatarSeed: 'seed-1' },
    sharing: 'private', model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, chain: [{ account: '', owner: '', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }], contextBudget: 128000,
    codeMode: true, wakeOnScreenNotifications: false, browserBackend: null, compactionInstruction: '', grants: emptyGrants,
    notifications: { enabled: true, members: [], channels: ['pwa'] }, spendLimit: { kind: 'space' }, spaceSpendLimit: { kind: 'none' }, discordChannel: null, discordProactive: true, cacheWarming: false, idleCompaction: true, idleCompactionFloorTokens: 20000, autoReview: false, reviewer: null, spaceReviewer: null, subagentModels: [],
  },
  tasks: [],
  screen: { path: 'screens/last.png', url: '/api/robots/r-1/screen', at: 0 },
  usage: { month: '2026-10', inputTokens: 12000, outputTokens: 3000, costUsd: 0.42, breakdown: { model: { robot: 0.42, review: 0, subagent: 0 }, browser: 0, box: 0, services: 0, total: 0.42 }, limit: { limit: { kind: 'usd', amount: 5 }, from: 'robot' } },
  canEdit: true,
  takeover: null,
}

const task: TaskView = {
  id: 't-1', title: 'Overnight outbound', instructions: 'Work the queue', createdBy: { kind: 'member', memberId: 'm-1', name: 'Anna' },
  assignee: { kind: 'robot', robotId: 'r-1' }, parentId: null, timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '02:00', weekdays: [7] }, timeZone: 'Europe/Warsaw', next: Date.parse('2026-10-11T00:00:00Z'), paused: false },
  remind: { kind: 'none' }, state: 'open', external: null, createdAt: 0, updatedAt: 0, children: 0, overdue: false, attempts: [
    { robotId: 'r-1', startedAt: Date.parse('2026-10-11T00:00:00Z'), finishedAt: Date.parse('2026-10-11T00:00:00Z'), outcome: 'skipped', firstLine: 'The previous run had not finished.' },
    { robotId: 'r-1', startedAt: Date.parse('2026-10-04T00:00:00Z'), finishedAt: Date.parse('2026-10-04T00:03:00Z'), outcome: 'ok', firstLine: 'Queue worked: 12 leads.' },
  ],
}
const withTask: RobotPanel = { ...panel, tasks: [task] }

const handlers = () => ({
  onOpenTask: vi.fn(), onEditProfile: vi.fn(), onOpenScreen: vi.fn(), onAdvanced: vi.fn(), onTrajectory: vi.fn(), onFiles: vi.fn(), onClose: vi.fn(),
})

describe('Panel (robot-z3ud)', () => {
  it('shows the screen and the Tasks; a Task opens its detail, ⚙ opens the profile (mc-n6ff)', () => {
    const on = handlers()
    render(<Panel panel={withTask} {...on} />)
    expect(screen.getByText('Sales Outbound’s screen')).toBeTruthy()
    expect(screen.getByText(/^Sundays at 02:00 · next /)).toBeTruthy()
    expect(screen.getByText('Open')).toBeTruthy()
    fireEvent.click(screen.getByText('Overnight outbound'))
    expect(on.onOpenTask).toHaveBeenCalledWith('t-1')
    fireEvent.click(screen.getByLabelText('Edit profile'))
    expect(on.onEditProfile).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText("Sales Outbound's screen"))
    expect(on.onOpenScreen).toHaveBeenCalled()
  })

  it('hides editing from a Member who only shares the Robot', () => {
    render(<Panel panel={{ ...panel, canEdit: false }} {...handlers()} />)
    expect(screen.queryByLabelText('Edit profile')).toBeNull()
  })
})

describe('Robot and Task sheets (robot-lulc, mc-m9ii)', () => {
  const serve = () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname
      const raw = init?.body
      const text = raw === undefined || raw === null ? undefined : ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : String(raw)
      calls.push({ path, method: init?.method ?? 'GET', body: text === undefined ? undefined : JSON.parse(text) })
      if (path.endsWith('/panel')) return Response.json(panel)
      // The server answers a settings change with the saved settings, a Task change with the Task.
      if (path.endsWith('/settings')) return Response.json(panel.settings)
      if (path === '/api/tasks/t-1') return Response.json(task)
      if (path === '/api/tasks') return Response.json({ tasks: [], next: null })
      if (path === '/api/members') return Response.json([{ id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#3b82f6' } }])
      if (path === '/api/robots') return Response.json([panel.summary])
      if (path.endsWith('/pause')) return Response.json({ ...task, timing: { ...task.timing, paused: true } })
      return Response.json({ ok: true })
    }))
    return calls
  }

  it('the Task detail shows doer, schedule, instructions and attempts, and pauses (mc-m9ii, mc-t4dd)', async () => {
    const calls = serve()
    render(<RegistryProvider><TaskSheet taskId="t-1" onClose={vi.fn()} /></RegistryProvider>)
    expect(await screen.findByText('Work the queue')).toBeTruthy()
    expect(screen.getByText('Europe/Warsaw')).toBeTruthy()
    expect(await screen.findByText('Sales Outbound', { selector: 'dd' })).toBeTruthy()
    expect(screen.getByText('Queue worked: 12 leads.')).toBeTruthy()
    expect(screen.getByText('Skipped: The previous run had not finished.')).toBeTruthy()
    fireEvent.click(screen.getByText('Pause'))
    await vi.waitFor(() => expect(calls.some((call) => call.path === '/api/tasks/t-1/pause')).toBe(true))
    expect(calls.find((call) => call.path.endsWith('/pause'))!.body).toEqual({ paused: true })
    vi.unstubAllGlobals()
  })

  it('edit profile saves name and notifications together', async () => {
    const calls = serve()
    const closed = vi.fn()
    render(<RegistryProvider><EditProfileSheet robotId="r-1" onClose={closed} onOpenTask={vi.fn()} /></RegistryProvider>)
    fireEvent.change(await screen.findByDisplayValue('Sales Outbound'), { target: { value: 'Outbound' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Notifications' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Wake on screen notifications' }))
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(closed).toHaveBeenCalled())
    expect(calls.find((call) => call.method === 'PATCH')!.body).toMatchObject({ identity: { name: 'Outbound' }, notifications: { enabled: false }, wakeOnScreenNotifications: true })
    vi.unstubAllGlobals()
  })
})
describe('grant levels in Advanced settings (sk-746n, sk-8llz)', () => {
  const catalog: SettingsCatalog = {
    toolGroups: [{ name: 'web', description: 'Fetch web pages' }, { name: 'files', description: 'Its Workspace' }, { name: 'deputy', description: 'Mr. Robot only' }],
    skills: [], robots: [{ id: 'r-2', name: 'Accountant' }], secrets: [{ name: 'shop', scope: 'member' }], models: [], workersAiEnabled: true,
  }
  const settingsOf = (patch: Partial<RobotPanel['settings']>, kind: 'robot' | 'mr-robot'): RobotPanel => ({ ...panel, summary: { ...panel.summary, kind }, settings: { ...panel.settings, ...patch } })
  const open = (shown: RobotPanel) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sections: [], tools: [], skills: [] })))
    const saved: SettingsPatch[] = []
    render(<RegistryProvider><AdvancedSettings panel={shown} catalog={catalog} onSave={async (patch) => { saved.push(patch); return true }} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onStartOver={vi.fn()} /></RegistryProvider>)
    return saved
  }
  const levelOf = (item: string) => screen.getByRole('radiogroup', { name: item }).querySelector('[aria-checked="true"]')?.textContent

  it('shows allow, ask or deny per item, deny when not granted, and saves the chosen level', async () => {
    const saved = open(settingsOf({ grants: { ...emptyGrants, tools: { web: 'ask' } } }, 'robot'))
    expect(levelOf('web')).toBe('ask')
    expect(levelOf('files')).toBe('deny')
    expect(levelOf('Accountant')).toBe('deny')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'files' })).getByRole('radio', { name: 'allow' }))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'shop' })).getByRole('radio', { name: 'ask' }))
    expect(levelOf('files')).toBe('allow')
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.grants).toMatchObject({ tools: { web: 'ask', files: 'allow' }, secrets: { shop: 'ask' } })
    vi.unstubAllGlobals()
  })

  it("shows Mr. Robot's real levels, lets the owner lower one, and keeps his recipients automatic", async () => {
    const saved = open(settingsOf({ grants: { ...emptyGrants, tools: { web: 'allow', files: 'allow', deputy: 'allow' }, secrets: { shop: 'allow' } } }, 'mr-robot'))
    expect(levelOf('deputy')).toBe('allow')
    expect(levelOf('shop')).toBe('allow')
    expect(screen.getByText('Mr. Robot can message every Robot you can reach.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Accountant' })).toBeNull()
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'web' })).getByRole('radio', { name: 'deny' }))
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.grants).toMatchObject({ tools: { web: 'deny', files: 'allow', deputy: 'allow' } })
    vi.unstubAllGlobals()
  })
})
