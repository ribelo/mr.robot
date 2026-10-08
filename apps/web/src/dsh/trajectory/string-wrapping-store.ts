import { persistedPreference, type AtomSource } from '../../client/atom-source.ts'

/**
 * The browser-wide default for expanded JSON strings (fe-r2kx).
 * @returns a persisted preference sampled only when a string is expanded.
 */
export function createTrajectoryStringWrappingStore(): AtomSource<boolean> {
  return persistedPreference('dsh.trajectory.jsonStringWrapping', false)
}
