# 21: Robot list menu, Edit profile sheet, routine detail

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-mktj, robot-lulc, robot-l3gr, robot-qhll, robot-n7th, robot-g6y0

**What to build:** Each robot in the list has a context menu (Pin, Mark as unread, Edit profile, Hide from sidebar). Edit profile is a sheet with avatar, name, title, description, the wake-on-notification toggle and the routines list. Tapping a routine opens its detail: schedule in words and as cron with time zone, status, next run, full instructions, recent runs, Pause/Resume and Delete. A robot's list entry shows its last line and time, never a raw error; a failed turn becomes a state (blocked, needs you) with the reason shown inside the conversation. Every screen is reachable from the simple views. Reference: docs/reference/08–10.

**Blocked by:** 06 Routines on Durable Object alarms; 11 Web Push and notification settings

**Status:** done

- [x] Menu actions work and persist per Member (pin, unread, hidden)
- [x] Edit profile saves and the list updates without reload
- [x] Routine detail shows instructions, next run and the last runs with their outcome
- [x] Pause stops the alarm for that routine only; resume re-arms; delete removes it
- [x] A turn failure renders as a state with reason in the conversation and a plain last line in the list

Verified 2026-10-07 on the live deployment: row menu (Pin, Mark as unread, Edit profile, Hide from sidebar), Edit profile sheet with routines, routine detail with cron line, Pause and two-step Delete, all by clicking. Tests: list-and-routines.test.ts, code-mode-chat.test.ts, apps/web panel.test.tsx.

Not built: reference 09's "Wake on screen notifications". A Robot's browser exists only during a Turn (it is closed and its state saved when the Turn ends), so no page can raise a notification between Turns. The sheet carries the per-Robot Notifications switch instead. "Move to new section" and "Replace with different bot" from reference 10 are not in the stories.

Verified live 2026-10-07: the wake-on-notification loop end to end (91).
