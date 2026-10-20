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
import { Edge, Files, GoogleCallback, HookChannel, HostChannel } from './stack.ts'

useOfflineCloudflare()

it('declares every resource of the deployment (robot-h3vr, robot-scwl)', async () => {
  const providers = Cloudflare.providers()
  const state = Alchemy.inMemoryState()
  const stack = Alchemy.Stack('MrRobot', { providers, state }, Effect.gen(function* () {
    yield* Files
    const edge = yield* Edge
    yield* HostChannel
    yield* HookChannel
    yield* GoogleCallback
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
    HookChannel: 'Cloudflare.Access.Application',
    GoogleCallback: 'Cloudflare.Access.Application',
    // The Robots' computer: built by the deploy from the Dockerfile in the repository (ao-h1wn).
    ComputerContainer: 'Cloudflare.Container',
  })
  expect(plan.resources.ComputerContainer.props).toMatchObject({ className: 'ComputerContainer', context: './infra/computer', instanceType: 'standard-1' })
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
