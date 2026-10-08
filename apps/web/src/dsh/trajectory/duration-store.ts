import { persistedPreference, type AtomSource } from '../../client/atom-source.ts'

/**
 * The browser-wide trajectory duration preference: elapsed or actual time (fe-r2kx).
 * @returns a persisted source shared by every trajectory view in the page.
 */
export function createTrajectoryDurationStore(): AtomSource<boolean> {
  return persistedPreference('dsh.trajectory.duration', false)
}
