/**
 * LLM Providers as DSH adapters. Credentials are resolved per request through the
 * Robot's owner (private first, then Home-shared), so a refreshed OAuth token or a
 * rotated key applies without rebuilding the composition.
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'

export type ProviderId = 'deepseek' | 'openrouter' | 'workers-ai' | 'openai' | 'anthropic'

export type ProviderCredential =
  | { readonly kind: 'api-key'; readonly key: string }
  | { readonly kind: 'oauth'; readonly access: string; readonly accountId?: string }

export interface CredentialSource {
  /** Current credential for a Provider, or undefined when the owner has none usable. */
  resolve(provider: ProviderId): Promise<ProviderCredential | undefined>
}

export interface ProviderContext {
  readonly robotId: string
  readonly credentials: CredentialSource
  readonly ai?: Ai
}

export function providerAdapter(provider: string, context: ProviderContext): LlmAdapter {
  switch (provider) {
    case 'deepseek':
      return deepSeek(context)
    default:
      throw new LlmError(`Provider "${provider}" is not available`, 'MISSING_CREDENTIAL')
  }
}

async function apiKey(context: ProviderContext, provider: ProviderId): Promise<string> {
  const credential = await context.credentials.resolve(provider)
  if (credential?.kind === 'api-key' && credential.key.length > 0) return credential.key
  throw new LlmError(`No ${provider} credential: add one in the admin view, or share one with the Home`, 'MISSING_CREDENTIAL')
}

function deepSeek(context: ProviderContext): LlmAdapter {
  const options = resolveAdapterOptions({})
  return new DeepSeekAdapter({
    providerName: 'DeepSeek',
    options: () => options,
    resolveAuth: async () => ({ headers: { 'x-api-key': await apiKey(context, 'deepseek') } }),
    resolveUserId: () => context.robotId as never,
    prepareExtensions: () => Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
  })
}
