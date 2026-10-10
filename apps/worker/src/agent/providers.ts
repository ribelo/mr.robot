/**
 * LLM Providers as DSH adapters. Credentials are resolved per request through the
 * Robot's owner (private first, then Home-shared), so a refreshed OAuth token or a
 * rotated key applies without rebuilding the composition.
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { AnthropicAdapter, claudeSubscription } from '../providers/anthropic.ts'
import { chatgptSubscription, CodexAdapter } from '../providers/codex.ts'
import { ChatCompletionsAdapter, WorkersAiAdapter } from '../providers/openai-chat.ts'
import { opencodeGoAdapter, type OpencodePool } from '../providers/opencode-go.ts'
import type { ImageLoader } from '../providers/stream.ts'

export type ProviderId = 'deepseek' | 'openrouter' | 'workers-ai' | 'openai' | 'anthropic' | 'opencode-go'
export const PROVIDER_IDS: readonly ProviderId[] = ['deepseek', 'openrouter', 'workers-ai', 'openai', 'anthropic', 'opencode-go']
export const API_KEY_PROVIDERS: readonly ProviderId[] = ['deepseek', 'openrouter']
export const OAUTH_PROVIDERS: readonly ProviderId[] = ['openai', 'anthropic']

/** A credential for one request; `account` is the Provider account it came from (v1.10). */
export type ProviderCredential =
  | { readonly kind: 'api-key'; readonly key: string; readonly account?: string }
  | { readonly kind: 'oauth'; readonly access: string; readonly accountId?: string; readonly account?: string }

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
  /** The model the Robot runs on (OpenCode Go picks its wire format per model). */
  readonly model?: string
  readonly wire?: 'chat' | 'anthropic' | 'responses'
  /** Screenshot bytes for image blocks (Claude and ChatGPT receive images). */
  readonly images?: ImageLoader
}

/**
 * The identity line an adapter puts before the Robot's system prompt, or null (v1.11, sk-74ym): the
 * Anthropic adapter on a Claude subscription declares one; every other adapter puts nothing there.
 */
export function prependedIdentity(adapter: LlmAdapter): string | null {
  return adapter instanceof AnthropicAdapter ? adapter.prependedIdentity : null
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
      return new AnthropicAdapter(claudeSubscription(async () => (await oauth(context, 'anthropic')).access), window, context.images)
    case 'openai':
      return new CodexAdapter(chatgptSubscription(() => oauth(context, 'openai')), window, context.images)
    case 'opencode-go': {
      if (context.model === undefined) throw new LlmError('OpenCode Go is not available here', 'MISSING_CREDENTIAL')
      // One account's key per request (v1.10): moving to another account is the model chain's job, never silent.
      const pool: OpencodePool = {
        candidates: async () => ({ keys: [{ id: 'account', key: await apiKey(context, 'opencode-go') }], activeId: 'account' }),
        promote: async () => undefined,
        stick: async () => undefined,
      }
      // OpenCode Go's models differ in vision support; they get images as text (DSH projects them).
      return opencodeGoAdapter(context.model, pool, context.contextWindow, context.wire)
    }
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
  throw new LlmError(`No ${provider} credential: connect it under your name → Providers, or pick another model in this Robot's settings`, 'MISSING_CREDENTIAL')
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