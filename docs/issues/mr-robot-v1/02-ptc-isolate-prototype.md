# 02: Code-mode isolate prototype and decision

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-5ewr

**What to build:** A throwaway prototype runs a model-written program inside an isolated JavaScript runtime from within a Durable Object, with tools bound as RPC calls back into the DO: once on Cloudflare Worker Loaders, once on QuickJS compiled to Wasm. The outcome is an ADR choosing one, with the measured constraints (startup, CPU budget, tool-call latency, limits on isolate count) that drove the choice. The chosen runtime becomes the PTC executor used by ticket 07.

**Blocked by:** 01 Repository skeleton and first Cloudflare deploy

**Status:** ready-for-agent

- [ ] Both candidates execute the same sample program calling three stub tools from inside a DO on a real deployment
- [ ] An ADR in docs/adr records the choice and the measurements
- [ ] The prototype code is deleted or moved under the chosen executor package; nothing throwaway stays
