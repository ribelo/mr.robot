/**
 * Cache warming and idle compaction (v1.14 ticket 09): nothing happens inside a Turn or while anything is
 * queued. When a Turn ends with an empty queue the Robot plans its idle moments; any Wake-up drops the plan.
 * The moments follow the Provider's cache window (ao-c3er): on a one-hour cache the refresh delay is 54
 * minutes (90 % of the window, at most the window less 10 s), so warming comes at 54, 108 and 162 minutes
 * and idle compaction once at 54. A Provider without a known window gets no warming; compaction comes at 54.
 */
import type { RobotConfig } from './store.ts'

export const DEFAULT_IDLE_FLOOR_TOKENS = 20_000
const HOUR = 3_600_000
const FALLBACK_DELAY = 54 * 60_000
const WARMINGS = 3

/** The prompt cache window of a Provider, when it is known: Claude keeps a one-hour cache (Mr. Robot asks for it). */
export function cacheWindowOf(provider: string): number | null {
  return provider === 'anthropic' ? HOUR : null
}

/** The idle settings in effect: stored, or the default of the Robot's kind (Mr. Robot warms, other Robots compact). */
export function idleSettings(config: RobotConfig): { cacheWarming: boolean; idleCompaction: boolean; idleCompactionFloorTokens: number } {
  const chief = config.kind === 'mr-robot'
  return {
    cacheWarming: config.cacheWarming ?? chief,
    idleCompaction: config.idleCompaction ?? !chief,
    idleCompactionFloorTokens: config.idleCompactionFloorTokens ?? DEFAULT_IDLE_FLOOR_TOKENS,
  }
}

export interface IdleStep {
  readonly at: number
  readonly action: 'warm' | 'compact'
}

/** The plan from the end of a Turn: warming moments, or one compaction (which ends the plan). */
export function idlePlan(config: RobotConfig, provider: string, endedAt: number): IdleStep[] {
  const { cacheWarming, idleCompaction } = idleSettings(config)
  const window = cacheWindowOf(provider)
  const delay = window === null ? FALLBACK_DELAY : Math.max(1, Math.floor(Math.min(window * 0.9, window - 10_000)))
  if (idleCompaction) return [{ at: endedAt + delay, action: 'compact' }]
  if (cacheWarming && window !== null) return Array.from({ length: WARMINGS }, (_, index) => ({ at: endedAt + delay * (index + 1), action: 'warm' as const }))
  return []
}

/** What the Robot reads in its one bounded step before an idle compaction (ao-7bq9). */
export const IDLE_MEMORY_NOTE = 'Compaction is coming: while you are idle, your context will be replaced by a summary. Write what matters to memory now (MEMORY.md, today\'s daily note), then stop. Do not reply to your owner.'

/** The step limit of that platform step. */
export const IDLE_MEMORY_STEPS = 4
