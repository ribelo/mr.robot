/** The browser (any backend behind the BrowserDriver seam) and takeover requests. */
import z from '@deepseek-ai/schemastery'
import { browserUsePlugin } from '../agent/seams.ts'
import { browserTools } from '../agent/tools/browser.ts'
import { takeoverTools } from '../agent/tools/takeover.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof browserTools>[0] & Parameters<typeof takeoverTools>[0]

export const Browser = capability<{ host: Host }>({
  name: 'browser',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => [...browserTools(host), ...takeoverTools(host)],
  prompt: () => '- When a page needs the owner (login, 2FA, a choice only they can make), request a browser takeover instead of guessing credentials or codes.',
  seams: (ctx) => browserUsePlugin()(ctx),
})
