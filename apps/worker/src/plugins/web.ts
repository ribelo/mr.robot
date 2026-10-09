/** Web fetch (DSH tool-web) with Mr. Robot's fetch provider; web search is the Exa capability's. */
import z from '@deepseek-ai/schemastery'
import { webPlugin } from '../agent/web.ts'
import { capability } from './define.ts'

export const Web = capability<Record<string, never>>({
  name: 'web',
  Config: z.object({}) as never,
  seams: (ctx) => webPlugin(ctx),
})
