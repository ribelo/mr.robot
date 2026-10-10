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

/** The Provider accounts a chain names, for "used by" (pa-f59m). */
export function chainAccounts(chain: readonly ChainEntry[]): string[] {
  return [...new Set(chain.map((entry) => entry.account).filter((account) => account !== '' && account !== 'workers-ai'))]
}
