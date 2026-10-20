/** Mounted on every active Robot with no Grant (v1.15 tickets 03 and 05): put a question or a credential request to the owner, revise a draft. */
import z from '@deepseek-ai/schemastery'
import { askTools, draftTools, type DraftReviseHost } from '../agent/tools/ask.ts'
import { credentialTools } from '../agent/tools/credential.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof askTools>[0] & DraftReviseHost

/** Also draft_revise (v1.17 ticket 04): a new version of a draft that waits for the owner. */
export const Ask = capability<{ host: Host }>({
  name: 'ask',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => [...askTools(host), ...credentialTools(host), ...draftTools(host)],
})
