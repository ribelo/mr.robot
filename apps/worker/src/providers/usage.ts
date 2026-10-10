/**
 * Account usage and health (v1.10 tickets 04 and 05). Claude: the undocumented OAuth usage endpoint that
 * Claude Code's /usage reads. OpenCode Go: its usage endpoint for an API key. The other Providers have no
 * usage endpoint; "Check now" makes one cheap authenticated request instead (pa-hq0v, pa-afb9).
 */
import type { UsageWindow } from '@mr-robot/protocol'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'

export type Probe =
  | { readonly kind: 'ok'; readonly windows: readonly UsageWindow[] | null }
  | { readonly kind: 'limited'; readonly until: number | null; readonly note: string; readonly windows: readonly UsageWindow[] | null }
  | { readonly kind: 'broken'; readonly note: string }
  | { readonly kind: 'unknown'; readonly note: string }

const CLAUDE_NAMES: Record<string, string> = { five_hour: 'Current session', seven_day: 'This week' }

function claudeName(key: string): string {
  if (CLAUDE_NAMES[key] !== undefined) return CLAUDE_NAMES[key]
  const model = /^seven_day_(.+)$/.exec(key)?.[1]
  if (model !== undefined) return `${model.charAt(0).toUpperCase()}${model.slice(1).replaceAll('_', ' ')} this week`
  return key.replaceAll('_', ' ')
}

/** Claude's windows: every field with a utilization (percent used) and a reset time (pa-lmbl). */
export function claudeWindows(body: unknown): UsageWindow[] {
  if (body === null || typeof body !== 'object') return []
  return Object.entries(body as Record<string, unknown>).flatMap(([key, value]) => {
    if (value === null || typeof value !== 'object') return []
    const { utilization, resets_at } = value as { utilization?: unknown; resets_at?: unknown }
    if (typeof utilization !== 'number') return []
    return [{ name: claudeName(key), percent: Math.round(utilization), resetsAt: typeof resets_at === 'string' ? resets_at : null }]
  })
}

const OPENCODE_NAMES: Record<string, string> = { rolling: 'Rolling (5 hours)', weekly: 'This week', monthly: 'This month' }

/** OpenCode Go's rolling, weekly and monthly windows (pa-sps4). */
export function opencodeWindows(body: unknown): Array<UsageWindow & { limited: boolean }> {
  const usage = (body as { usage?: Record<string, { status?: unknown; percent?: unknown; resetsAt?: unknown }> } | null)?.usage
  if (usage === undefined || usage === null) return []
  return Object.entries(usage).flatMap(([key, value]) => typeof value?.percent !== 'number' ? [] : [{
    name: OPENCODE_NAMES[key] ?? key, percent: Math.round(value.percent), resetsAt: typeof value.resetsAt === 'string' ? value.resetsAt : null, limited: value.status === 'rate-limited',
  }])
}

const fullWindow = (windows: readonly UsageWindow[]) => windows.filter((window) => window.percent >= 100).map((window) => (window.resetsAt === null ? null : Date.parse(window.resetsAt)))

async function answer(response: Response): Promise<Probe | undefined> {
  if (response.status === 401 || response.status === 402 || response.status === 403) return { kind: 'broken', note: `${response.status}: ${(await response.text().catch(() => '')).slice(0, 160) || response.statusText}` }
  if (response.status === 429) return { kind: 'limited', until: null, note: 'limit reached', windows: null }
  if (!response.ok) return { kind: 'unknown', note: `the Provider answered ${response.status}` }
  return undefined
}

/** Ask the Provider how this account is doing; never throws. */
export async function probeAccount(provider: ProviderId, credential: ProviderCredential, fetcher: typeof fetch = fetch): Promise<Probe> {
  try {
    switch (provider) {
      case 'anthropic': {
        if (credential.kind !== 'oauth') return { kind: 'unknown', note: 'not a subscription' }
        const response = await fetcher('https://api.anthropic.com/api/oauth/usage', { headers: { authorization: `Bearer ${credential.access}`, 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': 'mr-robot' } })
        const failed = await answer(response)
        if (failed !== undefined) return failed
        const windows = claudeWindows(await response.json())
        const full = fullWindow(windows)
        return full.length > 0 ? { kind: 'limited', until: full.find((at) => at !== null) ?? null, note: 'a usage window is full', windows } : { kind: 'ok', windows }
      }
      case 'opencode-go': {
        if (credential.kind !== 'api-key') return { kind: 'unknown', note: 'no key' }
        const response = await fetcher('https://opencode.ai/zen/go/v1/usage', { headers: { authorization: `Bearer ${credential.key}` } })
        const failed = await answer(response)
        if (failed !== undefined) return failed
        const windows = opencodeWindows(await response.json())
        const limited = windows.filter((window) => window.limited)
        const shown = windows.map(({ name, percent, resetsAt }) => ({ name, percent, resetsAt }))
        if (limited.length === 0) return { kind: 'ok', windows: shown }
        const until = Math.max(...limited.map((window) => (window.resetsAt === null ? 0 : Date.parse(window.resetsAt))))
        return { kind: 'limited', until: until > 0 ? until : null, note: `${limited.map((window) => window.name).join(', ')} limit reached`, windows: shown }
      }
      case 'deepseek': {
        if (credential.kind !== 'api-key') return { kind: 'unknown', note: 'no key' }
        const response = await fetcher('https://api.deepseek.com/user/balance', { headers: { authorization: `Bearer ${credential.key}` } })
        const failed = await answer(response)
        if (failed !== undefined) return failed
        const body = await response.json() as { is_available?: boolean }
        return body.is_available === false ? { kind: 'broken', note: 'no balance left' } : { kind: 'ok', windows: null }
      }
      case 'openrouter': {
        if (credential.kind !== 'api-key') return { kind: 'unknown', note: 'no key' }
        const response = await fetcher('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${credential.key}` } })
        return (await answer(response)) ?? { kind: 'ok', windows: null }
      }
      case 'openai':
        // A fresh access token (refreshed when the account was opened) is the check ChatGPT allows.
        return credential.kind === 'oauth' ? { kind: 'ok', windows: null } : { kind: 'unknown', note: 'not a subscription' }
      default:
        return { kind: 'ok', windows: null }
    }
  } catch (error) {
    return { kind: 'unknown', note: error instanceof Error ? error.message : String(error) }
  }
}
