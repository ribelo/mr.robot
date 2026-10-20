/** Mounted on every active Robot with no Grant (v1.15 tickets 03 and 05): put a question or a credential request to the owner. */
import z from '@deepseek-ai/schemastery'
import { askTools } from '../agent/tools/ask.ts'
import { credentialTools } from '../agent/tools/credential.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof askTools>[0]

export const Ask = capability<{ host: Host }>({
  name: 'ask',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => [...askTools(host), ...credentialTools(host)],
})
