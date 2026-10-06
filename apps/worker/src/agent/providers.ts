/**
 * LLM Providers as DSH adapters. Credentials are resolved per request through the
 * Robot's owner (private first, then Home-shared), so a refreshed OAuth token or a
 * rotated key applies without rebuilding the composition.
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { AnthropicAdapter } from '../providers/anthropic.ts'
import { CodexAdapter } from '../providers/codex.ts'
import { ChatCompletionsAdapter, WorkersAiAdapter } from '../providers/openai-chat.ts'

export type ProviderId = 'deepseek' | 'openrouter' | 'workers-ai' | 'openai' | 'anthropic'
export const PROVIDER_IDS: readonly ProviderId[] = ['deepseek', 'openrouter', 'workers-ai', 'openai', 'anthropic']
export const API_KEY_PROVIDERS: readonly ProviderId[] = ['deepseek', 'openrouter']
export const OAUTH_PROVIDERS: readonly ProviderId[] = ['openai', 'anthropic']

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
  /** From the Home's model list; unknown models assume 128k. */
  readonly contextWindow?: number
}

export function providerAdapter(provider: string, context: ProviderContext): LlmAdapter {
  const window = context.contextWindow ?? 128_000
  switch (provider) {
    case 'deepseek':
      return deepSeek(context)
    case 'openrouter':
      return new ChatCompletionsAdapter({
        name: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        contextWindow: window,
        headers: async () => ({ authorization: `Bearer ${await apiKey(context, 'openrouter')}`, 'x-title': 'Mr. Robot' }),
      })
    case 'workers-ai':
      if (context.ai === undefined) throw new LlmError('Workers AI is not bound in this deployment', 'MISSING_CREDENTIAL')
      return new WorkersAiAdapter(context.ai, window)
    case 'anthropic':
      return new AnthropicAdapter(async () => (await oauth(context, 'anthropic')).access, window)
    case 'openai':
      return new CodexAdapter(() => oauth(context, 'openai'), window)
    default:
      throw new LlmError(`Provider "${provider}" is not available`, 'MISSING_CREDENTIAL')
  }
}

async function oauth(context: ProviderContext, provider: ProviderId): Promise<{ access: string; accountId?: string }> {
  const credential = await context.credentials.resolve(provider)
  if (credential?.kind === 'oauth') return { access: credential.access, ...(credential.accountId === undefined ? {} : { accountId: credential.accountId }) }
  throw new LlmError(`No ${provider} subscription: connect one under Providers, or use one shared with the Home`, 'MISSING_CREDENTIAL')
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