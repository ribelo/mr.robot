/** Provider credentials for DSH packages, read-only inside a Robot. Always mounted. */
import z from '@deepseek-ai/schemastery'
import type { CredentialSource } from '../agent/providers.ts'
import { credentialsPlugin } from '../agent/seams.ts'
import { capability } from './define.ts'

export const Credentials = capability<{ source: CredentialSource }>({
  name: 'credentials',
  Config: z.object({ source: z.any().required() }) as never,
  seams: (ctx, { source }) => credentialsPlugin(source)(ctx),
})
