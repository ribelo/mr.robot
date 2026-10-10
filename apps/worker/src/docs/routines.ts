export const ROUTINES = `# Routines

A Routine is a schedule with a prompt. The Robot owns it and edits it. When the schedule fires, the Robot wakes and runs a Turn with the prompt. A Durable Object alarm drives it. The Robot sleeps between occurrences, so an idle Robot costs nothing.

## Schedule types

- one-shot: runs once at a given time.
- interval: runs every N minutes, hours or days.
- daily: runs every day at a given time.
- weekly: runs on given weekdays at a given time.
- cron: runs on a cron expression.

## Tools

Every Robot with the routines Grant has the same four tools:
- routine_set: create or update a Routine.
- routine_list: list Routines with their next run.
- routine_pause: pause or resume a Routine.
- routine_delete: delete a Routine.

The argument robot_id is optional. Without it, the tool works on your own Routines. Only Mr. Robot can name another Robot. Other Robots get an error.

## Limits

- At most 50 Routines per Robot.
- At least 5 minutes between occurrences.
- The platform checks every schedule before it stores it.

## Time zone

The platform stores times in the time zone of the owner's profile. The app sends the zone when it opens. "Every day at 9" stays at 9 local time, also after the owner travels. When the zone changes, the platform recomputes the next runs. The Robot gets a memory note about the change.

## Missed occurrences

If the platform was down, a missed Routine runs once. It does not run once per missed slot.

## Write a good prompt

A Routine prompt starts a new Turn. The Turn has no other context than your files and the Conversation. Write the prompt so that you understand it later:
- Say what to check and what to do.
- Say when to tell the owner and when to stay quiet.
- Name the files to read first.

## What the owner sees

The Conversation shows a Created routine card when a Routine is made. The Robot panel lists the Routines with their next run. The owner opens a Routine to see its schedule in words and in cron, its status, its full prompt and its recent runs. The owner can pause, resume and delete a Routine.

## Unattended Turns

A Routine Turn usually has nobody watching. If it needs a decision, it creates an Ask. For an ask-level tool call, the Turn ends as waiting. It resumes when the owner answers. Before you notify the owner, read PROACTIVE_PREFERENCES.md and keep to the quiet hours.
`
