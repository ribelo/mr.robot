/**
 * The model chain (v1.10): the ordered account + model entries a Robot may run on. Nothing moves
 * between entries silently; the active entry is the one `config.model` mirrors.
 */
import type { ChainEntry, ModelChoice } from '@mr-robot/protocol'
import type { RobotConfig } from './store.ts'

/** A Robot made before chains existed runs on one entry: its model, bound to an account at first use (pa-l3l9). */
export function chainOf(config: Pick<RobotConfig, 'chain' | 'model'>): readonly ChainEntry[] {
  return config.chain !== undefined && config.chain.length > 0 ? config.chain : [unbound(config.model)]
}

export function unbound(model: ModelChoice): ChainEntry {
  return { account: model.provider === 'workers-ai' ? 'workers-ai' : '', owner: '', provider: model.provider, model: model.model, effort: model.effort }
}

export function modelOf(entry: ChainEntry): ModelChoice {
  return { provider: entry.provider, model: entry.model, effort: entry.effort }
}

/** A changed model for the active entry: the account stays when the Provider does (pa-w81r). */
export function withModel(chain: readonly ChainEntry[], active: number, model: ModelChoice): ChainEntry[] {
  return chain.map((entry, index) => index !== active ? entry : entry.provider === model.provider ? { ...entry, model: model.model, effort: model.effort } : unbound(model))
}

/** Why a Workers AI entry is skipped while the Space admin has Workers AI off (ux-zh1l). */
export const WORKERS_AI_OFF = 'Workers AI is disabled by the admin'

/** The Provider accounts a chain names, for "used by" (pa-f59m). */
export function chainAccounts(chain: readonly ChainEntry[]): string[] {
  return [...new Set(chain.map((entry) => entry.account).filter((account) => account !== '' && account !== 'workers-ai'))]
}

/** What a failed model call says about its account: a limit, a broken account, or neither (pa-gqff, pa-bc78). */
export function failureKind(failure: { code?: string; status?: number; message?: string }): 'limited' | 'broken' | null {
  if (failure.status === 429 || (failure.code === 'RATE_LIMIT' && failure.status !== 529 && failure.status !== 503)) return 'limited'
  if (failure.status === 401 || failure.status === 402 || failure.status === 403 || failure.code === 'AUTH') return 'broken'
  return null
}

/** A time as the owner reads it, in the Robot's zone. */
export function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(at)
}
