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
import type { Chrome, Home, Member, Robot } from '../apps/worker/src/index.ts'
import { vapidPublicKey } from './vapid.ts'

/** The pushed Chrome image (infra/chrome/push.sh prints it). */
const CHROME_IMAGE_TAG = 'yihr03qchl7b'

export const Files = Cloudflare.R2.Bucket('Files')

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
  return yield* Cloudflare.Worker('Edge', {
    main: './apps/worker/src/index.ts',
    compatibility: { date: '2026-09-01', flags: ['nodejs_compat'] },
    assets: {
      directory: './apps/web/dist',
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/api/*'],
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
      BROWSER: Cloudflare.Browser('BROWSER'),
      // Chrome in Cloudflare Containers (v1.1 ticket 02). The image is built with Nix and pushed by
      // infra/chrome/push.sh; the tag is the Nix store hash of that build.
      CHROME: Cloudflare.Container<Chrome>('Chrome', {
        className: 'Chrome',
        image: `registry.cloudflare.com/2c42f4960f9c28a9235cac01483bd626/mrrobot-chrome:${CHROME_IMAGE_TAG}`,
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
      VAPID_PUBLIC_KEY: vapidKey.text.pipe(Output.map((key) => vapidPublicKey(Redacted.value(key)))),
      // The providers' public CLI OAuth clients unless the deployment sets its own.
      OPENAI_OAUTH_CLIENT_ID: Config.Redacted('MR_ROBOT_OPENAI_OAUTH_CLIENT_ID').pipe(Config.withDefault(Redacted.make('app_EMoamEEZ73f0CkXaXp7hrann'))),
      ANTHROPIC_OAUTH_CLIENT_ID: Config.Redacted('MR_ROBOT_ANTHROPIC_OAUTH_CLIENT_ID').pipe(Config.withDefault(Redacted.make('9d1c250a-e61b-44d9-88ed-5944d1962f5e'))),
    },
  })
})
