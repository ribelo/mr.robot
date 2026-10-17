# 07: Task actions, Task form, Interrupt, Conversation cards, panel Tasks

**Parent:** mr-robot-v1.13 (../mr-robot-v1.13.md) — stories mc-m0jj, mc-n1aa, mc-n2bb, mc-n3cc, mc-n6ff, mc-c1aa

**What to build:** Row actions in Mission Control: Interrupt on a working Robot; Done, Cancel, Pause / Resume (recurring only), Assign to… (Members of the Home and reachable Robots; refused while a Robot works on the Task), Run now (a Robot's Task not being worked on: queues a Task Wake-up with `by: 'member'`), Add child on a Task. A short form adds or edits a Task: title, instructions, assignee, parent, timing as a segmented choice none / at / every (date-time or schedule editor), deadline only for none and at, remind only for a person. Uses SaveButton, the segmented control and the select style of v1.12. The Conversation shows Task cards (created, updated, assigned, done, cancelled, paused, resumed, ran) with who did it. The Robot panel's Routines section and detail sheet become Tasks over TaskView; the Admin Routines table goes.

**Blocked by:** 06

**Status:** done

- [x] Row actions and their API calls; Run now route
- [x] Task form with the timing segments and the allowed fields
- [x] Task chat cards; panel Tasks section; Admin table removed
- [x] Component tests: actions call the API, form refusals and field visibility; workerd test for Run now
