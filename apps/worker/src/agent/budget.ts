import {
  LlmAdapter,
  type GenerateOptions,
  type LlmImageRequestPricing,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type PreparedAdapterCall,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/**
 * Presents a model's context window as the Robot's context budget (robot-sw54).
 * DSH compaction and the token meter measure pressure against the reported window,
 * so capping it here makes compaction trigger at the Robot's budget.
 */
export class BudgetedAdapter extends LlmAdapter {
  constructor(private readonly inner: LlmAdapter, private readonly budget: number) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return this.inner.providerInfo(provider)
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.inner.providerRetryPolicy(provider)
  }

  override imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined {
    return this.inner.imageRequestPricing(provider, model)
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.inner.listModels(provider)
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return this.cap(await this.inner.resolveModel(provider, model, signal))
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await this.inner.prepareCall(provider, model, signal)
    return { ...prepared, model: this.cap(prepared.model) }
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.inner.stream(options)
  }

  private cap(info: LlmResolvedModelInfo): LlmResolvedModelInfo {
    const window = info.context?.contextWindow
    const contextWindow = window === undefined ? this.budget : Math.min(window, this.budget)
    return { ...info, context: { ...info.context, contextWindow } }
  }
}
