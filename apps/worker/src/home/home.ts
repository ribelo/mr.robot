import { DurableObject } from 'cloudflare:workers'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'
import type { Env } from '../env.ts'

export class Home extends DurableObject<Env> {
  async providerCredential(_memberId: string, _provider: ProviderId): Promise<ProviderCredential | null> {
    return null
  }
}
