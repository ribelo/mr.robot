import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface TakeoverHost {
  requestTakeover(reason: string): Promise<{ status: string }>
}

/** Ask the owner to take over the browser (robot-doqx): logins, 2FA, choices only they can make. */
export function takeoverTools(host: TakeoverHost): ToolDefinition[] {
  return [
    tool<{ reason: string }>({
      name: 'browser_request_takeover',
      description: 'Ask your owner to take over your browser from their phone, for a login, a 2FA code, or anything you must not guess. Your browser stays open as it is. After calling this, end your Turn with one short line; you will be woken when they hand it back.',
      parameters: { properties: { reason: { type: 'string', description: 'What they need to do, in one sentence' } }, required: ['reason'] },
      execute: async ({ reason }) => host.requestTakeover(reason),
    }),
  ]
}
