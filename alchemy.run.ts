import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import { BoxChannel, Edge, Files, GoogleCallback, HookChannel, HostChannel, SharedPages } from './infra/stack.ts'

export default Alchemy.Stack(
  'MrRobot',
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    yield* Files
    const edge = yield* Edge
    yield* HostChannel
    yield* BoxChannel
    yield* HookChannel
    yield* GoogleCallback
    yield* SharedPages
    return { url: edge.url }
  }),
)
