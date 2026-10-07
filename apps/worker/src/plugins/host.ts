/** Files and a shell on the owner's computers, per granted host (hs-n34u). */
import z from '@deepseek-ai/schemastery'
import { hostTools, type HostToolHost } from '../agent/tools/host.ts'
import { capability } from './define.ts'

export const Host = capability<{ host: HostToolHost; files: readonly string[]; shell: readonly string[] }>({
  name: 'host',
  Config: z.object({ host: z.any().required(), files: z.array(z.string()).default([]), shell: z.array(z.string()).default([]) }) as never,
  tools: ({ host, files, shell }) => hostTools(host, { files, shell }),
})
