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

// The code-mode SDK generator reads a subset of JSON Schema (type, properties, required, items, enum, const,
// oneOf, descriptions); other keywords (minimum, anyOf, minLength) turn a tool's whole parameter type into
// `unknown` (ts-pg3q). Limits go in the descriptions.
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description })
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
          query: { type: 'string', description: 'What to search for' },
          numResults: { type: 'integer', description: 'How many results, 1 to 100 (default 8)' },
          type: { type: 'string', enum: ['instant', 'fast', 'auto', 'deep-lite', 'deep', 'deep-reasoning'], description: 'Search depth: instant and fast are quick, deep and deep-reasoning are slower and costlier (default auto)' },
          category: { type: 'string', description: 'Limit to one kind of page, for example company, news, research paper, github, tweet or pdf' },
          includeDomains: strings('Only return pages from these domains'), excludeDomains: strings('Never return pages from these domains'),
          startPublishedDate: { type: 'string', description: 'Only pages published on or after this ISO 8601 date' }, endPublishedDate: { type: 'string', description: 'Only pages published on or before this ISO 8601 date' },
          userLocation: { type: 'string', description: 'Two-letter country code of the user, to localise results' }, moderation: { type: 'boolean', description: 'Filter out unsafe content' },
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
          urls: strings('Page addresses to fetch; give urls or ids'), ids: strings('Exa result ids to fetch; give urls or ids'),
          subpages: { type: 'integer', description: 'How many subpages of each page to fetch too, 0 to 100' },
          subpageTarget: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Words that pick which subpages to fetch (one string or a list)' },
          maxAgeHours: { type: 'integer', description: 'Accept a cached copy no older than this many hours, -1 (cache only) to 720; 0 always fetches fresh' },
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
      parameters: {
        properties: {
          query: { type: 'string', description: 'The programming question, with the library or language named' },
          tokensNum: { oneOf: [{ type: 'string', enum: ['dynamic'] }, { type: 'integer' }], description: '"dynamic" (default) lets Exa decide, or a number of tokens, 50 to 100000' },
        },
        required: ['query'],
      },
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
          query: { type: 'string', description: 'The research task' },
          outputSchema: { type: 'object', description: 'JSON Schema the run output must follow' },
          systemPrompt: { type: 'string', description: 'Standing instructions for the run' },
          metadata: { type: 'object', description: 'Your own key/value labels, stored with the run' },
          effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'auto'], description: 'How much work the run may spend; higher costs more (default auto)' },
        },
        required: ['query'],
      },
      execute: async (input) => exa(host, 'POST', '/agent/runs', defined(input)),
    }),
    tool<{ id: string }>({
      name: 'exa_agent_get_run',
      description: 'Read an Exa agent run: its status and, when done, its output.',
      parameters: { properties: { id: { type: 'string', description: 'Run id from exa_agent_create_run or exa_agent_list_runs' } }, required: ['id'] },
      execute: async ({ id }) => exa(host, 'GET', `/agent/runs/${encodeURIComponent(id)}`),
    }),
    tool<{ limit?: number; cursor?: string }>({
      name: 'exa_agent_list_runs',
      description: 'List Exa agent runs.',
      parameters: { properties: { limit: { type: 'integer', description: 'How many runs, 1 to 100' }, cursor: { type: 'string', description: 'The nextCursor of the previous page' } } },
      execute: async ({ limit, cursor }) => exa(host, 'GET', `/agent/runs?${new URLSearchParams(defined({ limit: limit === undefined ? undefined : String(limit), cursor }) as Record<string, string>)}`),
    }),
    tool<{ id: string; limit?: number; cursor?: string }>({
      name: 'exa_agent_list_events',
      description: 'List the stored events of an Exa agent run.',
      parameters: { properties: { id: { type: 'string', description: 'Run id from exa_agent_create_run or exa_agent_list_runs' }, limit: { type: 'integer', description: 'How many events, 1 to 100' }, cursor: { type: 'string', description: 'The nextCursor of the previous page' } }, required: ['id'] },
      execute: async ({ id, limit, cursor }) => exa(host, 'GET', `/agent/runs/${encodeURIComponent(id)}/events?${new URLSearchParams(defined({ limit: limit === undefined ? undefined : String(limit), cursor }) as Record<string, string>)}`),
    }),
    tool<{ id: string }>({
      name: 'exa_agent_cancel_run',
      description: 'Cancel a queued or running Exa agent run.',
      parameters: { properties: { id: { type: 'string', description: 'Run id to cancel' } }, required: ['id'] },
      execute: async ({ id }) => exa(host, 'POST', `/agent/runs/${encodeURIComponent(id)}/cancel`),
    }),
  ]
}
