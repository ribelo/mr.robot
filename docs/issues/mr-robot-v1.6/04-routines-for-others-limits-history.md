# 04: Routines for other Robots, limits and run history

**Parent:** mr-robot-v1.6 (../mr-robot-v1.6.md) — stories cd-n9pi, cd-0rqn, cd-3t0p, cd-d14a

**What to build:** Mr. Robot creates, edits, pauses, resumes and deletes Routines of another Robot; the Routine shows in that Robot's Conversation as 'Routine created by Mr. Robot'. Every Robot keeps the last 20 runs per Routine (started, finished, outcome, first line of the reply) visible in the panel's routine detail and in robot_routines. A 51st Routine and an interval under 5 minutes are refused with a message naming the limit.

**Blocked by:** 02 Deputy reads

**Status:** ready-for-agent

- [ ] robot_routine_set (create or edit), robot_routine_pause, robot_routine_delete work on a reachable Robot and the card names Mr. Robot
- [ ] Run records (max 20) appear in the routine detail sheet and in robot_routines after alarm runs in a workerd test
- [ ] Limits refused for the Robot's own schedule tools and the deputy tools alike, with messages naming 50 and 5 minutes
