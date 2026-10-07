/**
 * Code mode (robot-5ewr): the PTC executor DSH's tools runtime hands the model's program to.
 * Each program runs in a fresh Worker Loader isolate with no network; the Robot's granted tools
 * are the only way out, as RPC calls into the Robot DO (ADR 0001).
 */
import { RpcTarget } from 'cloudflare:workers'
import type { Context } from '@deepseek-ai/cordis'
import { PtcRuntime, type PtcBindingNamespace, type PtcJsonValue, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import z from '@deepseek-ai/schemastery'
import { transform } from 'sucrase'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_CALLS = 500
const MAX_OUTPUT_CHARS = 1_000_000

export interface WorkerLoaderPtcConfig {
  readonly loader: WorkerLoader
  readonly cpuMs?: number
}

/** What the isolate may call: one method, routed to a granted binding. */
class Bridge extends RpcTarget {
  calls = 0
  constructor(private readonly bindings: readonly PtcBindingNamespace[], private readonly signal: AbortSignal | undefined) {
    super()
  }

  async call(global: string, name: string, argsJson: string): Promise<string> {
    if (this.signal?.aborted === true) throw new Error('the program was cancelled')
    this.calls += 1
    if (this.calls > MAX_CALLS) throw new Error(`a program may make at most ${MAX_CALLS} tool calls`)
    const fn = this.bindings.find((binding) => binding.global === global)?.functions[name]
    if (fn === undefined) throw new Error(`${global}.${name} is not available to this Robot`)
    return JSON.stringify(await fn(JSON.parse(argsJson) as unknown))
  }
}

/** The program as the body of an async function, types stripped. */
export function compileProgram(program: string): string {
  return transform(`async function __program__(__bindings__, console) {\n${program}\n}`, {
    transforms: ['typescript'],
    disableESTransforms: true,
  }).code
}

function moduleSource(compiled: string, bindings: readonly PtcBindingNamespace[]): string {
  const shape = bindings.map((binding) => ({ global: binding.global, names: Object.keys(binding.functions), errorClass: binding.errorClass ?? null }))
  return `import { WorkerEntrypoint } from 'cloudflare:workers'
${compiled}
const SHAPE = ${JSON.stringify(shape)}
export default class Program extends WorkerEntrypoint {
  async run(bridge) {
    const logs = []
    const render = (value) => typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) } catch { return String(value) } })()
    const log = (...args) => { logs.push(args.map(render).join(' ')) }
    const console = { log, info: log, warn: log, error: log, debug: log }
    const namespaces = {}
    for (const { global, names, errorClass } of SHAPE) {
      const ErrorClass = errorClass === null ? Error : class extends Error {
        constructor(message, member) { super(message); this.name = errorClass.name; this[errorClass.memberNameProperty] = member }
      }
      const namespace = Object.create(null)
      for (const name of names) {
        namespace[name] = async (args) => {
          try {
            return JSON.parse(await bridge.call(global, name, JSON.stringify(args ?? null)))
          } catch (error) {
            throw new ErrorClass(error instanceof Error ? error.message : String(error), name)
          }
        }
      }
      namespaces[global] = namespace
      if (errorClass !== null) namespaces[errorClass.name] = ErrorClass
    }
    try {
      const value = await __program__.call(undefined, namespaces, console)
      return { value: value === undefined ? null : JSON.stringify(value), logs }
    } catch (error) {
      return { error: { kind: 'exception', message: error instanceof Error ? \`\${error.name}: \${error.message}\` : String(error) }, logs }
    }
  }
}`
}

/** Bind the program's globals: `tools.read_file(...)` becomes `__bindings__.tools.read_file(...)`. */
function withGlobals(program: string, bindings: readonly PtcBindingNamespace[]): string {
  const names = bindings.flatMap((binding) => [binding.global, ...(binding.errorClass === undefined ? [] : [binding.errorClass.name])])
  return `const { ${names.join(', ')} } = __bindings__\n${program}`
}

export class WorkerLoaderPtcRuntime extends PtcRuntime {
  static Config = z.object({ loader: z.any(), cpuMs: z.number() })
  readonly language = 'typescript'
  readonly isolation = 'worker-loader'
  private readonly loader: WorkerLoader
  private readonly cpuMs: number

  constructor(ctx: Context, config: WorkerLoaderPtcConfig) {
    super(ctx)
    this.loader = config.loader
    this.cpuMs = config.cpuMs ?? 30_000
  }

  override get executionInstructions(): string {
    return 'Each program runs in a fresh isolated JavaScript runtime with no network and no filesystem; only the tool bindings reach the outside. Use top-level await and return a JSON value.'
  }

  override get timeout(): { defaultMs: number; maxMs: number } {
    return { defaultMs: DEFAULT_TIMEOUT_MS, maxMs: MAX_TIMEOUT_MS }
  }

  resolve(request: PtcRunRequest): PtcRunSpec {
    const timeoutMs = request.timeoutMs === null ? null : Math.min(MAX_TIMEOUT_MS, request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    return { ...request, cwd: request.cwd ?? '/workspace', timeoutMs }
  }

  async run(spec: PtcRunSpec): Promise<PtcRunResult> {
    let compiled: string
    try {
      compiled = compileProgram(withGlobals(callIfOnlyAFunction(spec.program), spec.bindings))
    } catch (error) {
      return { logs: [], error: { kind: 'exception', message: `the program does not parse: ${error instanceof Error ? error.message : String(error)}` } }
    }
    const bridge = new Bridge(spec.bindings, spec.signal)
    const worker = this.loader.load({
      compatibilityDate: '2026-09-01',
      mainModule: 'program.js',
      modules: { 'program.js': moduleSource(compiled, spec.bindings) },
      globalOutbound: null,
      env: {},
    })
    const entry = worker.getEntrypoint(undefined, { limits: { cpuMs: this.cpuMs } } as never) as unknown as {
      run(bridge: Bridge): Promise<{ value?: string | null; logs: string[]; error?: { kind: 'exception'; message: string } }>
    }
    const deadline = spec.timeoutMs === null
      ? undefined
      : new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), spec.timeoutMs!))
    try {
      const outcome = await (deadline === undefined ? entry.run(bridge) : Promise.race([entry.run(bridge), deadline]))
      const logs = outcome.logs.map((line) => line.slice(0, 10_000))
      if (outcome.error !== undefined) return { logs, error: outcome.error }
      if (outcome.value === undefined || outcome.value === null) return { logs }
      if (outcome.value.length > MAX_OUTPUT_CHARS) return { logs, error: { kind: 'output-limit', message: `the result exceeded ${MAX_OUTPUT_CHARS} characters` } }
      return { logs, value: JSON.parse(outcome.value) as PtcJsonValue }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'timeout') return { logs: [], error: { kind: 'timeout', message: `the program ran longer than ${spec.timeoutMs} ms` } }
      if (spec.signal?.aborted === true) return { logs: [], error: { kind: 'abort', message: 'the program was cancelled' } }
      return { logs: [], error: { kind: 'worker-exit', message } }
    }
  }
}

export function ptcPlugin(loader: WorkerLoader): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(WorkerLoaderPtcRuntime, { loader })
  }
}

/**
 * Some models send the program as one function expression ("async () => { ... }") instead of
 * its body, which would define the function and never run it (seen with gpt-oss-120b, 2026-10-07).
 * Such a program is called and its result returned.
 */
export function callIfOnlyAFunction(program: string): string {
  const trimmed = program.trim().replace(/;$/, '')
  const looksLikeFunction = /^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(trimmed) || /^(async\s+)?function\b/.test(trimmed)
  return looksLikeFunction ? `return await (${trimmed})()` : program
}
