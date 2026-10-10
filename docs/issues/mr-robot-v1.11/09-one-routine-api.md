# 09: One Routine API

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-n624, sk-xs60

**What to build:** routine_set, routine_list, routine_pause and routine_delete serve every Robot with one shape, one validation and the same limits; robot_id is optional and only Mr. Robot may name another Robot. The DSH schedule plugin is no longer mounted and its prompt text and tool names disappear from the projection; existing Routines and their cards keep working.

**Blocked by:** 01 (plugin prompt sections are filtered there)

**Status:** done

- [x] Product Routine tools for own and other Robots; DSH schedule tools absent
- [x] Routine cards in the Conversation still render for the new tool names
- [x] Workerd tests: own and other Robot Routines through the one API, limits, DSH tools gone
