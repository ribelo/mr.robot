/**
 * Ask per call (v1.11, sk-hx8j, sk-ed7r, sk-fx6q): a tool whose grant item is at ask does not run when
 * the Robot calls it. The call is stored exactly as an Ask of kind tool-call and the Robot gets a
 * "waiting for your owner" result; on approval the platform runs the stored call once and wakes the
 * Robot with its result. The wrapper is put on the tool definition at registration, so a direct call
 * and a call from a code-mode program meet the same gate.
 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { GrantKind, GrantLevel } from '@mr-robot/protocol'

/** One grant item: a tool group, a skill, a recipient, a login, a Host facet or a Connection (with :write). */
export interface GrantItem {
  readonly kind: GrantKind
  readonly name: string
}

export type CallArgs = Readonly<Record<string, unknown>>

/** The grant items the calls of one tool use. */
export interface ToolItems {
  /** Every item some call of the tool may use: the tool is wrapped when one of them is at ask. */
  readonly possible: readonly GrantItem[]
  /** The items one call uses, from its arguments (a Connection picked by account, a login by name). */
  readonly used: (args: CallArgs) => Promise<readonly GrantItem[]>
  /**
   * The tool asks the owner itself when a call uses an item at ask (the places: they know the computer an escalated call lifts the sandbox
   * of, and the Hosts each end resolved to, deep review P14). The gate still wants the reason and still reviews calls at allow.
   */
  readonly asksAtExecution?: true
}

/** Items of the tools of one mounted capability, by tool name. */
export type ItemsOf = (tool: string) => ToolItems

export const NO_ITEMS: ToolItems = { possible: [], used: async () => [] }

/** Every call uses the same items (a tool group). */
export function fixedItems(...items: readonly GrantItem[]): ToolItems {
  return { possible: items, used: async () => items }
}

/** Both sets: a group item and the items a call picks by its arguments. */
export function bothItems(a: ToolItems, b: ToolItems): ToolItems {
  if (a.possible.length === 0) return b
  if (b.possible.length === 0) return a
  return { possible: [...a.possible, ...b.possible], used: async (args) => [...(await a.used(args)), ...(await b.used(args))] }
}

/** Per-call items a tool declares itself (a connector tool knows which Connection a call acts on). */
const declared = new WeakMap<ToolDefinition, ToolItems>()

export function withCallItems(definition: ToolDefinition, items: ToolItems): ToolDefinition {
  declared.set(definition, items)
  return definition
}

export function callItemsOf(definition: ToolDefinition): ToolItems {
  return declared.get(definition) ?? NO_ITEMS
}

/** The call to put to the owner. */
export interface ToolCallRequest {
  readonly tool: string
  /** The arguments exactly as the Robot gave them, without the gate's reason. */
  readonly arguments: CallArgs
  readonly reason: string
  /** The items at ask that made this call wait. */
  readonly items: readonly GrantItem[]
  /**
   * Every item the call uses, at ask or not, in the order the call names them: the Hosts among them are the ones the approved call may run
   * on, and a replay that resolves to other Hosts is refused (deep review P14).
   */
  readonly uses: readonly GrantItem[]
}

/** What the reviewer decided about one call (Auto review, v1.14 ticket 08). */
export type ReviewOutcome = { readonly decision: 'allow' } | { readonly decision: 'deny'; readonly reason: string }

/** What the gate asks of the Robot. */
export interface AskGateHost {
  /** The level of an item now (read at each call: a level changed mid-Turn applies at once). */
  level(item: GrantItem): GrantLevel
  /** Store the Ask; its id is what the Robot is told and what the owner's answer names. */
  askToolCall(request: ToolCallRequest, exec: ToolRunContext): { readonly askId: string }
  /** The platform runs this call because the owner approved it: it passes the gate once. */
  approved(callId: string): boolean
  /** Auto review is on: every call of an item at allow is reviewed before it runs (ao-wkpt). */
  reviewing?(): boolean
  /** Review one call; rejects when the review failed, and the call then does not run (ao-gf33). */
  review?(call: { readonly definition: ToolDefinition; readonly arguments: CallArgs; readonly exec: ToolRunContext }): Promise<ReviewOutcome>
}

export const WAITING_STATUS = 'waiting for your owner'

export interface WaitingResult {
  readonly status: typeof WAITING_STATUS
  readonly askId: string
  readonly next: string
}

export function waitingResult(askId: string, tool: string): WaitingResult {
  return {
    status: WAITING_STATUS,
    askId,
    next: `${tool} did not run: your owner decides each call of it. End your Turn now with one short line. When they answer, you are woken with the result of this exact call, or with their reason for rejecting it. Do not call it again meanwhile.`,
  }
}

export function isWaitingResult(value: unknown): value is WaitingResult {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record['status'] === WAITING_STATUS && typeof record['askId'] === 'string'
}

export const REASON_PARAMETER = 'reason'
const REASON_SCHEMA = { type: 'string', description: 'Why you need this call, in one sentence. Your owner reads it before approving the call.' }

