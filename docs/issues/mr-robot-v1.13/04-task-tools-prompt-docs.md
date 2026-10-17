# 04: Task tools replace routine tools; deputy fold; prompt and product docs

**Parent:** mr-robot-v1.13 (../mr-robot-v1.13.md) — stories mc-r1aa, mc-r2bb, mc-r3cc, mc-r4dd, mc-r5ee, mc-g2bb

**What to build:** The `routines` tool group becomes `tasks` (same Grant, migrated by name): `task_list`, `task_create`, `task_update`, `task_assign`, `task_focus`, `task_done`, `task_cancel`, `task_pause`, each with the optional `robot_id` Mr. Robot may use (others get the same error as `routine_*` gave). The deputy's `robot_routines`, `robot_routine_set`, `robot_routine_pause`, `robot_routine_delete` go. `task_list` returns what the spec says a Robot may see. A Robot assigns to its owner, the owner's Robots and itself; to another Member only when that Member's `acceptTasksFrom` names the owner (refused with a message naming the setting). The platform prompt's routine section becomes a task section; `docs/routines.ts` becomes `docs/tasks.ts`; mr-robot, robots and grants docs speak of Tasks.

**Blocked by:** 03

**Status:** done

- [x] Tool group `tasks` with the eight tools; grant migration; deputy tools removed
- [x] Assignment rules in the tool host; refusal messages
- [x] Prompt section and product docs
- [x] Workerd tests with the scripted model: list visibility, create for owner, refusal to a non-accepting Member, focus and done through the tools; tool-surface contract test updated
