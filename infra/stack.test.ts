import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Plan from 'alchemy/Plan'
import { evalStack } from 'alchemy/Stack'
import * as Core from 'alchemy/Test/Core'
import * as Effect from 'effect/Effect'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { useOfflineCloudflare } from './offline-cloudflare.ts'
import { BOX_IMAGE_INPUTS } from '../apps/worker/src/docs/box-tools.generated.ts'
import { boxContextHash } from './box-context.ts'
import { BoxChannel, Edge, Files, GoogleCallback, HookChannel, HostChannel, SharedPages } from './stack.ts'

useOfflineCloudflare()

it('declares every resource of the deployment (robot-h3vr, robot-scwl)', async () => {
  const providers = Cloudflare.providers()
  const state = Alchemy.inMemoryState()
  const stack = Alchemy.Stack('MrRobot', { providers, state }, Effect.gen(function* () {
    yield* Files
    const edge = yield* Edge
    yield* HostChannel
    yield* BoxChannel
    yield* HookChannel
    yield* GoogleCallback
    yield* SharedPages
    return { url: edge.url }
  }))
  const plan: any = await Effect.runPromise(
    Core.toEffect(evalStack(stack as any, (s: any) => Plan.make(s), { stage: 'test' }) as any, { providers, state, stage: 'test' }) as any,
  )
  const resources = Object.fromEntries(Object.entries<any>(plan.resources).map(([id, node]) => [id, node.resource.Type]))
  expect(resources).toMatchObject({
    Files: 'Cloudflare.R2.Bucket',
    OneTimePin: 'Cloudflare.Access.IdentityProvider',
    Edge: 'Cloudflare.Worker',
    'Edge/Access': 'Cloudflare.Access.Application',
    HostChannel: 'Cloudflare.Access.Application',
    BoxChannel: 'Cloudflare.Access.Application',
    // The Files bucket's R2 API token (v1.16 ticket 06, ob-qshq): Cloudflare.R2.S3Credentials on the Edge Worker creates it, scoped to the bucket,
    // and the Worker holds its S3 credentials as the secret FILES_S3 (a secret_text binding whose value only exists after the token does).
    EdgeToken: 'Cloudflare.ApiToken.AccountApiToken',
    HookChannel: 'Cloudflare.Access.Application',
    GoogleCallback: 'Cloudflare.Access.Application',
    // Shared Pages (v1.17 ticket 06): /p/* outside the Access login.
    SharedPages: 'Cloudflare.Access.Application',
    // The Robots' computer: built by the deploy from the Dockerfile in the repository (ao-h1wn).
    ComputerContainer: 'Cloudflare.Container',
  })
  expect(plan.resources.ComputerContainer.props).toMatchObject({ className: 'ComputerContainer', context: './infra/computer', instanceType: 'standard-1' })
  // An upload a restart cut off is aborted by R2 after a day (deep review P12).
  expect(plan.resources.Files.props.lifecycleRules).toEqual([{ id: 'abort-unfinished-uploads', abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 86_400 } } }])
  expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), 'computer', 'Dockerfile'))).toBe(true)
  const bindings = plan.resources.Edge.bindings.flatMap((b: any) => b.data.bindings ?? [])
    .filter((b: any) => typeof b.type === 'string' && typeof b.name === 'string')
    .map((b: any) => `${b.type}:${b.name}`).sort()
  // Two browsers (v1.16 ticket 08, ob-ltsr): Browser Rendering and the Hosts. The Chrome container and its image are gone.
  expect(plan.resources).not.toHaveProperty('ChromeContainer')
  expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), 'chrome'))).toBe(false)
  expect(bindings.filter((binding: string) => binding.endsWith(':CHROME'))).toEqual([])
  expect(bindings).toEqual(expect.arrayContaining([
    'ai:AI',
    'browser:BROWSER',
    'durable_object_namespace:COMPUTER',
    'durable_object_namespace:HOME',
    'durable_object_namespace:MEMBER',
    'durable_object_namespace:ROBOT',
    'r2_bucket:FILES',
    'worker_loader:LOADER',
  ]))
})

it('describes in docs/box.md the image that the Dockerfile builds (Sa3)', () => {
  // The tool list was made from an image built from these very files; if they changed since, run `node infra/box-tools.ts` again.
  expect(BOX_IMAGE_INPUTS).toBe(boxContextHash())
})
