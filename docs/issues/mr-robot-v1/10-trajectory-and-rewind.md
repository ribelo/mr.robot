# 10: Trajectory view and rewind

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-h5v3, robot-0q6a, robot-8v1t, robot-acr3

**What to build:** The Member switches the same conversation to trajectory mode and sees every turn, tool call, result and executed program. Any point can be chosen for rewind: a new session seeded from the log prefix becomes live, the old log moves to the robot's archive with a rewind record, the robot is told that external effects stand, and the rewind can be undone.

**Blocked by:** 03 A Robot Durable Object runs one turn

**Status:** done

- [x] Trajectory lists events in order with masked secrets
- [x] Rewind to point X: new live session has exactly the events up to X plus the rewind note
- [x] Undo restores the archived log as live
- [x] Chat view after rewind shows only the kept messages
