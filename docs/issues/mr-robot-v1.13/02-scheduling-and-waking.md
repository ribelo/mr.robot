# 02: Scheduling: the Home fires Tasks, the Robot keeps one moment

**Parent:** mr-robot-v1.13 (../mr-robot-v1.13.md) — stories mc-s1aa, mc-s2bb, mc-s3cc, mc-s4dd, mc-s5ee, mc-s6ff

**What to build:** A scheduled or recurring Task assigned to a Robot wakes it at its moment. The Home keeps the schedule; the Robot keeps only the moment of its earliest due Task (set by the Home on every change) and fires its alarm then, asks the Home for its due Tasks, and queues one Task Wake-up (kind `task`, payload `{ taskId, by: 'schedule' }`) per Task. The Home moves `next` of a recurring Task forward when an occurrence is handled (a Robot's attempt starts, a person marks done) and collapses missed occurrences into one (robot-v1gb). A Task assigned to nobody never fires. Limits: 50 scheduled or recurring Tasks per Robot, 5 minutes between occurrences, same messages as today. Human reminders: the Home alarm (`alarmBy`) sends a `reminder` push to the Member's devices at `at − remind.minutes`, once per occurrence; an unhandled recurring occurrence reminds once at `next` and shows overdue. Quiet hours apply.

**Blocked by:** 01

**Status:** done

- [x] Robot: `nextDueAt` replaces the routine alarm source; alarm asks the Home for due Tasks and queues Task Wake-ups
- [x] Home: due computation, advance on handled, missed-occurrence collapse, limits
- [x] Home alarm: reminder push once per occurrence; overdue recurring reminds once
- [x] WakeupKind `task` and Sender `task` in the protocol; old `routine` mapped on read
- [x] Workerd tests: fires once, advance rules, collapse, nobody fires nothing, limits, reminder through the stubbed push transport
