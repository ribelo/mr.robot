---
title: "Mr. Robot v1.13 — Mission Control and Tasks: one list of work for people and Robots, and a view of who works on what"
status: ready-for-agent
story-prefix: mc
parent: mr-robot-v1.12.md
---

# Mr. Robot v1.13 — Mission Control and Tasks

## Problem Statement

The owner uses Mr. Robot at home and tries to use it at work. Two things are missing (grill session 2026-10-17, written as a design tree; the decisions are in Further Notes).

1. **No view of the fleet.** A Member sees a list of Robots with a state word (sleeping, working, waiting for you) and one last line. He does not see *why* a Robot works: whether he wrote to it, a Routine fired, another Robot asked, or a webhook arrived. He does not see what the Robot works on. The Routines of all Robots are listed in one place only for the Home admin (Admin → Routines); a Member cannot see the Routines of his five Robots together. Nothing lets him stop a Turn. Back from a Robot does not return to where he came from.
2. **Work for people has no place.** A Routine is a schedule with a prompt, owned by a Robot. There is no task: nothing a person must do, nothing a Robot must do once without a schedule, nothing that exists before someone is chosen to do it. So a Robot cannot hand work to its owner except as an Ask (which blocks the Robot and needs a decision), a person cannot hand a listed task to a Robot, and colleagues who ask "can the robots remind me of things" get a Routine that wakes a Robot and spends tokens to send one line.

The platform already holds most of the parts. Every Turn records the Wake-up it serves (kind and sender) and the tool it runs; the Home registry already keeps one row per Robot with its fleet state and last line; Routines already keep their last 20 runs with running / ok / failed / skipped; an interrupted Turn already resumes after a platform restart; the Robot already has `running.stop()` for Rewind and pause; the hash router already carries a back counter per history entry.

## Solution

**One entity, Task.** A Task is something to do: a title, instructions, who created it, who does it, when, and whether it is done. The doer (assignee) is a Member, a Robot, or nobody. A Task can have a parent Task; a project is a Task with children, nothing more. A Routine becomes a *recurring Task assigned to a Robot*; the word Routine goes from the product, the tools, the prompt and the Glossary.

**Time as Todoist models it.** A Task has one of three timings: *unscheduled* (it sits on the list; an optional deadline), *scheduled* (a moment to start; an optional deadline not before it), or *recurring* (a rule and its next occurrence; no deadline, by construction). Preparation that must happen before a recurring occurrence is a child Task with its own date. The timing is the moment the doer is woken: a Robot gets a Wake-up, a person gets a notification when the Task asks for one.

**Working is a fact about the Turn; failing is a fact about the attempt.** A Task is open, done or cancelled. It is never "in progress" and never "failed". A Robot's Turn knows its cause (the Wake-up) and, when it has one, its subject (the Task): set from the Wake-up when a Task's schedule fired, or declared by the Robot with `task_focus` when the owner's message said "do the shopping now". Every Turn that serves a Task writes an attempt: started, finished, outcome, first line. Overdue is derived: a scheduled Task whose moment passed without an attempt. Nothing can say "working" while nobody works, and nothing has to be reset after a crash.

**Mission Control.** A page for a Member: two dense tables. *Fleet*: one row per Robot he can reach — state, what woke it (kind and sender), the Task it works on when it has one, the running tool, since when, the last line. *Tasks*: one row per Task he can see, grouped by assignee, parent or time, open ones first. One click opens the Robot or the Task; Back returns to Mission Control. A Member interrupts a Robot's Turn, marks a Task done, cancels, pauses a recurring one, assigns a doer, runs a Robot's Task now, adds a Task through a short form or a child under a parent. The Home admin has a switch *Whole Home* that widens both tables to every Robot and Task. Mr. Robot sits in a side drawer as a chat, so "add a task: call mum on Friday at six" is typed, not clicked. The tables render windows of rows, so a Home with ten thousand Robots reads the same as one with five.

