/**
 * The OpenCode Go offer (robot-82r5), from pi-ai's catalog (@earendil-works/pi-ai, as used by the DSH
 * opencode-go-session plugin). wire is the API the model speaks at https://opencode.ai/zen/go/v1.
 * USD per million tokens.
 */
export type OpencodeWire = 'chat' | 'anthropic' | 'responses'

export interface OpencodeModel {
  readonly id: string
  readonly name: string
  readonly wire: OpencodeWire
  readonly contextWindow: number
  readonly maxTokens: number
  readonly price: { readonly input: number; readonly output: number; readonly cachedInput: number }
}

export const OPENCODE_GO_MODELS: readonly OpencodeModel[] = [
  {id: 'minimax-m3', name: 'MiniMax-M3', wire: 'anthropic', contextWindow: 1000000, maxTokens: 131072, price: {input: 0.3, output: 1.2, cachedInput: 0.06}},
  {id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', wire: 'anthropic', contextWindow: 1000000, maxTokens: 131072, price: {input: 0.15, output: 0.47, cachedInput: 0.016}},
  {id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', wire: 'chat', contextWindow: 1000000, maxTokens: 384000, price: {input: 0.15, output: 0.6, cachedInput: 0.003}},
  {id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Exp', wire: 'chat', contextWindow: 1000000, maxTokens: 384000, price: {input: 0.15, output: 0.6, cachedInput: 0.003}},
  {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (New)', wire: 'chat', contextWindow: 1000000, maxTokens: 384000, price: {input: 0.66, output: 1.98, cachedInput: 0.022}},
  {id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', wire: 'chat', contextWindow: 1000000, maxTokens: 384000, price: {input: 0.15, output: 0.6, cachedInput: 0.003}},
  {id: 'glm-5.1', name: 'GLM-5.1', wire: 'chat', contextWindow: 202752, maxTokens: 32768, price: {input: 1.4, output: 4.4, cachedInput: 0.26}},
  {id: 'glm-5.2', name: 'GLM-5.2', wire: 'chat', contextWindow: 1000000, maxTokens: 131072, price: {input: 1.4, output: 4.4, cachedInput: 0.26}},
  {id: 'glm-5.3', name: 'GLM-5.3', wire: 'chat', contextWindow: 1000000, maxTokens: 131072, price: {input: 1.4, output: 4.4, cachedInput: 0.26}},
  {id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', wire: 'chat', contextWindow: 1000000, maxTokens: 131072, price: {input: 0.15, output: 0.5, cachedInput: 0.03}},
  {id: 'hy3', name: 'Hy3', wire: 'chat', contextWindow: 256000, maxTokens: 128000, price: {input: 0.14, output: 0.58, cachedInput: 0.035}},
  {id: 'hy4-preview', name: 'Hy4 preview', wire: 'chat', contextWindow: 1024000, maxTokens: 64000, price: {input: 0.834, output: 2.501, cachedInput: 0.042}},
  {id: 'kimi-k2.6', name: 'Kimi K2.6', wire: 'chat', contextWindow: 262144, maxTokens: 65536, price: {input: 0.95, output: 4, cachedInput: 0.16}},
  {id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', wire: 'chat', contextWindow: 262144, maxTokens: 262144, price: {input: 0.95, output: 4, cachedInput: 0.19}},
  {id: 'kimi-k3', name: 'Kimi K3', wire: 'chat', contextWindow: 1048576, maxTokens: 131072, price: {input: 3, output: 15, cachedInput: 0.3}},
  {id: 'longcat-2.0', name: 'LongCat-2.0', wire: 'chat', contextWindow: 1000000, maxTokens: 131072, price: {input: 0.3, output: 1.2, cachedInput: 0.006}},
  {id: 'mimo-v2.5', name: 'MiMo V2.5', wire: 'chat', contextWindow: 1000000, maxTokens: 128000, price: {input: 0.14, output: 0.28, cachedInput: 0.0028}},
  {id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', wire: 'chat', contextWindow: 1048576, maxTokens: 128000, price: {input: 0.435, output: 0.87, cachedInput: 0.003625}},
  {id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash', wire: 'chat', contextWindow: 1048576, maxTokens: 131072, price: {input: 0.14, output: 0.28, cachedInput: 0.0028}},
  {id: 'mimo-v2.6-pro', name: 'MiMo-V2.6-Pro', wire: 'chat', contextWindow: 1048576, maxTokens: 131072, price: {input: 0.435, output: 0.87, cachedInput: 0.003625}},
  {id: 'minimax-m2.7', name: 'MiniMax-M2.7', wire: 'chat', contextWindow: 204800, maxTokens: 131072, price: {input: 0.3, output: 1.2, cachedInput: 0.06}},
  {id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', wire: 'chat', contextWindow: 1000000, maxTokens: 65536, price: {input: 0.5, output: 3, cachedInput: 0.05}},
  {id: 'qwen3.7-max', name: 'Qwen3.7 Max', wire: 'chat', contextWindow: 1000000, maxTokens: 65536, price: {input: 2.5, output: 7.5, cachedInput: 0.5}},
  {id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', wire: 'chat', contextWindow: 1000000, maxTokens: 65536, price: {input: 0.4, output: 1.6, cachedInput: 0.04}},
  {id: 'qwen3.8-max', name: 'Qwen3.8 Max', wire: 'chat', contextWindow: 1000000, maxTokens: 131072, price: {input: 2, output: 6, cachedInput: 0.25}},
  {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', wire: 'responses', contextWindow: 1050000, maxTokens: 128000, price: {input: 0.2, output: 1.2, cachedInput: 0.02}},
  {id: 'grok-4.6', name: 'Grok 4.6', wire: 'responses', contextWindow: 500000, maxTokens: 500000, price: {input: 2, output: 6, cachedInput: 0.5}},
  {id: 'grok-4.7', name: 'Grok 4.7', wire: 'responses', contextWindow: 500000, maxTokens: 500000, price: {input: 2, output: 6, cachedInput: 0.5}},
  {id: 'muse-spark-1.2-contributor', name: 'Muse Spark 1.2 Contributor', wire: 'responses', contextWindow: 1048576, maxTokens: 131072, price: {input: 0.1, output: 0.2, cachedInput: 0.002}},
  {id: 'muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor', wire: 'responses', contextWindow: 1048576, maxTokens: 131072, price: {input: 0.1, output: 0.2, cachedInput: 0.002}},
]
