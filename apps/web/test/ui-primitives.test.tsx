import { RegistryProvider } from '@effect/atom-react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderView } from '@mr-robot/protocol'
import { FilesView } from '../src/components/FilesView.tsx'
import { Profile } from '../src/components/Profile.tsx'
import { SaveButton } from '../src/components/SaveButton.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const me = { id: 'm-1', email: 'a@example.com', name: 'Anna', role: 'admin', status: 'active', avatar: { kind: 'initials', color: '#6c63ff' }, space: 'Space', timeZone: 'UTC', timeZonePinned: false, detectedTimeZone: 'UTC', quietHours: null, vapidPublicKey: 'x', workDetails: 'compact', theme: 'system', mission: { group: 'assignee', state: 'open', wholeSpace: false, drawer: false }, acceptTasksFrom: [] }
const account: ProviderView = { id: 'a-1', provider: 'deepseek', label: 'DeepSeek key', kind: 'api-key', shared: false, connectedAt: 0, ownerId: 'm-1', ownerName: 'Anna', status: 'ok', note: null, until: null }

interface Call { readonly method: string; readonly path: string; readonly body: string }

/** A fake API: answer(method, path) gives the response; every request is recorded. */
function stubApi(answer: (method: string, path: string) => Response | Promise<Response>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const method = request?.method ?? init?.method ?? 'GET'
    const url = new URL(request?.url ?? String(input), 'http://localhost')
    const body = request === undefined ? (ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : typeof init?.body === 'string' ? init.body : '') : await request.clone().text()
    calls.push({ method, path: url.pathname + url.search, body })
    return answer(method, url.pathname)
  }))
  return calls
}

const providersApi = (check: (method: string) => Response | Promise<Response> = () => Response.json({})) => stubApi((method, path) =>
  path === '/api/providers' ? Response.json({ mine: [account], shared: [], models: [], defaultModel: { provider: 'deepseek', model: 'deepseek-chat', effort: 'medium' }, workersAiEnabled: true })
    : path === '/api/accounts/a-1/check' ? check(method)
    : Response.json({}))

const labelsOf = (button: HTMLElement) => [...button.querySelectorAll('span > span')].map((span) => span.textContent).sort()

