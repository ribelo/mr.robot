/**
 * What a Robot's tools may ask of the Robot that runs them. The Robot DO implements
 * it; tools never touch the DO or its storage directly.
 */
import type { GrantSet, Identity, ProposalKind, ProposalView } from '@mr-robot/protocol'
import type * as Effect from 'effect/Effect'
import type { MemberFileName } from '../member/member.ts'
import type { RobotConfig } from '../robot/store.ts'
import type { WorkspaceShape } from '../workspace/workspace.ts'

export interface RobotHost {
  config(): RobotConfig
  grants(): GrantSet
  /** Store a proposal for the owner; the stored payload is what approval applies. */
  propose(kind: ProposalKind, purpose: string, payload: Record<string, unknown>): ProposalView
  /** Installed from a definition (v1.18, rm-xgau): the Grants its grants.yaml names, met from the owner's Connections, logins and Hosts, and what is not met. */
  definitionGrants(): Promise<{ readonly grants: GrantSet; readonly notes: readonly string[] } | undefined>
  setIdentity(identity: Partial<Identity>): Identity
  now(): number
}

export interface WorkspaceHost {
  readonly workspace: WorkspaceShape
  /** The owner's Member file, mounted read-only (robot-mj7v). */
  memberFile(name: MemberFileName): Promise<string>
  run<A, E>(effect: Effect.Effect<A, E>): Promise<A>
}
