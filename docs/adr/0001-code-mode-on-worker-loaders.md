# 0001: Code mode runs on Worker Loaders

Status: accepted
Date: 2026-10-06
Ticket: docs/issues/mr-robot-v1/02-ptc-isolate-prototype.md (story robot-5ewr)

## Decision

The PTC executor (code mode) runs each model-written program in a fresh Worker Loader isolate
(`env.LOADER.load`), with `globalOutbound: null` and the Robot's granted tools passed in as one
RPC target. QuickJS-in-Wasm is not used. The executor is `apps/worker/src/agent/ptc.ts`
(`WorkerLoaderPtcRuntime`, a DSH `PtcRuntime`).

## Why

Both candidates ran the same program (types stripped, 230 tool calls to three stub tools, the
fixture in `prototypes/ptc`) from inside a Durable Object, under local workerd (wrangler 4.147):

| | Worker Loader | QuickJS (wasmfile, sync) |
|---|---|---|
| first run | 3 ms | 9 ms (Wasm instantiation) |
| later runs | 2–4 ms | ~1 ms |
| 230 tool calls | included above | included above |
| language | full V8 JavaScript, async/await native | ES2023 subset; async host calls need a deferred-promise bridge |
| isolation | separate isolate, no network, CPU limit per load | same isolate as the Robot, memory/interrupt limits by hand |
| bundle cost | none | +503 KB Wasm in the Robot's Worker |

Speed is not the deciding factor: both are far below one model call. What decides it:

- Isolation. A Worker Loader program cannot reach the Robot's memory, storage or network; QuickJS
  shares the Robot's isolate, so a runtime bug there is a Robot bug.
- Fidelity. Models write ordinary modern TypeScript; V8 runs all of it, QuickJS needs workarounds
  for async tool calls and lacks some built-ins.
- Size. The Worker stays without a 0.5 MB Wasm module, under the 3 MB/10 MB script limits with room.

Constraints accepted: Worker Loaders are open beta and need Workers Paid; a Durable Object may have
at most 10 dynamic Workers in flight, which one Turn at a time per Robot never approaches.

## Measured on Cloudflare

2026-10-06, Workers Paid account, the same program from inside a Durable Object, 20 runs per request
(23 tool calls per run), two requests per candidate:

| | Worker Loader | QuickJS |
|---|---|---|
| whole request, 20 runs | 825 ms, 711 ms | 471 ms, 623 ms |
| per run, end to end | about 36–41 ms | about 24–31 ms |
| per run, in-Worker clock | 7–19 ms (one 130 ms outlier) | 0 ms (the Workers clock does not advance during synchronous Wasm) |

QuickJS is about 10 ms faster per program. One model call takes seconds, so this does not change
the decision; isolation, fidelity and bundle size do. The prototype was deleted from the account and the repo.
