# 05: Routines become Tasks

**Parent:** mr-robot-v1.13 (../mr-robot-v1.13.md) — stories mc-t7gg, mc-c2bb

**What to build:** On first load after the version, the Home walks its registry and calls `exportRoutines()` on each Robot in batches. Each Routine becomes a Task: `once` → scheduled, the rest → recurring with the same rule, time zone and next; `createdBy` the Robot; `paused` kept; runs → attempts. The Robot then drops `routine` and `routine_run`. Unreachable Robots are retried on the next load; the Admin page shows "n Robots still to migrate" until none is left. Existing Conversation items of kind `routine` and Senders of kind `routine` keep rendering through a read-time mapping; no log rewrite.

**Blocked by:** 02

**Status:** done

- [x] `exportRoutines()` on the Robot; Home migration in batches with retry; Admin count
- [x] Read-time mapping of old chat items and senders
- [x] Workerd test: a Robot with Routines and runs migrates to Tasks with attempts; old items decode
