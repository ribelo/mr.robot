# 01: Task model and Home store

**Parent:** mr-robot-v1.13 (../mr-robot-v1.13.md) — stories mc-t1aa, mc-t2bb, mc-t3cc, mc-t4dd, mc-t5ee, mc-t6ff, mc-t8hh

**What to build:** The Task types in the protocol (assignee, the three timings as a union, state, remind, attempt, TaskView, Actor) and the Task store in the Home Durable Object (`task`, `task_attempt`, indexes on assignee, parent, next moment, state). The edge API gets `GET/POST/PATCH /api/tasks[/:id]` and `POST /api/tasks/:id/{done,cancel,pause,assign}` with the visibility and assignment rules of the spec. Refusals: deadline before start, deadline on recurring, pause on a non-recurring Task, assign while a Robot works on it (needs 03 for the running check; refuse on a flag the Robot reports). Deleting a Robot and removing a Member set their open Tasks to nobody. No scheduling yet: nothing fires.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Protocol: TaskAssignee, TaskTiming, TaskState, Remind, Attempt, TaskView, Actor, TaskInput, TaskPatch
- [ ] Home store: tables, indexes, CRUD, attempts (last 20 in the view), children count, overdue computed on read
- [ ] API routes with visibility and assignment rules; refusals with messages
- [ ] Orphaning on Robot delete and Member removal
- [ ] Workerd tests through the API for the round trip, the refusals, visibility, orphaning
