/**
 * Exa research and agent runs (rb-cfvy). Pure TypeScript and fetch: loadable in the desktop DSH
 * with a config apiKey (no Mr. Robot host needed; costs are then not recorded).
 */
import z from '@deepseek-ai/schemastery'
import { exaAgentTools, exaResearchTools, type ExaHost } from '../agent/exa.ts'
import { capability } from './define.ts'

export interface ExaConfig {
  readonly research: boolean
  readonly agentRuns: boolean
  /** A fixed key (desktop use); otherwise the host supplies the Home's key. */
  readonly apiKey?: string
  readonly host?: ExaHost
}

const hostOf = (config: ExaConfig): ExaHost => config.host ?? { exaKey: async () => config.apiKey ?? null, recordExa: async () => undefined }

export const Exa = capability<ExaConfig>({
  name: 'exa',
  Config: z.object({ research: z.boolean().default(true), agentRuns: z.boolean().default(false), apiKey: z.string(), host: z.any() }) as never,
  tools: (config) => [...(config.research ? exaResearchTools(hostOf(config)) : []), ...(config.agentRuns ? exaAgentTools(hostOf(config)) : [])],
})

/** The DSH plugin entry point for the desktop harness. */
export const { name, inject, Config, apply } = Exa
