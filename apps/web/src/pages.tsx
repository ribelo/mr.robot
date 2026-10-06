import type { Me, RobotSummary } from '@mr-robot/protocol'
import type { Route } from './route.ts'

/** Full-page views reached from a Robot or the sidebar; each ticket fills in its page. */
export function Pages({ route }: { route: Route; me: Me; robots: readonly RobotSummary[]; onChanged: () => void }) {
  return <div className="empty-main">{route.page}</div>
}
