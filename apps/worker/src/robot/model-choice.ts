import type { ModelChoice } from '@mr-robot/protocol'
import { PROVIDER_IDS } from '../agent/providers.ts'
import { HOME_ID, type Env } from '../env.ts'

/**
 * Why a Robot may not be switched to this model, or null when it may (robot-mx6s): its owner needs a
 * credential for the Provider. The owner's settings page and Mr. Robot's deputy tools share this rule.
 */
export async function modelRefusal(env: Env, ownerId: string, current: ModelChoice, chosen: ModelChoice): Promise<string | null> {
  const changed = current.provider !== chosen.provider || current.model !== chosen.model
  if (!changed || !(PROVIDER_IDS as readonly string[]).includes(chosen.provider)) return null
  const offered = await env.HOME.getByName(HOME_ID).models(ownerId)
  return offered.some((option) => option.provider === chosen.provider && option.model === chosen.model)
    ? null
    : `${chosen.model} is not offered to you: connect its Provider under your name → Providers first`
}
