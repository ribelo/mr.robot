import { describe, expect, it } from 'vitest'
import { chatMessages } from '../src/providers/openai-chat.ts'

describe('Workers AI history after a tool call', () => {
  it('sends an empty string, not null, for an assistant turn with only tool calls', () => {
    const options = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Call yourself Plant Keeper.' }] },
        { role: 'assistant', content: [{ type: 'tool-call', id: 'call_1', name: 'set_identity', arguments: '{"name":"Plant Keeper"}' }] },
        { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'ok' }] },
      ],
    } as never
    expect(chatMessages(options, '').find((message) => message.role === 'assistant')).toMatchObject({ content: '' })
    expect(chatMessages(options).find((message) => message.role === 'assistant')).toMatchObject({ content: null })
  })
})