**Flow between people and Robots.** A Member assigns a Task to any Member of the Home or any Robot he can reach. A Robot assigns to its owner and the owner's Robots; it assigns to another Member only when that Member has turned on *Accept tasks from the Robots of …* for the owner. A Robot finishes a Task only by saying so (`task_done`); a Turn that ends without it leaves the Task open, in view. Deleting a Robot or removing a Member leaves their Tasks unassigned, not deleted.

**Reminding people.** A Task for a person with a time may carry *remind: N minutes before*. The Home sends it through Web Push and the desktop app without waking any Robot. A person who prefers a Robot that reads his list each morning and says "tomorrow you call mum" makes such a Robot: the list is readable through the Task tools.

## User Stories

### Task model
1. As a Member, I want a Task with a title, instructions, creator, assignee (a Member, a Robot or nobody), optional parent, timing, state and attempts, so that every piece of work in the Home has one shape ^mc-t1aa
2. As a Member, I want a Task's timing to be exactly one of unscheduled (optional deadline), scheduled (a moment, optional deadline not before it) or recurring (rule, time zone, next occurrence), so that a recurring Task cannot carry a deadline and a deadline cannot precede a start ^mc-t2bb
3. As a Member, I want a Task's state to be open, done or cancelled only, and a pause to exist only on a recurring Task, so that no Task can claim to be in progress or failed ^mc-t3cc
4. As a Member, I want every attempt on a Task recorded (Robot, started, finished, outcome running / ok / failed / skipped / interrupted, first line), the last 20 kept, so that I see what happened without opening the Robot ^mc-t4dd
5. As a Member, I want a Task to have a parent Task and to see its children, so that a birthday or a trip is a Task with children, not a project of its own ^mc-t5ee
6. As a Member, I want a Task to carry an optional external reference (kind, key, link), so that a Connector can later link it to a Jira issue without a new field ^mc-t6ff
7. As an owner, I want my existing Routines to become recurring Tasks assigned to their Robot with their run history as attempts, with no change to when they fire, so that the update loses nothing ^mc-t7gg
8. As an owner, I want the Tasks of a deleted Robot and of a removed Member to become unassigned, not deleted, so that work survives its doer ^mc-t8hh

### Scheduling and waking
9. As an owner, I want a scheduled or recurring Task assigned to a Robot to wake it at its moment with the Task as the Wake-up, so that Tasks fire the way Routines did ^mc-s1aa
10. As an owner, I want a recurring Task's next occurrence to move to the following one when an occurrence is handled (a Robot's attempt starts, or a person marks it done), and missed occurrences while the platform was down to collapse into one, so that nothing fires twice ^mc-s2bb
11. As a Member, I want a scheduled Task assigned to me with "remind N minutes before" to reach me by Web Push and the desktop app without a Robot waking, so that a reminder costs nothing ^mc-s3cc
12. As a Member, I want an unhandled occurrence of my recurring Task to show as overdue and to remind me once, not every day, so that the list tells the truth without nagging ^mc-s4dd
13. As a Member, I want an unassigned Task never to wake anybody, so that a Task without a doer is quiet until someone takes it ^mc-s5ee
14. As an owner, I want the limits of today (50 scheduled or recurring Tasks per Robot, 5 minutes between occurrences) kept with the same messages, so that a Robot cannot flood itself ^mc-s6ff

### The Turn knows its cause and its subject
15. As a Member, I want each Robot's row in the fleet to show what woke it (my message, a Task, a Robot, a Channel, a Takeover) and from whom, so that I know why it works ^mc-w1aa
16. As a Member, I want the row to show the Task the Turn works on when the Wake-up was a Task, so that cause and subject sit side by side ^mc-w2bb
17. As an owner, I want my Robot to declare the Task it works on with task_focus when my message, not a schedule, started the work, at most once per Turn, so that "do the shopping now" is seen as work on the shopping Task ^mc-w3cc
18. As an owner, I want a Robot to finish a Task only by calling task_done, and a Turn that ends without it to leave the Task open with its attempt recorded, so that an open Task after a finished Turn is my signal ^mc-w4dd
19. As a Member, I want to interrupt a Robot's Turn from Mission Control, the attempt to end as interrupted and the Conversation to show who interrupted, so that I can stop runaway work ^mc-w5ee
20. As a Member, I want a Robot's row to show the running tool and since when it works, so that a Robot stuck for an hour stands out ^mc-w6ff

