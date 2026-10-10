/**
 * Wording for tools a DSH plugin registers (v1.8): the plugin's own text points to a search tool this
 * product does not offer. A context whose `tools.register` passes every definition through a rewrite
 * lets the plugin register unchanged code with the product's words.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

export type ToolRewrite = (tool: ToolDefinition) => ToolDefinition

/** `ctx` as the plugin sees it, with every tool it registers rewritten first. */
export function withToolRewrite<C extends object>(ctx: C, rewrite: ToolRewrite): C {
  // SAFETY: the proxy forwards every member to the real context; only `tools.register` differs.
  return new Proxy(ctx, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown
      if (key !== 'tools') return typeof value === 'function' ? value.bind(target) : value
      const registry = value as { register(tool: ToolDefinition): () => void }
      return new Proxy(registry, {
        get(registryTarget, registryKey) {
          const member = Reflect.get(registryTarget, registryKey, registryTarget) as unknown
          if (registryKey === 'register') return (tool: ToolDefinition) => registryTarget.register(rewrite(tool))
          return typeof member === 'function' ? member.bind(registryTarget) : member
        },
      })
    },
  })
}
