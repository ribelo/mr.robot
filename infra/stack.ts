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
import type { Home, Member, Robot } from '../apps/worker/src/index.ts'
import { vapidPublicKey } from './vapid.ts'

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
      AI: Cloudflare.Workers.AI('AI'),
      LOADER: Cloudflare.WorkerLoader('LOADER'),
      HOME_NAME: Config.String('MR_ROBOT_HOME').pipe(Config.withDefault('Home')),
      DATA_KEY: dataKey.text,
      VAPID_PRIVATE_KEY: vapidKey.text,
      VAPID_PUBLIC_KEY: vapidKey.text.pipe(Output.map((key) => vapidPublicKey(Redacted.value(key)))),
    },
  })
})