describe('SaveButton (ux-jefs, ux-ivf4)', () => {
  it('goes Save → Saving… → Saved for two seconds → Save, and keeps every label so its width does not change', async () => {
    vi.useFakeTimers()
    let finish: (saved: boolean) => void = () => {}
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    render(<SaveButton onSave={onSave} />)
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    const labels = labelsOf(button)
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBe(button)
    expect(button.disabled).toBe(true)
    expect(labelsOf(button)).toEqual(labels)
    await act(async () => finish(true))
    expect(screen.getByRole('button', { name: 'Saved' })).toBe(button)
    expect(button.disabled).toBe(false)
    expect(labelsOf(button)).toEqual(labels)
    act(() => { vi.advanceTimersByTime(1999) })
    expect(screen.getByRole('button', { name: 'Saved' })).toBe(button)
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: 'Save' })).toBe(button)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('a press while it says Saved saves again; a failure returns it to Save', async () => {
    let finish: (saved: boolean) => void = () => {}
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    render(<SaveButton onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => finish(true))
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
    await act(async () => finish(false))
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('saves the profile with Saving… and Saved on the button and no loose "Saved." text', async () => {
    const calls = providersApi()
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    const you = screen.getAllByRole('button', { name: 'Save' })[0]!
    fireEvent.click(you)
    expect(you.textContent).toContain('Saving…')
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Saved' })).toHaveLength(1))
    expect(calls.some((call) => call.method === 'PATCH' && call.path === '/api/me')).toBe(true)
    expect(screen.queryByText('Saved.')).toBeNull()
  })
})

describe('inline rename of a Provider account (ux-h9wl)', () => {
  const renames = (calls: Call[]) => calls.filter((call) => call.method === 'PATCH' && call.path === '/api/accounts/a-1')

  it('Rename turns the label into a field; Enter saves the new name', async () => {
    const calls = providersApi()
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const field = screen.getByRole('textbox', { name: 'Name of this account' }) as HTMLInputElement
    expect(field.value).toBe('DeepSeek key')
    fireEvent.change(field, { target: { value: 'Work key' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(renames(calls)).toHaveLength(1))
    expect(JSON.parse(renames(calls)[0]!.body)).toEqual({ label: 'Work key' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name of this account' })).toBeNull())
  })

  it('leaving the field saves; Escape cancels without saving', async () => {
    const calls = providersApi()
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    let field = screen.getByRole('textbox', { name: 'Name of this account' })
    fireEvent.change(field, { target: { value: 'Not this' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Name of this account' })).toBeNull()
    expect(screen.getByText('DeepSeek key')).toBeTruthy()
    expect(renames(calls)).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    field = screen.getByRole('textbox', { name: 'Name of this account' })
    fireEvent.change(field, { target: { value: 'Space key' } })
    fireEvent.blur(field)
    await waitFor(() => expect(renames(calls)).toHaveLength(1))
    expect(JSON.parse(renames(calls)[0]!.body)).toEqual({ label: 'Space key' })
  })
})

describe('Check now on an account (ux-17sq)', () => {
  it('says Checking… while the check runs, then when it ran', async () => {
    let answer: (response: Response) => void = () => {}
    providersApi(() => new Promise<Response>((resolve) => { answer = resolve }))
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }))
    const checking = await screen.findByRole('button', { name: 'Checking…' }) as HTMLButtonElement
    expect(checking.disabled).toBe(true)
    answer(Response.json({}))
    const row = (await screen.findByText(/^Checked \d{1,2}:\d{2}/)).closest('li')!
    expect(within(row).getByRole('button', { name: 'Check now' })).toBeTruthy()
  })

  it('shows why the check failed', async () => {
    providersApi(() => Response.json({ error: 'the key was revoked' }, { status: 400 }))
    render(<RegistryProvider><Profile me={me as never} /></RegistryProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }))
    expect(await screen.findByText('Check failed: the key was revoked')).toBeTruthy()
  })
})

describe('inline name of a new local skill in Files (ux-kjli)', () => {
  const skillApi = () => stubApi((method, path) =>
    path === '/api/robots/r-1/files' ? Response.json([])
      : method === 'PUT' && path === '/api/robots/r-1/file' ? Response.json({ path: 'skills/invoices/SKILL.md', size: 10, text: '', readOnly: false, note: null })
      : Response.json({}))
  const creates = (calls: Call[]) => calls.filter((call) => call.method === 'PUT')

  it('names the skill in a field; a bad name is refused, Enter creates and opens it', async () => {
    const calls = skillApi()
    const onOpen = vi.fn()
    render(<RegistryProvider><FilesView robotId="r-1" path={null} canEdit onOpen={onOpen} /></RegistryProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'New local skill' }))
    const field = screen.getByRole('textbox', { name: 'Name of the new local skill' })
    fireEvent.change(field, { target: { value: 'Pay Bills' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByText('A skill name is lowercase letters, digits and dashes.')).toBeTruthy()
    expect(creates(calls)).toHaveLength(0)
    fireEvent.change(field, { target: { value: 'invoices' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('skills/invoices/SKILL.md'))
    expect(creates(calls)[0]!.path).toBe(`/api/robots/r-1/file?path=${encodeURIComponent('skills/invoices/SKILL.md')}`)
  })

  it('Escape leaves without creating anything', async () => {
    const calls = skillApi()
    render(<RegistryProvider><FilesView robotId="r-1" path={null} canEdit onOpen={vi.fn()} /></RegistryProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'New local skill' }))
    const field = screen.getByRole('textbox', { name: 'Name of the new local skill' })
    fireEvent.change(field, { target: { value: 'invoices' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'New local skill' })).toBeTruthy()
    expect(creates(calls)).toHaveLength(0)
  })
})

describe('no window.prompt() in the PWA (ux-xbt3)', () => {
  const src = join(import.meta.dirname, '../src')
  const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []
  })

  it('calls prompt() nowhere: the desktop app does not implement it', () => {
    // A method named prompt on another object (api.prompt) is not window.prompt.
    const call = /(?:\b(?:window|globalThis|self)\s*\.\s*|(?<![\w$.]))prompt\s*\(/
    const offenders = sources(src).filter((path) => call.test(readFileSync(path, 'utf8'))).map((path) => path.slice(src.length + 1))
    expect(offenders).toEqual([])
  })
})
