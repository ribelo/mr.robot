import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewRobot } from '../src/components/NewRobot.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const providers = {
  mine: [],
  shared: [],
  models: [{ provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6', contextWindow: 128_000 }],
  defaultModel: { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6', effort: 'off' },
  workersAiEnabled: true,
}

interface Call { readonly method: string; readonly path: string; readonly body: string }

function stubFetch(calls: Call[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    const method = request?.method ?? init?.method ?? 'GET'
    const path = new URL(request?.url ?? String(input), 'http://localhost').pathname
    const body = request === undefined ? (ArrayBuffer.isView(init?.body) ? new TextDecoder().decode(init.body) : typeof init?.body === 'string' ? init.body : '') : await request.clone().text()
    calls.push({ method, path, body })
    if (path === '/api/providers') return Response.json(providers)
    if (method === 'POST' && path === '/api/robots') return Response.json({ id: 'r-new' })
    return Response.json([])
  }))
}

describe('the New robot dialog (ux-hckf, ux-1pjk)', () => {
  it('asks only for the model, says what happens next, and creates the Robot without a brief', async () => {
    const calls: Call[] = []
    stubFetch(calls)
    const created = vi.fn()
    render(<RegistryProvider><NewRobot onCancel={() => {}} onCreated={created} /></RegistryProvider>)
    await screen.findByText('Kimi K2.6')
    expect(screen.queryByText(/What should it do\?/)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('It asks you what it is for, then proposes its name and what it needs; you approve.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(created).toHaveBeenCalledWith('r-new'))
    const create = calls.filter((call) => call.method === 'POST' && call.path === '/api/robots')
    expect(create).toHaveLength(1)
    expect(JSON.parse(create[0]!.body)).toEqual({ model: providers.defaultModel })
  })
})
