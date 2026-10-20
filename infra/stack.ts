/**
 * Every Cloudflare resource of a Mr. Robot deployment (robot-h3vr, robot-scwl).
 * One Home per deployment; its name comes from MR_ROBOT_HOME (default "Home").
 */
import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Output from 'alchemy/Output'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import type { ComputerContainer, Home, Member, Robot } from '../apps/worker/src/index.ts'
import { vapidPublicKey } from './vapid.ts'

/**
 * The Robots' Workspaces. A multipart upload that a Host app or ws started and nobody completed or aborted (the Robot restarted in the
 * middle of a copy) is aborted by R2 after a day, so its parts are not kept (deep review P12).
 */
export const Files = Cloudflare.R2.Bucket('Files', {
  lifecycleRules: [{ id: 'abort-unfinished-uploads', abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 24 * 60 * 60 } } }],
})

export const OneTimePin = Cloudflare.Access.IdentityProvider('OneTimePin', {
  name: 'One-time PIN',
  type: 'onetimepin',
  config: {},
})

export const Edge = Effect.gen(function* () {
  const files = yield* Files
  const pin = yield* OneTimePin
  const dataKey = yield* Alchemy.Random('DataKey', { bytes: 32 })
  const vapidKey = yield* Alchemy.Random('VapidKey', { bytes: 32 })
  const boxTokenKey = yield* Alchemy.Random('BoxTokenKey', { bytes: 32 })
  return yield* Cloudflare.Worker('Edge', {
    main: './apps/worker/src/index.ts',
    compatibility: { date: '2026-09-01', flags: ['nodejs_compat'] },
    assets: {
      directory: './apps/web/dist',
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/api/*', '/hooks/*', '/p/*'],
    },
    access: {
      name: 'Mr. Robot',
      policies: [{ name: 'Anyone with an e-mail code', decision: 'allow', include: ['everyone'] }],
      allowedIdps: [pin.identityProviderId],
      autoRedirectToIdentity: true,
      sessionDuration: '720h',
    },
    observability: { enabled: true },
    env: {
      ROBOT: Cloudflare.DurableObject<Robot>('Robot', { className: 'Robot' }),
      MEMBER: Cloudflare.DurableObject<Member>('Member', { className: 'Member' }),
      HOME: Cloudflare.DurableObject<Home>('Home', { className: 'Home' }),
      FILES: files,
      // The Files bucket's S3 credentials (v1.16 ticket 06): Alchemy creates an R2 API token scoped to this bucket and the Worker holds it as a
      // secret. It signs the presigned URLs a Host app and ws use for one key under a Robot's prefix, and the control calls of a multipart upload.
      FILES_S3: Cloudflare.R2.S3Credentials(files, { access: 'read-write' }),
      BROWSER: Cloudflare.Browser('BROWSER'),
      // The Chrome container of v1.15 (binding CHROME, class ChromeContainer) is gone with its binding. Alchemy tags the Worker with the Durable
      // Object classes it hosts and compares them with the next deploy's bindings (Cloudflare/Workers/WorkerProvider.ts, deletedClassCandidates), so
      // this deploy uploads the Worker with a deleted_classes migration for ChromeContainer; the container application is deleted after, in the
      // delete phase for resources the stack no longer declares.
      // A Robot's Box (v1.14 ticket 10, the Computer until v1.15): one container per Robot on the image of infra/computer/Dockerfile,
      // which the deploy builds and pushes (Docker). The binding, the class and the directory keep their v1.14 names:
      // renaming a Durable Object class needs a migration, and the plan test asserts them.
      COMPUTER: Cloudflare.Container<ComputerContainer>('ComputerContainer', {
        className: 'ComputerContainer',
        context: './infra/computer',
        instanceType: 'standard-1',
        maxInstances: 10,
      }),
      AI: Cloudflare.Workers.AI('AI'),
      LOADER: Cloudflare.WorkerLoader('LOADER'),
      // The account's Zero Trust team (created when Zero Trust was enabled on 2026-10-06).
      ACCESS_TEAM_DOMAIN: Config.String('MR_ROBOT_ACCESS_TEAM_DOMAIN').pipe(Config.withDefault('withered-snow-6eaa.cloudflareaccess.com')),
      HOME_NAME: Config.String('MR_ROBOT_HOME').pipe(Config.withDefault('Home')),
      DATA_KEY: dataKey.text,
      VAPID_PRIVATE_KEY: vapidKey.text,
      // Signs the Box tokens (v1.16 deep review P5): the Box channel is outside Access, and the edge refuses an unsigned token before it names a Robot.
      BOX_TOKEN_KEY: boxTokenKey.text,
      VAPID_PUBLIC_KEY: vapidKey.text.pipe(Output.map((key) => vapidPublicKey(Redacted.value(key)))),
      // The providers' public CLI OAuth clients unless the deployment sets its own.
      OPENAI_OAUTH_CLIENT_ID: Config.Redacted('MR_ROBOT_OPENAI_OAUTH_CLIENT_ID').pipe(Config.withDefault(Redacted.make('app_EMoamEEZ73f0CkXaXp7hrann'))),
      ANTHROPIC_OAUTH_CLIENT_ID: Config.Redacted('MR_ROBOT_ANTHROPIC_OAUTH_CLIENT_ID').pipe(Config.withDefault(Redacted.make('9d1c250a-e61b-44d9-88ed-5944d1962f5e'))),
    },
  })
})

/**
 * The webhook Channel (v1.6 ticket 07): /hooks/* is outside the Access login (a bypass application
 * on that path); the key in the URL is the credential and the Worker checks it.
 */
export const HookChannel = Effect.gen(function* () {
  const edge = yield* Edge
  return yield* Cloudflare.Access.Application('HookChannel', {
    type: 'self_hosted',
    name: 'Mr. Robot webhooks',
    domain: edge.url.pipe(Output.map((url) => `${new URL(url ?? 'https://unknown').host}/hooks`)),
    policies: [{ name: 'Webhook key checked by the Worker', decision: 'bypass', include: ['everyone'] }],
  })
})

/**
 * Shared Pages (v1.17 ticket 06): /p/* is outside the Access login (a bypass application on that path), so a person with the link reads the
 * Page without signing in; the Worker checks the token's signature and that its owner still shares it.
 */
export const SharedPages = Effect.gen(function* () {
  const edge = yield* Edge
  return yield* Cloudflare.Access.Application('SharedPages', {
    type: 'self_hosted',
    name: 'Mr. Robot shared Pages',
    domain: edge.url.pipe(Output.map((url) => `${new URL(url ?? 'https://unknown').host}/p`)),
    policies: [{ name: 'Share token checked by the Worker', decision: 'bypass', include: ['everyone'] }],
  })
})

/**
 * The libraries a rendered Page loads (v1.17 review 3): /vendor/* (KaTeX's styles and fonts, Mermaid) is outside the Access login, so a shared Page
 * and Browser Rendering load them from this origin and no CDN. They are public open-source files; nothing of the Home is under /vendor.
 */
export const PublicVendor = Effect.gen(function* () {
  const edge = yield* Edge
  return yield* Cloudflare.Access.Application('PublicVendor', {
    type: 'self_hosted',
    name: 'Mr. Robot Page libraries',
    domain: edge.url.pipe(Output.map((url) => `${new URL(url ?? 'https://unknown').host}/vendor`)),
    policies: [{ name: 'Public libraries of rendered Pages', decision: 'bypass', include: ['everyone'] }],
  })
})

/**
 * Google's OAuth callback (v1.10 ticket 01): outside the Access login so a sign-in finished in the
 * system browser needs no Mr. Robot session; the one-time consent state is checked by the Worker.
 */
export const GoogleCallback = Effect.gen(function* () {
  const edge = yield* Edge
  return yield* Cloudflare.Access.Application('GoogleCallback', {
    type: 'self_hosted',
    name: 'Mr. Robot Google callback',
    domain: edge.url.pipe(Output.map((url) => `${new URL(url ?? 'https://unknown').host}/api/connections/google/oauth/callback`)),
    policies: [{ name: 'Consent state checked by the Worker', decision: 'bypass', include: ['everyone'] }],
  })
})

/**
 * The desktop app's channel (v1.2 ticket 01): /api/host/* is outside the Access login (a bypass
 * application on that path); the Worker checks the host's own token there.
 */
export const HostChannel = Effect.gen(function* () {
  const edge = yield* Edge
  return yield* Cloudflare.Access.Application('HostChannel', {
    type: 'self_hosted',
    name: 'Mr. Robot host channel',
    domain: edge.url.pipe(Output.map((url) => `${new URL(url ?? 'https://unknown').host}/api/host`)),
    policies: [{ name: 'Host token checked by the Worker', decision: 'bypass', include: ['everyone'] }],
  })
})

/**
 * The Box's door to its Workspace (v1.16 ticket 06): /api/files/presign is outside the Access login (a bypass application on that path) because
 * ws in the container has no Access identity; the Worker checks the Box token's signature (BOX_TOKEN_KEY) before it reaches a Robot, and the token reaches one Robot's prefix while its Box is up.
 */
export const BoxChannel = Effect.gen(function* () {
  const edge = yield* Edge
  return yield* Cloudflare.Access.Application('BoxChannel', {
    type: 'self_hosted',
    name: 'Mr. Robot Box files',
    domain: edge.url.pipe(Output.map((url) => `${new URL(url ?? 'https://unknown').host}/api/files/presign`)),
    policies: [{ name: 'Box token checked by the Worker', decision: 'bypass', include: ['everyone'] }],
  })
})
