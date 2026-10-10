/**
 * The Routine tools of every Robot (ticket 09): one host, one set of rules. Without robot_id a call is
 * about the Robot's own Routines; with it, and only for Mr. Robot, about another Robot's, through the
 * deputy's reach checks. Everything ends in the same programs, so the validation and the limits are one.
 */
import * as Effect from 'effect/Effect'
import type { RoutineView } from '@mr-robot/protocol'
import type { RoutinesHost } from '../agent/tools/routines.ts'
import { invalid, type DurableError } from '../platform/durable.ts'
import * as Deputy from './deputy.ts'
import * as Programs from './programs.ts'
import { RobotState, type RobotPlatform } from './programs.ts'
import { routineViews } from './views.ts'

type R = RobotState | RobotPlatform

/** Run `own` for this Robot's Routines, `other` for another Robot's; only Mr. Robot may name another Robot. */
const scoped = <A>(robotId: string | undefined, own: Effect.Effect<A, DurableError, R>, other: (robotId: string) => Effect.Effect<A, DurableError, R>): Effect.Effect<A, DurableError, R> =>
  Effect.gen(function* () {
    const current = (yield* RobotState).config()
    if (current === undefined) return yield* invalid('robot is not initialised')
    if (robotId === undefined || robotId === current.id) return yield* own
    if (current.kind !== 'mr-robot') return yield* invalid('only Mr. Robot can use robot_id; leave it out to work on your own Routines')
    return yield* other(robotId)
  })

const ownDelete = (id: string) => Effect.gen(function* () {
  const name = (yield* RobotState).routine(id)?.record.title
  yield* Programs.removeRoutine(id)
  return { deleted: id, ...(name === undefined ? {} : { name }) }
})

export function routinesHost(run: Deputy.Run): RoutinesHost {
  return {
    set: (robotId, change) => Deputy.plain(run(scoped<RoutineView>(robotId, Programs.setRoutine(change), (robot) => Deputy.routineSet(robot, change)))),
    list: (robotId) => Deputy.plain(run(scoped<RoutineView[]>(robotId, routineViews, Deputy.routines))),
    pause: (robotId, id, paused) => Deputy.plain(run(scoped<RoutineView>(robotId, Programs.pauseRoutine(id, paused), (robot) => Deputy.routinePause(robot, id, paused)))),
    delete: (robotId, id) => Deputy.plain(run(scoped<{ deleted: string; name?: string }>(robotId, ownDelete(id), (robot) => Deputy.routineDelete(robot, id)))),
  }
}
