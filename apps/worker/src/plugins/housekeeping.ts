/**
 * The alarm's housekeeping duties of the browser, messaging, providers and connections plugins (v1.20 ticket 00): each was one line of
 * the Robot's alarm handler. Each reads its moment from the Robot's store and does its work through the host it is given.
 */
import type { Duty } from '../robot/duties.ts'
import type { RobotStore } from '../robot/store.ts'

/** The browser: notifications on a watched screen wake the Robot (rb-keaw). */
export function screenWatchDuty(store: RobotStore, check: (now: number) => Promise<void>): Duty {
  return { name: 'screen-watch', order: 30, scope: 'alive', nextAt: () => store.get<number>('watch-next'), run: check }
}

/** The browser: screenshots older than 7 days go, daily while any are left. */
export function screenSweepDuty(store: RobotStore, sweep: (now: number) => Promise<number>, everyMs: number): Duty {
  return {
    name: 'screen-sweep',
    order: 40,
    scope: 'alive',
    nextAt: () => store.get<number>('screens-sweep-next'),
    run: async (now) => {
      const due = store.get<number>('screens-sweep-next')
      if (due === undefined || due > now) return
      const left = await sweep(now)
      if (left > 0) store.set('screens-sweep-next', now + everyMs)
      else store.delete('screens-sweep-next')
    },
  }
}

/** Messaging: pending outbox rows are delivered; a lost RPC is retried, the recipient dedupes. A deleted Robot still delivers. */
export function outboxDuty(store: RobotStore, deliver: () => Promise<void>): Duty {
  return {
    name: 'outbox',
    order: 50,
    scope: 'any',
    nextAt: () => store.sql.exec<{ at: number | null }>("SELECT MIN(next_attempt) AS at FROM outbox WHERE status = 'pending'").one().at ?? undefined,
    run: () => deliver(),
  }
}

/** Providers: at the earliest reset of a blocked model chain the Robot continues the work it was blocked on (pa-dus3). */
export function chainResumeDuty(store: RobotStore, byOwner: (failed: unknown) => boolean): Duty {
  return {
    name: 'chain-resume',
    order: 55,
    scope: 'alive',
    nextAt: () => store.get<number>('chain-resume-at'),
    run: async (now) => {
      const at = store.get<number>('chain-resume-at')
      if (at === undefined || at > now) return
      store.delete('chain-resume-at')
      if (store.get('failed-wakeup') !== undefined || store.pendingWakeups() === 0) {
        // The work it goes on with was the owner's, if the Wake-up that failed was.
        const failed = store.get('failed-wakeup')
        const owner = failed !== undefined && byOwner(failed)
        store.delete('failed-wakeup')
        store.enqueue('platform', { kind: 'platform' }, 'Your model chain is usable again. Continue the work from where it stopped; do not redo finished steps.', owner ? { byOwner: true } : {}, now)
      }
    },
  }
}

/** Connections: a sign-in under Takeover ends at its deadline (v1.12 ticket 11). */
export function captureExpiryDuty(store: RobotStore, end: () => Promise<unknown>): Duty {
  const deadline = () => store.get<{ readonly capture?: { readonly deadline: number } }>('takeover')?.capture?.deadline
  return {
    name: 'sign-in-expiry',
    order: 20,
    scope: 'alive',
    nextAt: deadline,
    run: async (now) => {
      const at = deadline()
      if (at !== undefined && at <= now) await end()
    },
  }
}