type ObjectSchema = { readonly properties?: Record<string, unknown>; readonly required?: readonly string[] } & Record<string, unknown>

/** Whether the tool has a reason parameter of its own (browser_request_takeover): the gate then reads that one. */
function ownsReason(definition: ToolDefinition): boolean {
  const properties = (definition.parameters as ObjectSchema).properties ?? {}
  return Object.hasOwn(properties, REASON_PARAMETER)
}

/** The parameters with a required reason: a tool's own description of it stays. */
function withReason(parameters: ObjectSchema): ObjectSchema {
  const required = parameters.required ?? []
  return {
    ...parameters,
    properties: { [REASON_PARAMETER]: REASON_SCHEMA, ...(parameters.properties ?? {}) },
    required: required.includes(REASON_PARAMETER) ? required : [...required, REASON_PARAMETER],
  }
}

function argsOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * The definition the Robot registers: unchanged when no item the tool may use is at ask, otherwise
 * wrapped. The wrapper adds a required reason parameter, strips it before the tool sees its arguments,
 * and stores an Ask instead of running the tool when the call uses an item at ask.
 */
export function gateTool(definition: ToolDefinition, items: ToolItems, host: AskGateHost): ToolDefinition {
  const asks = items.possible.some((item) => host.level(item) === 'ask')
  const reviewed = host.reviewing?.() === true && host.review !== undefined
  if (!asks && !reviewed) return definition
  // Only a tool that may ask its owner takes the reason the owner reads; a reviewed call is explained by the reviewer.
  const own = ownsReason(definition) || !asks
  const inner = (args: unknown): Record<string, unknown> => {
    if (own) return argsOf(args)
    const { [REASON_PARAMETER]: _reason, ...rest } = argsOf(args)
    return rest
  }
  const output = definition.output
  const presentationMeta = output.presentationMeta
  const isConcurrencySafe = definition.isConcurrencySafe
  const presentCall = definition.presentCall
  const presentResult = definition.presentResult
  return {
    ...definition,
    // A call that may ask needs a reason, whether the tool names the parameter itself (run, the file tools: they also take it for escalate) or not.
    parameters: (asks ? withReason(definition.parameters as ObjectSchema) : definition.parameters) as ToolDefinition['parameters'],
    output: {
      // A waiting result is not the tool's own value, so the tool's output schema cannot hold it.
      schema: {} as ToolDefinition['output']['schema'],
      render: (args, value) => (isWaitingResult(value) ? [{ type: 'text', text: JSON.stringify(value, null, 2) }] : output.render(inner(args), value)),
      ...(presentationMeta === undefined ? {} : { presentationMeta: (args, value) => (isWaitingResult(value) ? null : presentationMeta.call(output, inner(args), value)) }),
    },
    ...(isConcurrencySafe === undefined ? {} : { isConcurrencySafe: (args: unknown) => isConcurrencySafe.call(definition, inner(args)) }),
    ...(presentCall === undefined ? {} : { presentCall: (args: unknown) => presentCall.call(definition, inner(args)) }),
    ...(presentResult === undefined ? {} : { presentResult: (args: unknown, result: Parameters<typeof presentResult>[1]) => presentResult.call(definition, inner(args), result) }),
    execute: async (args: unknown, exec: ToolRunContext) => {
      const given = inner(args)
      if (host.approved(String(exec.callId))) return definition.execute(given, exec)
      const used = await items.used(given)
      const asking = used.filter((item) => host.level(item) === 'ask')
      if (asking.length === 0) {
        // Items at ask keep asking; a call at allow is reviewed first when Auto review is on (ao-wkpt).
        if (!reviewed) return definition.execute(given, exec)
        const outcome = await host.review!({ definition, arguments: given, exec }).catch((error: unknown) => {
          throw new Error(`Auto review of ${definition.name} failed, so the call did not run: ${error instanceof Error ? error.message : String(error)}`)
        })
        if (outcome.decision === 'allow') return definition.execute(given, exec)
        // A denial is never final: the owner decides, with the reviewer's reason (ao-gf33).
        const { askId } = host.askToolCall({ tool: definition.name, arguments: given, reason: `Auto review denied this call: ${outcome.reason}`, items: used, uses: used }, exec)
        return waitingResult(askId, definition.name)
      }
      const reason = argsOf(args)[REASON_PARAMETER]
      if (typeof reason !== 'string' || reason.trim() === '') throw new Error(`${definition.name}: parameter "${REASON_PARAMETER}" is required: your owner approves each call of this tool and reads why you need it.`)
      if (items.asksAtExecution === true) return definition.execute(given, exec)
      const { askId } = host.askToolCall({ tool: definition.name, arguments: given, reason: reason.trim(), items: asking, uses: used }, exec)
      return waitingResult(askId, definition.name)
    },
  } as ToolDefinition
}

/** The gate for the tools of one mounted capability: its own items, and the items each tool declares. */
export function askGate(host: AskGateHost, itemsOf: ItemsOf): (definition: ToolDefinition) => ToolDefinition {
  return (definition) => gateTool(definition, bothItems(itemsOf(definition.name), callItemsOf(definition)), host)
}
