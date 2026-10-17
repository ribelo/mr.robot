export const TASKS = `# Tasks

A Task is something to do: a title, instructions, who created it, who does it, when, and whether it is done. One list of work holds the Tasks of people and Robots. The Home keeps it.

## The doer

The doer (assignee) of a Task is one of these:
- a Member of the Home
- a Robot
- nobody: the Task waits on the list until somebody takes it. It never wakes anybody.

## Timing

A Task has one of three timings:
- unscheduled: the Task is on the list. It can have a deadline.
- scheduled: the Task starts at a moment. It can have a deadline, not before the moment.
- recurring: the Task occurs on a rule: every N minutes, daily, weekly or a cron expression, in a time zone. It has no deadline. Put preparation that must happen before an occurrence in a child Task with its own date.

The timing is the moment the doer is woken. A Robot gets a Wake-up with the Task's instructions. A person gets a reminder when the Task asks for one.

## State

A Task is open, done or cancelled. It is never "in progress" and never "failed".
- Working is a fact about a Turn. The fleet row of a Robot shows what woke it and the Task it works on.
- Failing is a fact about an attempt. Every Turn that works on a Task writes an attempt: started, finished, outcome (running, ok, failed, skipped, interrupted) and the first line of the reply. A Task keeps its last 20 attempts.
- Overdue is computed: a scheduled Task whose moment passed without an attempt, or a person's recurring Task whose occurrence passed without done.

A recurring Task can be paused. A resumed Task skips the occurrences it missed. Done on a recurring Task finishes one occurrence; the Task moves to the next. Cancel ends a recurring Task.

## Parent and children

A Task can have a parent Task. A trip or a birthday is a Task with children. There are no projects, tags or priorities.

## Tools

Every Robot with the tasks Grant has the same tools:
- task_list: the Tasks you may see.
- task_create: create a Task.
- task_update: change the title, instructions, parent, timing or reminder.
- task_assign: give a Task to another doer.
- task_focus: say that this Turn works on one of your Tasks.
- task_done: mark a Task done. This is the only way a Task becomes done.
- task_cancel: cancel a Task.
- task_pause: pause or resume a recurring Task.

The argument robot_id is optional. Only Mr. Robot can give it: then the tool works as that Robot, by its rules, and its Conversation shows that Mr. Robot did it. Other Robots get an error.

## What a Robot sees

A Robot sees what its owner sees: the owner's Tasks, its own Tasks, the Tasks of the owner's other Robots, and the unassigned Tasks that the owner or the owner's Robots made.

## Whom a Robot gives Tasks

A Robot gives a Task to its owner, to the owner's Robots and to itself. It gives a Task to another Member only when that Member turned on "Accept tasks from the Robots of…" for the owner, in Profile. Otherwise the tool refuses and names the setting.

## Working on a Task

- A scheduled or recurring Task wakes its Robot at its moment. The Turn is an attempt on the Task.
- When a message starts work on a Task ("do the shopping now"), call task_focus once in that Turn.
- When the work is finished, call task_done. A Turn that ends without it leaves the Task open.
- A person can interrupt a Turn from Mission Control. The attempt ends as interrupted, and the Conversation says who did it.
- A person can run a Robot's Task now from Mission Control.

## Limits

- At most 50 scheduled or recurring Tasks per Robot.
- At least 5 minutes between occurrences.
- If the platform was down, missed occurrences collapse into one.

## Time zone

Moments are kept in the time zone of the owner's profile unless a Task names its own zone. "Every day at 9" stays at 9 local time when the owner moves. The Robot gets a memory note about the change.

## Reminders for people

A Task for a person with a moment can carry "remind N minutes before". The Home sends the reminder by Web Push and the desktop app. No Robot wakes, so a reminder costs nothing. One reminder goes out per occurrence. Quiet hours apply.

## Write good instructions

A Task's instructions start a new Turn. The Turn has no other context than your files and the Conversation. Write them so that you understand them later:
- Say what to check and what to do.
- Say when to tell the owner and when to stay quiet.
- Name the files to read first.

## What people see

Mission Control shows the Fleet (who works on what, and why) and the Tasks table. A Task opens with its fields, children and attempts. The Conversation shows Task cards. The Robot panel lists the Robot's Tasks.

## Unattended Turns

A Task's Turn usually has nobody watching. A decision becomes an Ask; the Turn resumes when the owner answers.
`
