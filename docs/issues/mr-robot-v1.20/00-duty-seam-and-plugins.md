# 00: The duty seam, the bounded-step helper, and the moves out of robot.ts

**What to build:** A duty seam the Robot DO provides to its composition (register a named duty with nextAt, run and order; the alarm computes the earliest moment over duties and the core's own, runs due duties after the core's work in declared order, re-arms) and one bounded-step helper (platformStep: instruction, tool allow-list, step limit, usage source, Trajectory record). Then the mechanical moves the spec's plugin audit lists, each behind its existing tests: idle warming and compaction to an Idle plugin; the Box idle stop to the places plugin; the say safety net and its ten-minute steer to the say plugin; Auto review to a plugin supplying the gate's review hook; the external fence to one decorator in the gated tool runtime; screenshot sweep, screen watch, outbox delivery, chain resume and sign-in capture expiry to their owners' plugins as duties. Tasks firing, parked release, draining and Subagent resume stay in the core. No behaviour changes; every existing test stays green; robot.ts loses what moved.

**Blocked by:** None (can start immediately; needs v1.18 and v1.19 merged)

**Status:** ready-for-agent

- [ ] The duty seam and platformStep exist, with their contracts recorded as an ADR in docs/adr/
- [ ] Each listed mechanism moved, its tests unchanged and green, runAlarm reduced to the core's work plus the duty loop
- [ ] The closing note records robot.ts's line count before and after
