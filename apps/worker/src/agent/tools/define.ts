import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

type JsonSchema = Record<string, unknown>

export interface ToolSpec<A> {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchema
  readonly concurrencySafe?: boolean
  readonly execute: (args: A, exec: ToolRunContext) => Promise<unknown>
}

/** A DSH tool whose result is JSON shown to the model as text. */
export function tool<A>(spec: ToolSpec<A>): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: { type: 'object', additionalProperties: false, ...spec.parameters } as never,
    ...(spec.concurrencySafe === true ? { isConcurrencySafe: () => true } : {}),
    output: {
      schema: {} as never,
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    execute: (args, exec) => spec.execute(args as A, exec),
  } as ToolDefinition
}
