/**
 * Wording for tools a DSH plugin registers (v1.8): the plugin's own text says "reminder" or points to a
 * search tool this product does not offer. A context whose `tools.register` passes every definition
 * through a rewrite lets the plugin register unchanged code with the product's words.
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

/** The glossary word: a DSH "reminder" is a Routine here. */
export function routineWords(text: string): string {
  return text.replace(/\b[Rr]eminders\b/g, 'Routines').replace(/\b[Rr]eminder\b/g, 'Routine')
}

function mapDescriptions(value: unknown, map: (text: string) => string): unknown {
  if (Array.isArray(value)) return value.map((entry) => mapDescriptions(entry, map))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'description' && typeof entry === 'string' ? map(entry) : mapDescriptions(entry, map)]))
}

/** A tool with its description and its parameters' descriptions passed through `map`. */
export function withDescriptions(tool: ToolDefinition, map: (text: string) => string): ToolDefinition {
  return { ...tool, description: map(tool.description), parameters: mapDescriptions(tool.parameters, map) } as ToolDefinition
}
