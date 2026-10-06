import { env, SELF } from 'cloudflare:test'
import type { RobotSummary } from '@mr-robot/protocol'

export const STUB_MODEL = { provider: 'stub', model: 'stub', effort: 'off' } as const

/** Use the stub model for every Robot the Home creates (call before the first sign-in). */
export async function stubModels(): Promise<void> {
  await env.HOME.getByName('home').updateSettings({ defaultModel: STUB_MODEL })
}

/** Call the edge API as a person (signed in through the dev identity). */
export async function api<T = unknown>(as: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const response = await SELF.fetch(`https://mr-robot.test${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { 'x-dev-identity': as, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: response.status, body: (await response.json()) as T }
}

export async function robots(as: string): Promise<RobotSummary[]> {
  return (await api<RobotSummary[]>(as, '/api/robots')).body
}

export async function settle(id: string): Promise<void> {
  await env.ROBOT.getByName(id).settled()
}
