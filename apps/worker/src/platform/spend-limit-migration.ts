/**
 * Spend limits stored before v1.12 (ux-ommv) were numbers in USD or null. They are read once into
 * the typed limits: for the Home, null and 0 are no limit; for a Robot, null is the Home's and 0 is
 * no limit. A fraction rounds up to whole dollars, so a migrated limit never stops a Robot earlier.
 */
import type { HomeSpendLimit, RobotSpendLimit } from '@mr-robot/protocol'

const amountOf = (value: number): HomeSpendLimit => (value > 0 ? { kind: 'usd', amount: Math.max(1, Math.ceil(value)) } : { kind: 'none' })

/** A Home limit as stored before v1.12: a number of USD, or null. */
export function legacyHomeSpendLimit(stored: unknown): HomeSpendLimit {
  return typeof stored === 'number' && Number.isFinite(stored) ? amountOf(stored) : { kind: 'none' }
}

/** A Robot's limit as stored before v1.12: a number of USD, or null (absent) for the Home's. */
export function legacyRobotSpendLimit(stored: unknown): RobotSpendLimit {
  return typeof stored === 'number' && Number.isFinite(stored) ? amountOf(stored) : { kind: 'home' }
}
