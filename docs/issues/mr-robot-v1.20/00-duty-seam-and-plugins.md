# 00: The duty seam, the bounded-step helper, and the moves out of robot.ts

**What to build:** A duty seam the Robot DO provides to its composition (register a named duty with nextAt, run and order; the alarm computes the earliest moment over duties and the core's own, runs due duties after the core's work in declared order, re-arms) and one bounded-step helper (platformStep: instruction, tool allow-list, step limit, usage source, Trajectory record). Then the mechanical moves the spec's plugin audit lists, each behind its existing tests: idle warming and compaction to an Idle plugin; the Box idle stop to the places plugin; the say safety net and its ten-minute steer to the say plugin; Auto review to a plugin supplying the gate's review hook; the external fence to one decorator in the gated tool runtime; screenshot sweep, screen watch, outbox delivery, chain resume and sign-in capture expiry to their owners' plugins as duties. Tasks firing, parked release, draining and Subagent resume stay in the core. No behaviour changes; every existing test stays green; robot.ts loses what moved.

**Blocked by:** None (can start immediately; needs v1.18 and v1.19 merged)

**Status:** done

- [x] The duty seam and platformStep exist, with their contracts recorded as an ADR in docs/adr/
- [x] Each listed mechanism moved, its tests unchanged and green, runAlarm reduced to the core's work plus the duty loop
- [x] The closing note records robot.ts's line count before and after

## Closing note

No behaviour changed: the whole suite (180 files, 1028 tests) passed unchanged. robot.ts: 4,406 lines before, 4,283 after (the moved code less the hosts the Robot now gives its plugins).

Decisions:
- The contracts are in docs/adr/0003-duties-and-platform-steps.md. Duties keep the order runAlarm had; the core (Tasks, parked Tasks, draining, Subagent resume) runs first, so the quiet steer and sign-in expiry now run after Tasks fire in one alarm (they did before); nothing waits on that order.
- Moved: idle planning, warming and compaction with the memory sweep to plugins/idle.ts (the sweep now runs through platformStep); the Box idle stop to a duty in plugins/places.ts; the safety net and the ten-minute steer to plugins/say.ts (the safety net through platformStep); Auto review to plugins/auto-review.ts, which gives the gate its review hook; screenshot sweep, chain resume, sign-in expiry, outbox and screen watch to duties in plugins/housekeeping.ts. The screen watch, the outbox delivery and the capture keep their bodies where their state lives; the duty calls them.
- The external fence is applied in one place, the gated tool runtime in compose.ts: define.ts and web.ts mark a tool external, the runtime fences it before the gate wraps it (as before, a waiting result is not fenced).
- The step fence (StepFence) is a DSH tool guard (ctx.tools.guard), checked for every tool, gated or not, so a step's allow-list also stops say, identity and the other ungated tools. A first version wrapped every tool definition and broke the skill catalog, which DSH reads from the registered definition itself; the guard needs no wrapper. It is wired now and first used by ticket 01.
- platformStep books usage only when a step names a source; the safety net is booked by its Turn, as before. The idle compaction books the sweep and the compaction separately, under robot, as one line did before.