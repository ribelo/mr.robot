import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

type JsonSchema = Record<string, unknown>

export interface ToolSpec<A> {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchema
  readonly concurrencySafe?: boolean
  /** Required string parameters for which the empty string is a real value (an empty file, a deletion, a mail without text). */
  readonly emptyAllowed?: readonly string[]
  readonly execute: (args: A, exec: ToolRunContext) => Promise<unknown>
}

/**
 * Required parameters are checked before the tool does anything (ts-yf1d): present, and a required
 * string not empty unless the tool names it in emptyAllowed. Only the empty string is refused: zero,
 * false and whitespace (a text to find, a separator) are real values. The error names the parameter and the rule.
 */
export function requireParameters(spec: Pick<ToolSpec<unknown>, 'name' | 'parameters' | 'emptyAllowed'>, args: unknown): void {
  const required = Array.isArray(spec.parameters['required']) ? (spec.parameters['required'] as string[]) : []
  const properties = (spec.parameters['properties'] ?? {}) as Record<string, { type?: unknown }>
  const given = (args !== null && typeof args === 'object' ? args : {}) as Record<string, unknown>
  for (const name of required) {
    const value = given[name]
    if (value === undefined || value === null) throw new Error(`${spec.name}: parameter "${name}" is required.`)
    if (properties[name]?.type === 'string' && value === '' && spec.emptyAllowed?.includes(name) !== true) {
      throw new Error(`${spec.name}: parameter "${name}" is required and must not be empty.`)
    }
  }
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
    execute: (args, exec) => {
      requireParameters(spec, args)
      return spec.execute(args as A, exec)
    },
  } as ToolDefinition
}
