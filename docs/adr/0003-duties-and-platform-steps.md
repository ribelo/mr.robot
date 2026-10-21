# 0003: Duties on the alarm, and one helper for platform steps

Status: accepted
Date: 2026-10-21
Ticket: docs/issues/mr-robot-v1.20/00-duty-seam-and-plugins.md

## Decision

What a Robot does between Turns is a **duty** (apps/worker/src/robot/duties.ts). The module that owns the behaviour defines the duty; the Robot Durable Object registers it once, in its constructor, in the order the alarm runs it.

A duty has:
- `name`: for logs; two duties with one name are refused.
- `order`: lower runs first.
- `scope`: `any` (also a deleted Robot: the outbox), `alive` (not deleted), or `active`.
- `nextAt(now)`: when it is next due, read from the Robot's store on every re-arm; undefined when nothing is planned.
- `run(now)`: does the work when it is due. The duty decides whether it is due, because an alarm can come early or late. A failure is logged and the next duty runs.

The alarm (robot.ts, runAlarm) does the core's own work first: due Tasks, parked Tasks, draining the queue, resuming Subagents. Then it runs every duty in scope in order, drains again, and re-arms. The next alarm (programs.ts, rearm) is the earliest of the core's moments (the next Task, a parked Task's check or deadline, the heartbeat while work runs) and the duties' earliest nextAt.

The duties of v1.20 ticket 00, in order: quiet steer 10 (plugins/say.ts), sign-in expiry 20, screen watch 30, screenshot sweep 40, outbox 50, chain resume 55 (plugins/housekeeping.ts), Box idle stop 60 (plugins/places.ts), idle warming and compaction 90 (plugins/idle.ts).

A **platform step** (apps/worker/src/agent/platform-step.ts, platformStep) is one bounded instruction the platform gives the Robot's own agent outside a person's Wake-up: the safety net, the memory sweep, and from v1.20 the snapshot and the dream. One function runs every step. A step has:
- `label`: what errors and the Trajectory call it.
- `instruction`: the message the agent reads.
- `steps`: the model steps at most; the agent is cancelled, inbox kept, at the limit.
- `tools` (optional): the only tools that run while it runs. A DSH tool guard (ctx.tools.guard, agent/compose.ts) denies every other call before the tool body, for every tool, so the allow-list holds for tools outside the ask gate too. Tool definitions are not wrapped for it: some DSH tools are read by identity or through live getters.
- `author` (optional): who the Workspace writes are by in the file history; back to the Robot after the step.
- `usage` (optional): the usage source its tokens are booked under; when absent the Turn it runs in books them.
- `record` (optional): a Trajectory record written after the step.

The same runtime is the one place for the external fence: a tool is marked external where it is defined (define.ts, web.ts), and the runtime fences its text as it registers, before the ask gate wraps it.

## Why

The alarm handler was a fixed list of twelve calls; each mechanism added a line there and a few hundred lines to the Robot class. v1.20 adds three more mechanisms (the snapshot, the dream, the dream-hour close). With the seam each is a small module on two shared pieces, and the core keeps only the Robot's loop.

## Not moved

The bodies of the screen watch (browser state of the Robot class), outbox delivery (a state program) and sign-in capture (Takeover) stay where their state lives; their duties call them. Auto review is a plugin module (plugins/auto-review.ts) that gives the ask gate its review hook.