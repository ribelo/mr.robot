/** Web search and fetch (DSH tool-web) with Mr. Robot's providers. */
import z from '@deepseek-ai/schemastery'
import type { CredentialSource } from '../agent/providers.ts'
import { webPlugin } from '../agent/web.ts'
import { capability } from './define.ts'

export const Web = capability<{ credentials: CredentialSource; browser?: Fetcher }>({
  name: 'web',
  Config: z.object({ credentials: z.any().required(), browser: z.any() }) as never,
  seams: (ctx, { credentials, browser }) => webPlugin(credentials, browser)(ctx),
})
