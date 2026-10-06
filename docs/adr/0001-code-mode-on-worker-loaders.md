# 0001: Code mode runs on Worker Loaders

Status: accepted (deployed measurements pending; see below)
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

## Pending

The ticket asks for the numbers on a real deployment. Deploy the prototype with
`cd prototypes/ptc && pnpm dev` replaced by `wrangler deploy` once the account is logged in, run
`/bench?candidate=loader&iterations=20` and `candidate=quickjs`, add the table here, then delete
`prototypes/` (nothing throwaway stays).
