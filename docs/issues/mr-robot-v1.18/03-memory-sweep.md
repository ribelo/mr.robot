# 03: The memory sweep before idle compaction

**What to build:** The bounded step before idle compaction becomes the memory sweep with its instruction; skipped when no daily note changed since the last sweep; writes carry author sweep and are versioned; the Trajectory records what changed (rm-glmd, rm-5org, rm-hhxa, rm-l4t8).

**Blocked by:** 01, 02

**Status:** done

- [x] Workerd test: the sweep runs with its instruction on the Robot's model before idle compaction and never during a Turn; skipped without changed notes; writes versioned as sweep; Trajectory entry (rm-glmd, rm-5org, rm-hhxa, rm-l4t8)

## Closing note

apps/worker/test/memory-sweep.test.ts (the sweep's instruction on the Robot's model before the compaction, its write as a version by the sweep, the Trajectory record, the Robot's writes its own again after; skipped without a changed note while the compaction still runs; nothing during a Turn); idle.test.ts now writes a daily note before its idle moment.

Decisions:
- The sweep replaces the "write what matters" step in the same place (idleCompact), with the same step limit (4) and the same agent, so it runs on the Robot's model on the warm cache and never inside a Turn. The instruction (memorySweepNote in idle.ts) names the daily notes that changed since the last sweep.
- "Changed since the last sweep" is the R2 upload time of memory/YYYY-MM-DD.md against a stored moment (memory-swept-at, set when a sweep starts). A Robot that never swept takes every note. Without a changed note the step is skipped and the compaction runs without it.
- While the sweep runs, every Workspace write the Robot makes has the author "the memory sweep" (the Robot's Workspace takes a default writer), so the file history shows each change as a sweep version and the owner restores it there.
- The Trajectory entry is an ignorable plugin record, plugin:mr-robot/memory-sweep, with the notes read and the tracked files the sweep changed; the PWA Trajectory lists them under "Memory sweeps", beside Auto review and fallback replies. After the compaction the chapter closes, so the record is in the chapter before.
