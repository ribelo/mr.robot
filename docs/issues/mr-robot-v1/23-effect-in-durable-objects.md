# 23: Durable Object internals on Effect

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — story robot-naul

**What to build:** The owner's instruction: Effect as much as possible on the Cloudflare side, as little as possible inside the agent. Today Effect runs the edge API, Workspace (R2), vault, OAuth, Web Push, model catalogs and the composition scope, but the Robot, Member and Home Durable Objects are plain classes with async methods (~2,700 lines). Move their internals onto Effect services (store, turn queue, routines and alarm, outbox, browser, notifications, limits, providers) with typed errors, leaving the Durable Object class and the DSH Cordis plugins as thin adapters at the boundary. Behaviour stays the same; the worker test suite is the check.

**Blocked by:** none

**Status:** in-progress

- [ ] Robot DO: turn queue, routines/alarm, outbox, browser and limits as Effect services; the class only adapts RPC and alarm to them
- [x] Member and Home DOs the same
- [x] Failures are typed Effect errors, mapped to API errors at the edge
- [x] Worker test suite and the staging test pass unchanged

Progress 2026-10-07:
- Member and Home DOs: every RPC method is an Effect program over services (Sql, vaults, other DOs); the class only declares tables and adapts RPC (member/member.ts, home/home.ts, platform/durable.ts).
- Robot DO: lifecycle, wake-ups, Routines, Robot messages and outbox, Mr. Robot's tools, settings, spend limits, proposals and answers, secrets, rewind and undo run as Effect programs (robot/programs.ts).
- Typed failures (NotFound, Invalid, Conflict) cross RPC with name and status; the edge maps them to 404/400/409.
- Still plain async in the Robot DO: creation and Workspace seeding, the read views (conversation, trajectory, panel, admin row), the browser, takeover and screencast sockets, Channels, and the alarm. The DSH agent loop stays a Cordis adapter by design.
