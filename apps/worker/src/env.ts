import type { Home } from './home/home.ts'
import type { Member } from './member/member.ts'
import type { Robot } from './robot/robot.ts'

/** Bindings of the edge Worker and its Durable Objects, as declared in infra/stack.ts. */
export interface Env {
  readonly ROBOT: DurableObjectNamespace<Robot>
  readonly MEMBER: DurableObjectNamespace<Member>
  readonly HOME: DurableObjectNamespace<Home>
  readonly FILES: R2Bucket
  /** The Files bucket's S3 credentials as JSON (an R2 API token the Alchemy stack creates, held as a secret); presigned URLs are signed with them (v1.16 ticket 06). Absent in a local run. */
  readonly FILES_S3?: string
  readonly BROWSER: Fetcher
  /** The Robots' Boxes (v1.14 ticket 10); absent until deployed. The binding and its class keep their v1.14 names: renaming a Durable Object class needs a migration. */
  readonly COMPUTER?: DurableObjectNamespace<import('./box/container.ts').ComputerContainer>
  readonly AI: Ai
  readonly LOADER: WorkerLoader
  readonly HOME_NAME: string
  readonly DATA_KEY: string
  readonly VAPID_PRIVATE_KEY: string
  readonly VAPID_PUBLIC_KEY: string
  /** Subscription OAuth client ids (the providers' public CLI clients by default). */
  readonly OPENAI_OAUTH_CLIENT_ID: string
  readonly ANTHROPIC_OAUTH_CLIENT_ID: string
  /** The Cloudflare Access team whose tokens are accepted, e.g. withered-snow-6eaa.cloudflareaccess.com. */
  readonly ACCESS_TEAM_DOMAIN?: string
  /** Local development and tests only: the e-mail to sign in as when Access is absent. */
  readonly DEV_IDENTITY?: string
}

/** The single Home of a deployment (v1 deploys one). */
export const HOME_ID = 'home'
