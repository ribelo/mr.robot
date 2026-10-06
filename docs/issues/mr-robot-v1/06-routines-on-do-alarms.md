# 06: Routines on Durable Object alarms

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-yrw7, robot-gbbt, robot-qyd5, robot-7j1a, robot-v1gb, robot-makt

**What to build:** The Member says run this every week and a Created routine card appears in the conversation; the robot panel lists routines with their next run and a delete action. The DSH schedule seam is implemented on the DO alarm: the robot creates, updates and deletes one-shot, interval, daily, weekly and cron routines in the Member's time zone; the DO sleeps between occurrences; one turn runs at a time with other wake-ups queued; occurrences missed during downtime run once.

**Blocked by:** 03 A Robot Durable Object runs one turn

**Status:** done

- [x] Routine created from chat sets the DO alarm to the next occurrence and shows a card
- [x] Firing the alarm in the DO test runs a turn with the routine prompt and re-arms
- [x] Two wake-ups arriving together produce two sequential turns, never interleaved events
- [x] Three missed occurrences after downtime produce one run
- [x] Deleting from the panel clears the alarm when no routine remains