### Task tools for Robots
21. As an owner, I want the routines tool group replaced by tasks with task_list, task_create, task_update, task_assign, task_focus, task_done, task_cancel and task_pause, so that a Robot handles Tasks the way it handled Routines ^mc-r1aa
22. As an owner, I want task_list to return my Tasks, the Robot's Tasks, unassigned Tasks I or my Robots created, and the Tasks of my other Robots, so that a reminder Robot can read my list ^mc-r2bb
23. As an owner, I want a Robot to create and assign Tasks to me and to my Robots, and to another Member only when that Member accepts Tasks from my Robots, so that nobody's list fills with other people's Robots ^mc-r3cc
24. As Mr. Robot, I want the deputy routine tools folded into the task tools with an optional robot_id, so that I schedule work for my staff with one vocabulary ^mc-r4dd
25. As an owner, I want the platform prompt and the product docs to speak of Tasks and recurring Tasks, never Routines, so that the Robot and I use the same words ^mc-r5ee

### Mission Control
26. As a Member, I want a Mission Control page with a Fleet table and a Tasks table for the Robots I can reach and the Tasks I can see, so that I see all my work on one screen ^mc-m1aa
27. As a Member, I want both tables dense: one line per row, fixed columns, no cards, no empty space, so that a hundred rows fit on a laptop screen ^mc-m2bb
28. As a Member, I want both tables to render only the visible rows and to page from the server, so that ten thousand Robots read like five ^mc-m3cc
29. As a Member, I want the Fleet sorted working first, then waiting for you, then the rest by last activity, so that the first axis of the screen is who works ^mc-m4dd
30. As a Member, I want the Tasks table grouped by assignee, by parent or by time, open Tasks first and overdue marked, and the grouping remembered, so that I read the list the way I think that day ^mc-m5ee
31. As a Member, I want a filter by state (open by default, done, cancelled, all) and a search by title in the Tasks table, and a search by name in the Fleet, so that I find one row among thousands ^mc-m6ff
32. As the Home admin, I want a Whole Home switch that widens both tables to every Robot and Task, off by default and remembered, so that I am a Member until I choose to be an admin ^mc-m7gg
33. As a Member, I want one click on a Fleet row to open the Robot, and Back to return to Mission Control, so that the round trip is two clicks ^mc-m8hh
34. As a Member, I want one click on a Task row to open its detail (fields, children, attempts) in place, so that I do not leave the screen ^mc-m9ii
35. As a Member, I want Interrupt on a working Robot's row, so that stopping is one click ^mc-m0jj
36. As a Member, I want Done, Cancel, Pause / Resume (recurring), Assign to…, Run now (a Robot's Task that is not being worked on) and Add child on a Task row, so that I act without a form ^mc-n1aa
37. As a Member, I want Assign to… to offer the Members of the Home and the Robots I can reach, and to refuse while a Robot works on the Task, so that I cannot move running work ^mc-n2bb
38. As a Member, I want a short form to add a Task: title, instructions, assignee, parent, timing as a segmented choice (none / at / every) with a date-time or a schedule, deadline when allowed, remind for a person, so that I click a Task in under a minute ^mc-n3cc
39. As a Member, I want Mr. Robot in a side drawer of Mission Control as a chat, so that I type a Task in words and he creates it ^mc-n4dd
40. As a Member, I want Mission Control reachable from the sidebar and from the home page, so that it is one click away ^mc-n5ee
41. As a Member, I want the Robot panel's Routines section to become Tasks (the same list, the same detail with attempts), and Admin's Routines table to go, so that the same data is not shown in three shapes ^mc-n6ff

### Accepting Tasks from other people's Robots
42. As a Member, I want a setting Accept tasks from the Robots of… with the other Members of the Home, off for everyone by default, so that I hold the valve on my own list ^mc-a1aa
43. As an owner, I want my Robot's attempt to assign a Task to a Member who has not accepted my Robots to fail with a message naming the setting, so that the Robot tells me instead of guessing ^mc-a2bb

### Conversation
44. As a Member, I want the Conversation to show Task cards (created, updated, assigned, done, cancelled, paused, resumed, ran) with who did it, so that Task changes read like Routine changes did ^mc-c1aa
45. As a Member, I want old Routine cards in existing Conversations to keep rendering, so that history does not break ^mc-c2bb

### Glossary and docs
46. As the owner, I want GLOSSARY.md to define Task, Attempt, Mission Control and the three timings, to drop Routine and to redefine Wake-up with Task in place of Routine, so that the vocabulary has one word per thing ^mc-g1aa
47. As an owner, I want the product docs (tasks, mr-robot, robots, grants) rewritten for Tasks, so that a Robot answers questions about them correctly ^mc-g2bb

## Implementation Decisions

- **Protocol types** in `packages/protocol`:
  - `TaskAssignee = { kind: 'nobody' } | { kind: 'member'; memberId } | { kind: 'robot'; robotId }`.
  - `TaskTiming = { kind: 'unscheduled'; deadline: number | null } | { kind: 'scheduled'; at: number; deadline: number | null } | { kind: 'recurring'; schedule: RecurringSchedule; timeZone: string; next: number; paused: boolean }`, where `RecurringSchedule` is today's `RoutineSchedule` without `once` (interval, daily, weekly, cron). `once` maps to `scheduled`. A check refuses `deadline < at`.
  - `TaskState = 'open' | 'done' | 'cancelled'`. `Remind = { kind: 'none' } | { kind: 'before'; minutes: number }`.
  - `AttemptOutcome = 'running' | 'ok' | 'failed' | 'skipped' | 'interrupted'`; `Attempt = { robotId, startedAt, finishedAt: number | null, outcome, firstLine }`.
  - `TaskView = { id, title, instructions, createdBy: Actor, assignee, parentId: string | null, timing, remind, state, external: { kind, key, url } | null, createdAt, updatedAt, attempts: Attempt[], children: number, overdue: boolean }`, where `Actor = Sender` without `channel`. `overdue` is computed on read: scheduled and `at < now` with no attempt since `at`, or recurring and `next < now` for a person.
  - `WakeupKind` gains `task` and loses `routine`; the Task Wake-up payload is `{ taskId, by: 'schedule' | 'member' | 'robot' }`. `Sender` gains `{ kind: 'task'; taskId; name }` and loses `routine`. Stored items with the old kinds are mapped on read; no log rewrite.
  - `RobotSummary` gains `turn: { wakeup: { kind: WakeupKind; from: string }; task: { id; title } | null; activity: string | null; since: number } | null` and `lastWakeup` of the same shape without `activity` and `since`.
- **Store**: Tasks live in the Home Durable Object (`task`, `task_attempt` tables; indexes on assignee, parent, next moment, state). The Home is already the registry every Robot reports to; a Task with no Robot has nowhere else to live. The Robot keeps **one number**: the moment of its earliest due Task, set by the Home whenever that changes; its alarm fires then, asks the Home for its due Tasks, and the Home moves `next` forward and collapses missed occurrences before answering (robot-v1gb stays). The Robot's `routine` and `routine_run` tables go after migration. Human reminders and overdue reminders run on the Home's existing `alarmBy`.
- **Migration**: on first load after the version, the Home walks its registry and calls `exportRoutines()` on each Robot in batches; each Routine becomes a recurring (or scheduled, for `once`) Task with `createdBy` the Robot, its runs become attempts, and the Robot drops its tables. A Robot that is unreachable is retried on the next load; the Admin page shows "n Robots still to migrate" until none is left.
- **Turn**: the `turn` row gains `task_id`. It is set at `beginTurn` from a Task Wake-up or by `task_focus` (refused when already set in this Turn, and refused for a Task the Robot is not assigned to). Starting a Turn with a Task inserts an attempt `running`; `endTurn` finishes it `ok` or `failed` as `finishRoutineRun` does today; `interrupt()` finishes it `interrupted`. A Turn without a Task writes no attempt. The Home registry row is updated on begin, on each activity change (already reported) and on end.
- **Interrupt**: `POST /api/robots/:id/interrupt` (owner or a Member the Robot is shared with) → `robot.interrupt(by)`: `running.stop()`, the Wake-up is consumed (no retry), a notice "Interrupted by <name>" goes to the Conversation, the registry row changes to sleeping.
- **Permissions**: a Member sees a Task when he created it, is its assignee, its assignee is a Robot he can reach, or it is unassigned and created by him or one of his Robots. Whole Home (admin) sees all. A Member assigns to active Members and reachable Robots. A Robot assigns to its owner, the owner's Robots, itself, and to a Member whose `acceptTasksFrom` (a list of Member ids in the Member profile) names the Robot's owner.
- **Tools**: the `routines` group becomes `tasks` (same Grant; existing grants migrate by name). `task_list({ assignee?, state?, robot_id? })`, `task_create({ title, instructions, assignee, parent_id?, timing, remind?, robot_id? })`, `task_update`, `task_assign`, `task_focus({ task_id })`, `task_done({ task_id, first_line? })`, `task_cancel`, `task_pause({ task_id, paused })`. `robot_id` is Mr. Robot's deputy switch, as `routine_*` had; the deputy's `robot_routines`, `robot_routine_set`, `robot_routine_pause`, `robot_routine_delete` go. The platform prompt's routine section becomes a task section with the same advice (write the prompt for a cold Turn, name the files, keep quiet hours).
- **API**: `GET /api/mission?scope=mine|home&fleetPage&taskPage&group&state&q` returns `MissionView = { fleet: RobotSummary[], fleetNext, tasks: TaskView[], tasksNext, counts }`; `GET/POST/PATCH /api/tasks[/:id]`, `POST /api/tasks/:id/{done,cancel,pause,assign,run}`. Pages of 200 rows.
- **PWA**: route `#/mission`; the `dsh` back counter (sk-e2kn) is used as is, with Mission Control as the fallback for a Robot opened from it. A `WindowedTable` component (fixed row height, renders the visible window plus a margin; no dependency) carries both tables; grouping is a client-side fold over the loaded pages, with group headers. Task detail opens as a right sheet (the existing sheet pattern in RobotSheets). The side drawer embeds the Member's Mr. Robot `ChatView` in compact Work details. The form uses the existing `SaveButton`, segmented control and select style from v1.12. Grouping, state filter and Whole Home are kept in the Member's list preferences.
- **Human reminders**: the Home alarm sends `PushNotification { kind: 'reminder', title, body }` to the Member's devices (existing push path in `member.ts`); the desktop app shows it natively as today. Quiet hours apply as for Robot notifications. One reminder per occurrence; an overdue recurring occurrence reminds once at `next`.
- **Robot panel**: the Routines section and the Routine detail sheet become the Tasks section and Task detail over `TaskView`; the Admin Routines table is removed (Whole Home in Mission Control replaces it).
- **Glossary**: Task, Attempt, Mission Control, Timing (unscheduled / scheduled / recurring) added; Routine removed; Wake-up, Mr. Robot, Robot and Trajectory entries updated.

## Testing Decisions

A good test drives the system the way the person or the Robot does: through the edge API in workerd with the scripted model, or through the rendered PWA component with a stubbed API. No test touches the network.

- Workerd through the API (prior art: v1.6 routine limits and history tests, v1.8 deputy tests): Task create / update / assign / done / cancel / pause round trip and the refusals (deadline before start, deadline on recurring, pause on non-recurring, assign while a Robot works on it) (mc-t1aa, mc-t2bb, mc-t3cc, mc-n2bb); a scheduled Task wakes its Robot with a Task Wake-up and writes an attempt that ends ok or failed (mc-s1aa, mc-t4dd, mc-w4dd); recurring advance on attempt start and on done, missed-occurrence collapse (mc-s2bb); an unassigned Task fires nothing (mc-s5ee); limits (mc-s6ff); task_focus once per Turn and the registry row with cause and subject (mc-w1aa, mc-w2bb, mc-w3cc); interrupt ends the attempt interrupted and writes the notice (mc-w5ee); visibility rules and Whole Home (mc-m7gg, mc-r2bb); Robot-to-other-Member assignment refused until accepted (mc-r3cc, mc-a1aa, mc-a2bb); Routine migration from a Robot with runs (mc-t7gg); orphaning on Robot delete and Member removal (mc-t8hh); reminder push through the stubbed push transport, once per occurrence (mc-s3cc, mc-s4dd); mission view paging and ordering (mc-m3cc, mc-m4dd); old routine chat items still decode (mc-c2bb).
- Component tests (prior art: v1.12 component tests): WindowedTable renders only the window (mc-m3cc); Fleet row shows cause, subject, tool, since (mc-w1aa, mc-w6ff); grouping and filters (mc-m5ee, mc-m6ff); row actions call the API (mc-n1aa); the form refuses a deadline on every and hides remind for a Robot (mc-n3cc); Whole Home switch visible only to the admin (mc-m7gg); Back from a Robot opened from Mission Control returns there (mc-m8hh); panel Tasks section (mc-n6ff).
- Manual: the side drawer chat creating a Task from words (mc-n4dd); density on a laptop screen with 100 rows (mc-m2bb).

## Out of Scope

Tags and labels; priorities; projects as an entity; Kanban; an in-progress or failed Task state; a stored claim on a Task by a person; a natural-language date parser in the PWA; reminders through Discord, Slack or e-mail; a Jira or Todoist Connector (the `external` field waits for it); assigning Tasks to Members outside the Home; pausing another Member's Robot from Mission Control; dependencies between Tasks beyond parent and child; durations.

## Further Notes

Decisions from the grill session 2026-10-17, with the alternatives the owner asked to see.

- **One entity, not three.** Routine, task and reminder were one thing with three words. The owner confirmed.
- **Time as Todoist models it, not improved.** Todoist has one `due` ("when I work on it", possibly recurring) and a separate one-time `deadline`; its help says a recurring task has no deadline and preparation goes in a sub-task with an earlier date. The owner chose this model as is.
- **Where "working on X" lives.** Four options were weighed. (A) A stored `in_progress` state on the Task (Jira, Linear): simple and works for people, but drifts — a dead Robot or a crash leaves "in progress" forever, and the cure is a heartbeat and a sweeper. (B) Cause and subject on the Turn, outcome on the attempt, the Task knows only open / done / cancelled: cannot drift, already how Routine runs work, and failures outside a Turn are caught by the absence of an attempt (overdue), not by predicting each failure kind; its cost is that a Robot woken by a message must declare its subject or the row says "working, no task", which is honest. (C) Infer the subject from the Conversation: unreliable and slow at scale. (D) B plus a leased claim with a TTL: the complexity of A for a benefit (people claiming) judged unnecessary. The owner chose B.
- **No stored "in progress" for people**, with "wystarczy… chyba": a variant can join the state sum later without a migration.
- **The receiver holds the valve** on Robot-to-other-Member assignment, because the harm (a filling list) is the receiver's.
- **Tables, not Kanban**; first axis: who works. **Form plus Mr. Robot** for entry, no date parser in the app.
- **Jira is a reference, not a home**: a Task delegated to a colleague lives in Mr. Robot; a Connector may later link it. The colleague must be a Member.
- Store placement (Home, with one next-due moment per Robot) and the `interrupted` outcome are the agent's decisions, reported here for the owner to reverse.
