/**
 * External text is fenced (v1.15 ticket 10, gb-75j6, gb-d0d4): a tool that brings text from outside (a web page, a search
 * result, an e-mail, a chat message, what the browser shows) has its rendered text result wrapped in
 * <external source="<tool>"> … </external>, so the border between data and instructions is visible in the text. A closing
 * marker inside the content is rewritten, so the content cannot end the fence early. Results of the Robot's own files,
 * Tasks, Hosts and Box are not fenced. A tool is marked external where it is defined; the gated tool runtime (compose.ts) fences every
 * marked tool as it registers, the one place the decorator is applied (v1.20 ticket 00).
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

const CLOSING = /<\/external/gi

/** The text inside the fence for a tool: a closing marker in it is made harmless. */
export function fenceText(source: string, text: string): string {
  return `<external source="${source}">\n${text.replace(CLOSING, '<\\/external')}\n</external>`
}

/** The same tool with the text blocks of its rendered result fenced; images and other blocks stay as they are. */
export function fenced(definition: ToolDefinition): ToolDefinition {
  const render = definition.output.render.bind(definition.output)
  return {
    ...definition,
    output: {
      ...definition.output,
      render: (args, value) => render(args, value).map((block) => (block.type === 'text' ? { ...block, text: fenceText(definition.name, block.text) } : block)),
    },
  } as ToolDefinition
}
const EXTERNAL = Symbol('external')

/** Mark a tool whose result carries text from outside. */
export function markExternal(definition: ToolDefinition): ToolDefinition {
  return Object.assign({ ...definition }, { [EXTERNAL]: true }) as ToolDefinition
}

export function isExternal(definition: ToolDefinition): boolean {
  return (definition as unknown as Record<symbol, unknown>)[EXTERNAL] === true
}
