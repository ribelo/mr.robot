import { describe, expect, it } from 'vitest'
import { anthropicMessages } from '../src/providers/anthropic.ts'
import { inputItems } from '../src/providers/codex.ts'

const options = {
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'look' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call_1', name: 'browser_screenshot', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'Screenshot saved.' }, { type: 'image', attachment: { attachmentId: 'screen:a.png', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } }] },
  ],
} as never
const images = new Map([['screen:a.png', { mediaType: 'image/png', base64: 'iVBO' }]])

describe('screenshots reach vision models', () => {
  it('Claude gets the image inside the tool result', () => {
    const tool = anthropicMessages(options, 'anthropic', images).at(-1)!.content[0] as { content: unknown }
    expect(tool.content).toEqual([{ type: 'text', text: 'Screenshot saved.' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } }])
  })

  it('Responses gets it as an input image after the function output', () => {
    const items = inputItems(options, images)
    expect(items.at(-1)).toMatchObject({ type: 'message', role: 'user', content: [{ type: 'input_text' }, { type: 'input_image', image_url: 'data:image/png;base64,iVBO' }] })
  })

  it('a model without the bytes gets a placeholder', () => {
    const tool = anthropicMessages(options, 'anthropic').at(-1)!.content[0] as { content: unknown }
    expect(tool.content).toBe('Screenshot saved.\n[image not shown to this model]')
  })
})
