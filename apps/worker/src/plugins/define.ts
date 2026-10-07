/**
 * Mr. Robot capabilities as Cordis plugins (v1.3 ticket 01, pl-vfxd): each module follows the DSH
 * plugin convention (name, inject, a Schemastery Config, apply) and registers its tools and prompt
 * rules on the root context. A Robot's composition mounts exactly the plugins its grants allow
 * (pl-rsoy); an unmounted capability has no tools and no prompt section.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type z from '@deepseek-ai/schemastery'

export interface CapabilityPlugin<C> {
  readonly name: string
  readonly inject: readonly string[]
  readonly Config: z<C>
  /** The model-facing tools this plugin registers (for previews and the admin view). */
  readonly toolNames: (config: C) => readonly string[]
  /**
   * DSH seam plugins this capability needs (fs, web, browser-use, skills, schedule), mounted at the
   * composition root: they provide services the capability's own context could not inject.
   */
  readonly seams?: (root: Context, config: C) => Promise<void>
  apply(ctx: Context, config: C): Promise<void>
}

/** A plugin chosen for a composition, with its config. */
export interface Mount {
  readonly plugin: CapabilityPlugin<never>
  readonly config: unknown
}

export function mount<C>(plugin: CapabilityPlugin<C>, config: C): Mount {
  return { plugin: plugin as unknown as CapabilityPlugin<never>, config }
}

export interface CapabilitySpec<C> {
  readonly name: string
  readonly Config: z<C>
  /** Mr. Robot tools built from the config. */
  readonly tools?: (config: C) => readonly ToolDefinition[]
  /** Standing rules that only apply when the capability is present. */
  readonly prompt?: (config: C) => string
  /** DSH plugins this capability mounts at the composition root (seams, tool suites). */
  readonly seams?: (root: Context, config: C) => Promise<void>
  /** Names of tools registered by mounted DSH plugins, when the preview should list them. */
  readonly extraToolNames?: readonly string[]
}

export function capability<C>(spec: CapabilitySpec<C>): CapabilityPlugin<C> {
  return {
    name: `mr-robot-${spec.name}`,
    inject: ['tools', 'systemPrompt'],
    Config: spec.Config,
    toolNames: (config) => [...(spec.tools?.(config) ?? []).map((tool) => tool.name), ...(spec.extraToolNames ?? [])],
    ...(spec.seams === undefined ? {} : { seams: spec.seams }),
    async apply(ctx, config) {
      for (const tool of spec.tools?.(config) ?? []) ctx.tools.register(tool)
      if (spec.prompt !== undefined) {
        const text = spec.prompt(config)
        ctx.systemPrompt.section({ name: `mr-robot:${spec.name}`, order: 50, text: () => text })
      }
    },
  }
}
