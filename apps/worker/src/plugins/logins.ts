/** Login entries granted to the Robot: list, fill into the page, read when allowed. */
import z from '@deepseek-ai/schemastery'
import { secretTools } from '../agent/tools/secrets.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof secretTools>[0]

export const Logins = capability<{ host: Host; granted: readonly string[] }>({
  name: 'logins',
  Config: z.object({ host: z.any().required(), granted: z.array(z.string()).default([]) }) as never,
  tools: ({ host, granted }) => secretTools(host, [...granted]),
  prompt: () => '- To log in to a website, open its login page and call login_fill with a granted login; you never see the password. Secret values never belong in your replies, notes or messages to other Robots.',
})
