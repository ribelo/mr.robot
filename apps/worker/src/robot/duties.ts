/**
 * The duty seam (v1.20 ticket 00, docs/adr/0003-duties-and-platform-steps.md): what a Robot does between Turns, registered by the
 * module that owns it instead of written into the alarm handler. A duty says when it is next due and does its work when it is; the
 * Robot's alarm runs the core's own work (Tasks, parked Wake-ups, draining, Subagent resume), then every due duty in its declared
 * order, then re-arms for the earliest moment over the core's and the duties'.
 */

/** Which Robots a duty runs for: every one (a deleted Robot still delivers its outbox), any that is not deleted, or only an active one. */
export type DutyScope = 'any' | 'alive' | 'active'

export interface Duty {
  /** For logs and for the order's ties. */
  readonly name: string
  /** Lower runs first. */
  readonly order: number
  readonly scope: DutyScope
  /** When it is next due; undefined when it has nothing planned. Read on every re-arm, so it reads the store, never a cache. */
  nextAt(now: number): number | undefined
  /** Do the work if it is due at `now`; a duty decides itself whether it is (an alarm can come early or late). Its failure is logged, not thrown. */
  run(now: number): Promise<void>
}

/** How soon a due duty that could not run is tried again: the Robot's heartbeat. */
export const DUTY_RETRY_MS = 30_000

export class Duties {
  private readonly duties: Duty[] = []

  register(duty: Duty): void {
    if (this.duties.some((existing) => existing.name === duty.name)) throw new Error(`duty ${duty.name} is registered twice`)
    this.duties.push(duty)
    this.duties.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  }

  private inScope(duty: Duty, status: string): boolean {
    if (duty.scope === 'any') return true
    return status !== 'deleted' && (duty.scope === 'alive' || status === 'active')
  }

  /**
   * The earliest moment any duty in scope has planned; undefined when none has. A moment already past (a duty that was due but refused,
   * the Robot being busy) is tried again a retry later, never in the past (v1.20.1: that spun the alarm until the Robot was idle).
   */
  nextAt(now: number, status: string): number | undefined {
    const moments = this.duties.filter((duty) => this.inScope(duty, status)).flatMap((duty) => {
      const at = duty.nextAt(now)
      return at === undefined ? [] : [at <= now ? now + DUTY_RETRY_MS : at]
    })
    return moments.length === 0 ? undefined : Math.min(...moments)
  }

  /** Run every duty in scope, in order; each decides whether it is due. One failing does not stop the others. */
  async run(now: number, status: () => string): Promise<void> {
    for (const duty of this.duties) {
      if (!this.inScope(duty, status())) continue
      await duty.run(now).catch((error: unknown) => console.warn(`duty ${duty.name} failed`, error))
    }
  }
}