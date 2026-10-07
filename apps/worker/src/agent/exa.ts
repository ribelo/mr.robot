/**
 * Exa (v1.1 ticket 11, rb-cfvy, rb-a0x0): the owner's desktop Exa tools, same names and parameters,
 * calling the Exa API with the Home's key. "exa" grants research (search, crawl, code context);
 * "exa-agent" grants the billable agent runs separately. Every call reports its cost (rb-pb26).
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './tools/define.ts'

const BASE = 'https://api.exa.ai'

export interface ExaHost {
  /** The Home's Exa key, or null when the admin has not added one. */
  exaKey(): Promise<string | null>
  /** Record an Exa call and its cost in usage and limits; an agent run's cost is counted once (runId). */
  recordExa(costUsd: number, runId?: string): Promise<void>
}

const NO_KEY = 'Exa is not set up in this Home: the Home admin must add an Exa API key under Admin → Exa. Tell your owner.'

async function exa(host: ExaHost, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
  const key = await host.exaKey()
  if (key === null) throw new Error(NO_KEY)
  const response = await fetch(BASE + path, { method, headers: { 'x-api-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  if (!response.ok) throw new Error(`Exa answered ${response.status}: ${text.slice(0, 300)}`)
  const json = JSON.parse(text) as Record<string, unknown>
  const cost = (json['costDollars'] as { total?: number } | undefined)?.total
  const runId = json['object'] === 'agent_run' && typeof json['id'] === 'string' ? json['id'] : undefined
  await host.recordExa(typeof cost === 'number' ? cost : 0, runId)
  return json
}

const strings = { type: 'array', items: { type: 'string' } }
const defined = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))

type Search = { query: string; numResults?: number; type?: string; category?: string; includeDomains?: string[]; excludeDomains?: string[]; startPublishedDate?: string; endPublishedDate?: string; userLocation?: string; moderation?: boolean }

/** Exa research: web search, page crawling, code context. */
export function exaResearchTools(host: ExaHost): ToolDefinition[] {
  return [
    tool<Search>({
      name: 'web_search_exa',
      description: 'Search the web with Exa and get the best pages with their text. Good for research without opening a browser.',
      parameters: {
        properties: {
          query: { type: 'string' },
          numResults: { type: 'integer', minimum: 1, maximum: 100 },
          type: { type: 'string', enum: ['instant', 'fast', 'auto', 'deep-lite', 'deep', 'deep-reasoning'] },
          category: { type: 'string' },
          includeDomains: strings, excludeDomains: strings,
          startPublishedDate: { type: 'string' }, endPublishedDate: { type: 'string' },
          userLocation: { type: 'string' }, moderation: { type: 'boolean' },
        },
        required: ['query'],
      },
      execute: async ({ numResults, ...rest }) => {
        const json = await exa(host, 'POST', '/search', defined({ ...rest, numResults: numResults ?? 8, contents: { text: { maxCharacters: 2000 } } }))
        return (json['results'] as Array<Record<string, unknown>> | undefined ?? []).map((result) => defined({ title: result['title'], url: result['url'], publishedDate: result['publishedDate'], text: result['text'] }))
      },
    }),
    tool<{ urls?: string[]; ids?: string[]; subpages?: number; subpageTarget?: string | string[]; maxAgeHours?: number }>({
      name: 'crawling_exa',
      description: 'Fetch the contents of pages (by URL or Exa result id) with Exa, optionally with their subpages.',
      parameters: {
        properties: {
          urls: strings, ids: strings,
          subpages: { type: 'integer', minimum: 0, maximum: 100 },
          subpageTarget: { anyOf: [{ type: 'string' }, strings] },
          maxAgeHours: { type: 'integer', minimum: -1, maximum: 720 },
        },
      },
      execute: async (input) => {
        if ((input.urls ?? []).length === 0 && (input.ids ?? []).length === 0) throw new Error('either "ids" or "urls" must be provided')
        const json = await exa(host, 'POST', '/contents', defined({ ...input, text: { maxCharacters: 8000 } }))
        return (json['results'] as Array<Record<string, unknown>> | undefined ?? []).map((result) => defined({ title: result['title'], url: result['url'], text: result['text'] }))
      },
    }),
    tool<{ query: string; tokensNum?: number | 'dynamic' }>({
      name: 'get_code_context_exa',
      description: 'Find code examples and documentation for a programming question with Exa.',
      parameters: { properties: { query: { type: 'string' }, tokensNum: { anyOf: [{ type: 'string', enum: ['dynamic'] }, { type: 'integer', minimum: 50, maximum: 100000 }] } }, required: ['query'] },
      execute: async (input) => {
        const json = await exa(host, 'POST', '/context', defined({ query: input.query, tokensNum: input.tokensNum ?? 'dynamic' }))
        return json['response'] ?? json
      },
    }),
  ]
}

/** Exa agent runs: long, billable research, granted separately (rb-a0x0). */
export function exaAgentTools(host: ExaHost): ToolDefinition[] {
  return [
    tool<{ query: string; outputSchema?: Record<string, unknown>; systemPrompt?: string; metadata?: Record<string, unknown>; effort?: string }>({
      name: 'exa_agent_create_run',
      description: 'Start an Exa agent research run (billable, may take minutes). Check it with exa_agent_get_run.',
      parameters: {
        properties: {
          query: { type: 'string' }, outputSchema: { type: 'object' }, systemPrompt: { type: 'string' }, metadata: { type: 'object' },
          effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'auto'] },
        },
        required: ['query'],
      },
      execute: async (input) => exa(host, 'POST', '/agent/runs', defined(input)),
    }),
    tool<{ id: string }>({
      name: 'exa_agent_get_run',
      description: 'Read an Exa agent run: its status and, when done, its output.',
      parameters: { properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async ({ id }) => exa(host, 'GET', `/agent/runs/${encodeURIComponent(id)}`),
    }),
    tool<{ limit?: number; cursor?: string }>({
      name: 'exa_agent_list_runs',
      description: 'List Exa agent runs.',
      parameters: { properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string' } } },
      execute: async ({ limit, cursor }) => exa(host, 'GET', `/agent/runs?${new URLSearchParams(defined({ limit: limit === undefined ? undefined : String(limit), cursor }) as Record<string, string>)}`),
    }),
    tool<{ id: string; limit?: number; cursor?: string }>({
      name: 'exa_agent_list_events',
      description: 'List the stored events of an Exa agent run.',
      parameters: { properties: { id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string', minLength: 1 } }, required: ['id'] },
      execute: async ({ id, limit, cursor }) => exa(host, 'GET', `/agent/runs/${encodeURIComponent(id)}/events?${new URLSearchParams(defined({ limit: limit === undefined ? undefined : String(limit), cursor }) as Record<string, string>)}`),
    }),
    tool<{ id: string }>({
      name: 'exa_agent_cancel_run',
      description: 'Cancel a queued or running Exa agent run.',
      parameters: { properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async ({ id }) => exa(host, 'POST', `/agent/runs/${encodeURIComponent(id)}/cancel`),
    }),
  ]
}
