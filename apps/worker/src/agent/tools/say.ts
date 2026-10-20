import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SAY_MAX_ATTACHMENTS } from '../say.ts'
import { tool } from './define.ts'

/** What say needs of the Robot that runs it (agent/say.ts). */
export interface SayHost {
  /** Show one message to the owner at once and send it out on the Channel the Wake-up came from; throws a clear error for an attachment or channel it cannot use. */
  say(input: { readonly text: string; readonly attachments: readonly string[]; readonly channel?: string }, exec: ToolRunContext): Promise<{ readonly said: true; readonly attachments: number }>
}

/** The voice (v1.15 ticket 01): the only way a Robot speaks to people. Not offered to Subagents. */
export function sayTools(host: SayHost): ToolDefinition[] {
  return [
    tool<{ text: string; attachments?: string[]; channel?: string }>({
      name: 'say',
      description: "Say something to your owner: it is the only way you speak to people. Each call is one message, shown at once in the Conversation and sent on the Channel your Wake-up came from; assistant text you write without it is not shown. Write Markdown. Attach a file of your Workspace by its path, or a screenshot by its id (screen:<name>, from browser_screenshot): they are handed over by reference, so you do not write them out. Say as often as the work needs, for example once to start and once with the result.",
      parameters: {
        properties: {
          text: { type: 'string', description: 'The message, in Markdown' },
          attachments: { type: 'array', items: { type: 'string' }, description: `Workspace paths and screenshot ids (screen:<name>) to show with the message, at most ${SAY_MAX_ATTACHMENTS}. An image is shown inside the message, any other file as a file to open or download` },
          channel: { type: 'string', description: 'A Channel address to speak on instead of where your Wake-up came from, for example the id of your Discord channel. Only a Channel your owner enabled for you' },
        },
        required: ['text'],
      },
      execute: async ({ text, attachments, channel }, exec) => host.say({ text, attachments: attachments ?? [], ...(channel === undefined || channel.trim() === '' ? {} : { channel: channel.trim() }) }, exec),
    }),
  ]
}
