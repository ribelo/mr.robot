import type { Home } from './home/home.ts'
import type { Member } from './member/member.ts'
import type { Robot } from './robot/robot.ts'

/** Bindings of the edge Worker and its Durable Objects, as declared in infra/stack.ts. */
export interface Env {
  readonly ROBOT: DurableObjectNamespace<Robot>
  readonly MEMBER: DurableObjectNamespace<Member>
  readonly HOME: DurableObjectNamespace<Home>
  readonly FILES: R2Bucket
  readonly BROWSER: Fetcher
  readonly AI: Ai
  readonly LOADER: WorkerLoader
  readonly HOME_NAME: string
  readonly DATA_KEY: string
  readonly VAPID_PRIVATE_KEY: string
  readonly VAPID_PUBLIC_KEY: string
  /** Subscription OAuth client ids (the providers' public CLI clients by default). */
  readonly OPENAI_OAUTH_CLIENT_ID: string
  readonly ANTHROPIC_OAUTH_CLIENT_ID: string
  /** Local development and tests only: the e-mail to sign in as when Access is absent. */
  readonly DEV_IDENTITY?: string
}

/** The single Home of a deployment (v1 deploys one). */
export const HOME_ID = 'home'
