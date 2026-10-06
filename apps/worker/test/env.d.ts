import type { Home, Member, Robot } from '../src/index.ts'

declare global {
  namespace Cloudflare {
    interface Env {
      ROBOT: DurableObjectNamespace<Robot>
      MEMBER: DurableObjectNamespace<Member>
      HOME: DurableObjectNamespace<Home>
    }
  }
}
