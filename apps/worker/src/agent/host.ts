/**
 * What a Robot's tools may ask of the Robot that runs them. The Robot DO implements
 * it; tools never touch the DO or its storage directly.
 */
import type { GrantSet, Identity, ProposalKind, ProposalView, RoutineSchedule, RoutineView } from '@mr-robot/protocol'
import type { RobotConfig } from '../robot/store.ts'

export interface RobotHost {
  config(): RobotConfig
  grants(): GrantSet
  /** Store a proposal for the owner; the stored payload is what approval applies. */
  propose(kind: ProposalKind, purpose: string, payload: Record<string, unknown>): ProposalView
  setIdentity(identity: Partial<Identity>): Identity
  now(): number
}

export interface RoutineHost {
  createRoutine(input: { name: string; prompt: string; schedule: RoutineSchedule }): RoutineView
  updateRoutine(id: string, input: { name?: string; prompt?: string; schedule?: RoutineSchedule }): RoutineView
  deleteRoutine(id: string): RoutineView
  listRoutines(): RoutineView[]
}
