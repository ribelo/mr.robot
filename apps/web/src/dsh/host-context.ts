/** What the trajectory definitions register into: a stand-in for DSH's ctx.uiConversation. */
import type { ConversationNodeDefinition, ConversationViewDefinition } from './contract/conversation.ts'
import type { inspectRequestPrompt } from './contract/request-inspection.ts'
import type { inspectSystemPrompt } from './contract/system-prompt.ts'

export interface Context {
  readonly uiConversation: {
    readonly events: { register(definition: ConversationNodeDefinition): void }
    readonly views: { register(definition: ConversationViewDefinition): void }
    readonly inspectSystemPrompt: typeof inspectSystemPrompt
    readonly inspectRequestPrompt: typeof inspectRequestPrompt
  }
}
