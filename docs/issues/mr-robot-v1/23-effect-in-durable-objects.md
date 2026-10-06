# 23: Durable Object internals on Effect

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — story robot-naul

**What to build:** The owner's instruction: Effect as much as possible on the Cloudflare side, as little as possible inside the agent. Today Effect runs the edge API, Workspace (R2), vault, OAuth, Web Push, model catalogs and the composition scope, but the Robot, Member and Home Durable Objects are plain classes with async methods (~2,700 lines). Move their internals onto Effect services (store, turn queue, routines and alarm, outbox, browser, notifications, limits, providers) with typed errors, leaving the Durable Object class and the DSH Cordis plugins as thin adapters at the boundary. Behaviour stays the same; the worker test suite is the check.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] Robot DO: turn queue, routines/alarm, outbox, browser and limits as Effect services; the class only adapts RPC and alarm to them
- [ ] Member and Home DOs the same
- [ ] Failures are typed Effect errors, mapped to API errors at the edge
- [ ] Worker test suite and the staging test pass unchanged
