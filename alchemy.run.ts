import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import { Edge, Files } from './infra/stack.ts'

export default Alchemy.Stack(
  'MrRobot',
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    yield* Files
    const edge = yield* Edge
    return { url: edge.url }
  }),
)
