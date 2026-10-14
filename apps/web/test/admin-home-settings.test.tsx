import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminView, ModelOption } from '@mr-robot/protocol'
import { Admin } from '../src/components/Admin.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const option = (provider: string, model: string, label: string): ModelOption => ({ provider, model, label, contextWindow: 128_000 })
const kimi = option('workers-ai', '@cf/moonshotai/kimi-k2.6', 'Kimi K2.6')
const sonnet = option('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5')
const glm = option('opencode-go', 'glm-5', 'GLM 5')
const settings = {
  defaultModel: { provider: kimi.provider, model: kimi.model, effort: 'off' },
  workersAiEnabled: true,
  defaultBrowserBackend: 'browser-run',
  robotSpendLimitUsd: null,
  memberSpendLimitUsd: null,
  models: [kimi, sonnet, glm],
} as const
const view: AdminView = { fleet: [], routines: [], members: [], skills: [], skillRepository: null, providers: [], settings }

/** The Save button of Home settings: the one right after the spend limits. */
const saveHomeSettings = () => fireEvent.click(within(screen.getByLabelText('Member limit, USD/month').closest('.form')!.nextElementSibling as HTMLElement).getByRole('button', { name: 'Save' }))

interface Call { readonly method: string; readonly path: string; readonly body: string }

function stubApi(saved: unknown): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const method = request?.method ?? init?.method ?? 'GET'
    const path = new URL(request?.url ?? String(input), 'http://localhost').pathname
    const body = request === undefined ? (ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : typeof init?.body === 'string' ? init.body : '') : await request.clone().text()
    calls.push({ method, path, body })
    if (path === '/api/admin') return Response.json(view)
    if (path === '/api/home-memory') return Response.json({ content: '' })
    if (method === 'PATCH' && path === '/api/admin/settings') return Response.json(saved)
    return Response.json([])
  }))
  return calls
}

describe('Home settings in Admin (ux-3l7i, ux-101w, ux-jseo)', () => {
  it('chooses the default model with the Provider-grouped combobox and saves it', async () => {
    const calls = stubApi({ ...settings, defaultModel: { provider: 'opencode-go', model: 'glm-5', effort: 'off' } })
    render(<RegistryProvider><Admin /></RegistryProvider>)
    fireEvent.click(await screen.findByText('Kimi K2.6'))
    expect(within(screen.getByRole('listbox')).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Workers AI', 'Claude', 'OpenCode Go'])
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'glm' } })
    fireEvent.click(screen.getByRole('option', { name: 'GLM 5' }))
    expect(screen.getByText('GLM 5')).toBeTruthy()
    saveHomeSettings()
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = JSON.parse(calls.find((call) => call.method === 'PATCH')!.body) as Record<string, unknown>
    expect(patch).toMatchObject({ defaultModel: { provider: 'opencode-go', model: 'glm-5', effort: 'off' }, workersAiEnabled: true })
  })

  it('switches Workers AI off and says where the default model moved', async () => {
    const to = { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'off' }
    const calls = stubApi({ ...settings, workersAiEnabled: false, defaultModel: to, models: [sonnet, glm], defaultModelMoved: { from: settings.defaultModel, to } })
    render(<RegistryProvider><Admin /></RegistryProvider>)
    const workersAi = await screen.findByRole('switch', { name: 'Workers AI' })
    expect(screen.getByText('Models on this Cloudflare account, free of charge. Off: nobody in the Home can pick them and chains skip them.')).toBeTruthy()
    expect(workersAi.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(workersAi)
    expect(workersAi.getAttribute('aria-checked')).toBe('false')
    saveHomeSettings()
    expect(await screen.findByText('Default model moved to Claude Sonnet 5.5.')).toBeTruthy()
    expect(JSON.parse(calls.find((call) => call.method === 'PATCH')!.body)).toMatchObject({ workersAiEnabled: false })
    expect(screen.getByText('Claude Sonnet 5.5')).toBeTruthy()
  })
})
