# 03: The Turn knows its cause and subject; attempts; interrupt

**Parent:** mr-robot-v1.13 (../mr-robot-v1.13.md) — stories mc-w1aa, mc-w2bb, mc-w3cc, mc-w4dd, mc-w5ee, mc-w6ff, mc-t4dd

**What to build:** The `turn` row gains `task_id`, set at `beginTurn` from a Task Wake-up or later by `task_focus` (once per Turn; only a Task the Robot is assigned to). A Turn with a Task writes an attempt `running` in the Home at start and finishes it `ok` or `failed` at the end (the `finishRoutineRun` path today); `task_done` is the only way to `done`. The Robot reports to the Home registry on begin, on activity change and on end: `turn: { wakeup: { kind, from }, task, activity, since }` and `lastWakeup`; `RobotSummary` carries them. `POST /api/robots/:id/interrupt` → `robot.interrupt(by)`: `running.stop()`, the Wake-up is consumed, the attempt ends `interrupted`, a notice "Interrupted by <name>" goes to the Conversation.

**Blocked by:** 02

**Status:** done

- [x] `turn.task_id`; attempt start and finish on the Home; `interrupted` outcome
- [x] Registry row with cause, subject, activity, since; RobotSummary fields
- [x] Interrupt route and Robot method; notice in the Conversation
- [x] Workerd tests: attempt lifecycle, focus once per Turn, registry row, interrupt
