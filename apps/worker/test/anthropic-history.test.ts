import { describe, expect, it } from 'vitest'
import { anthropicMessages } from '../src/providers/anthropic.ts'

describe('switching a Robot to Claude mid-conversation', () => {
  it('rewrites tool ids from other models to the characters Anthropic accepts', () => {
    const messages = anthropicMessages({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'tool-call', id: 'functions.run_code:0', name: 'run_code', arguments: '{}' }], source: { kind: 'model', provider: 'workers-ai', model: 'kimi' } },
        { role: 'tool', toolCallId: 'functions.run_code:0', content: [{ type: 'text', text: 'ok' }] },
      ],
    } as never, 'anthropic')
    const json = JSON.stringify(messages)
    expect(json).toContain('"id":"functions_run_code_0"')
    expect(json).toContain('"tool_use_id":"functions_run_code_0"')
  })
})
