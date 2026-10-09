import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { NotificationKind } from '@mr-robot/protocol'
import { tool } from './define.ts'

export interface NotifyHost {
  notifyMembers(kind: NotificationKind, body: string): Promise<number>
}

/** A Robot-composed push to its owner (robot-9xoj); PROACTIVE_PREFERENCES.md says what and when. */
export function notifyTools(host: NotifyHost): ToolDefinition[] {
  return [
    tool<{ message: string; needs_owner?: boolean }>({
      name: 'notify_owner',
      description: 'Send your owner a push notification. Read PROACTIVE_PREFERENCES.md first and follow it. Keep it to one or two lines. Set needs_owner when they must act. Quiet hours are enforced for you: a notification sent during them arrives when they end.',
      parameters: { properties: { message: { type: 'string', description: 'The notification text, one or two lines' }, needs_owner: { type: 'boolean', description: 'true when your owner must act' } }, required: ['message'] },
      execute: async ({ message, needs_owner }) => {
        const sent = await host.notifyMembers(needs_owner === true ? 'needs you' : 'finished', message)
        return sent === 0
          ? { status: 'off', message: 'Notifications are switched off for this Robot.' }
          : { status: 'sent', message: 'Your owner was notified.' }
      },
    }),
  ]
}
