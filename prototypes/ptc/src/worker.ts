/**
 * THROWAWAY (ticket 02): run one model-style program that calls three stub tools, from inside
 * a Durable Object, on (a) a Worker Loader isolate and (b) QuickJS compiled to Wasm.
 * GET /bench?candidate=loader|quickjs&iterations=N returns timings.
 */
import { DurableObject, RpcTarget } from 'cloudflare:workers'
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import baseVariant from '@jitl/quickjs-wasmfile-release-sync'
import wasmModule from './quickjs.wasm'
import { transform } from 'sucrase'

interface Env {
  BENCH: DurableObjectNamespace<Bench>
  LOADER: WorkerLoader
}

const PROGRAM = `
const sum: number = await tools.add({ a: 2, b: 3 })
const echoed = await tools.echo({ text: 'hello' })
const page = await tools.fetchPage({ url: 'https://example.com' })
let loops = 0
for (let i = 0; i < 20; i++) loops += (await tools.add({ a: i, b: 1 })) as number
return { sum, echoed, length: page.length, loops }
`

const STUB_TOOLS: Record<string, (args: any) => Promise<unknown>> = {
  add: async ({ a, b }) => a + b,
  echo: async ({ text }) => text,
  fetchPage: async ({ url }) => `<html>${url}</html>`.repeat(50),
}

function stripTypes(program: string): string {
  return transform(`async function __program__(tools) {\n${program}\n}`, { transforms: ['typescript'], disableESTransforms: true }).code
}

class ToolBridge extends RpcTarget {
  calls = 0
  async call(name: string, argsJson: string): Promise<string> {
    this.calls += 1
    const tool = STUB_TOOLS[name]
    if (tool === undefined) throw new Error(`no tool ${name}`)
    return JSON.stringify(await tool(JSON.parse(argsJson)))
  }
}

let quickjs: QuickJSWASMModule | undefined

export class Bench extends DurableObject<Env> {
  async run(candidate: 'loader' | 'quickjs', iterations: number) {
    const code = stripTypes(PROGRAM)
    const timings: number[] = []
    let result: unknown
    let calls = 0
    for (let index = 0; index < iterations; index += 1) {
      const started = Date.now()
      const outcome = candidate === 'loader' ? await this.viaLoader(code, index) : await this.viaQuickJs(code)
      timings.push(Date.now() - started)
      result = outcome.value
      calls += outcome.calls
    }
    return { candidate, iterations, first: timings[0], rest: timings.slice(1), result, toolCalls: calls }
  }

  private async viaLoader(code: string, index: number) {
    const bridge = new ToolBridge()
    const worker = this.env.LOADER.load({
      compatibilityDate: '2026-09-01',
      mainModule: 'main.js',
      modules: {
        'main.js': `import { WorkerEntrypoint } from 'cloudflare:workers'
${code}
export default class extends WorkerEntrypoint {
  async run(bridge) {
    const tools = new Proxy({}, { get: (_, name) => async (args) => JSON.parse(await bridge.call(String(name), JSON.stringify(args ?? {}))) })
    return JSON.stringify(await __program__(tools))
  }
}`,
      },
      globalOutbound: null,
      env: {},
    })
    const entry = worker.getEntrypoint() as unknown as { run(bridge: ToolBridge): Promise<string> }
    const value = JSON.parse(await entry.run(bridge))
    void index
    return { value, calls: bridge.calls }
  }

  private async viaQuickJs(code: string) {
    quickjs ??= await newQuickJSWASMModuleFromVariant(newVariant(baseVariant, { wasmModule }))
    const runtime = quickjs.newRuntime()
    runtime.setMemoryLimit(32 * 1024 * 1024)
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 30_000))
    const vm = runtime.newContext()
    let calls = 0
    try {
      const call = vm.newFunction('__call', (nameHandle, argsHandle) => {
        const name = vm.getString(nameHandle)
        const args = vm.getString(argsHandle)
        const deferred = vm.newPromise()
        calls += 1
        const tool = STUB_TOOLS[name]
        Promise.resolve(tool === undefined ? Promise.reject(new Error(`no tool ${name}`)) : tool(JSON.parse(args)))
          .then((value) => { const handle = vm.newString(JSON.stringify(value)); deferred.resolve(handle); handle.dispose() })
          .catch((error) => { const handle = vm.newString(String(error)); deferred.reject(handle); handle.dispose() })
          .finally(() => runtime.executePendingJobs())
        return deferred.handle
      })
      vm.setProp(vm.global, '__call', call)
      call.dispose()
      const result = vm.evalCode(`${code}
const tools = new Proxy({}, { get: (_, name) => async (args) => JSON.parse(await __call(String(name), JSON.stringify(args ?? {}))) })
__program__(tools).then((value) => JSON.stringify(value))`)
      const promise = vm.unwrapResult(result)
      const settled = await vm.resolvePromise(promise)
      promise.dispose()
      const handle = vm.unwrapResult(settled)
      const value = JSON.parse(vm.getString(handle))
      handle.dispose()
      return { value, calls }
    } finally {
      vm.dispose()
      runtime.dispose()
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const candidate = url.searchParams.get('candidate') === 'quickjs' ? 'quickjs' : 'loader'
    const iterations = Math.min(50, Number(url.searchParams.get('iterations') ?? '5'))
    const bench = env.BENCH.getByName(url.searchParams.get('object') ?? 'bench')
    const started = Date.now()
    const report = await bench.run(candidate, iterations)
    return Response.json({ ...report, wallMs: Date.now() - started })
  },
} satisfies ExportedHandler<Env>
