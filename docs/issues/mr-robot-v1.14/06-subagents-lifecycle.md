# 06: Subagents: grant, tools, child sessions, lifecycle

**What to build:** A Robot with the subagents grant, which carries the list of provider and model pairs its Subagents may run on (empty by default: no delegation), calls subagent (fresh context) or subagent_fork (inherited context) with a task, a label, an optional listed model and a thinking effort (ao-zzga, ao-2z4n, ao-r3oq). A Subagent is a second DSH agent in the same Robot Durable Object with its own session log (parent and label recorded): the Robot's grants minus delegation, Robot messaging, Threads, shared-file edits, Asks and react; an Ask-level call fails with a clear error the Subagent reports (ao-8s1d, ao-sbc9, ao-3umf). It uses the Robot's Workspace, its browser in its own tab, its computer when granted (ao-ab01); secrets are masked in its log (ao-xl6g). The Robot's Turn may end while Subagents run; the DO stays awake; a Subagent's final report wakes the Robot as a follow-up (or is injected into a running Turn) (ao-w9lq). send_message and interrupt_agent work on the Robot's own children (ao-nc31). At most three run at once; the fourth call is refused with a message (ao-6jz6). Subagent usage lands on the Robot's rows with source subagent; a crossed spend limit stops Subagents first, then the Robot (ao-3pl8). A platform restart resumes running Subagents with the same note a Turn gets (ao-ij3i). Interrupting the Robot interrupts its Subagents; a Rewind to before a delegation archives them; deleting the Robot deletes them (ao-qy77). Subagents are never a Task doer, never in the Robot directory, never a registry row of their own; the Robot's registry row carries their count and a summary line each (ao-2fgp). The API exposes a Robot's Subagents and each child's session for the PWA.

**Blocked by:** 03, 05

**Status:** ready-for-agent

- [ ] Grant item tool:subagents with allowedModels payload; grant table gains a nullable JSON payload column; advanced settings and Mr. Robot's deputy settings edit the list (ao-zzga, ao-2z4n)
- [ ] Workerd test: an empty list refuses delegation; a listed model is accepted; an unlisted model is refused with a message (ao-2z4n, ao-r3oq)
- [ ] Workerd test: the child's tool list has no delegation tool and none of the excluded tools; an Ask-level item fails with the message and the report reaches the Robot (ao-8s1d, ao-sbc9, ao-3umf)
- [ ] Workerd test: the Robot's Turn ends while a child runs; the child's report arrives as a follow-up Wake-up and starts a Turn (ao-w9lq)
- [ ] Workerd test: send_message steers a child; interrupt_agent stops it (ao-nc31)
- [ ] Workerd test: the fourth concurrent child is refused (ao-6jz6)
- [ ] Workerd test: a restart with a running child resumes it with the note (ao-ij3i)
- [ ] Workerd test: Robot interrupt, rewind before the delegation, and delete cascade to children (ao-qy77)
- [ ] Workerd test: child usage on the Robot's rows with source subagent; the spend limit stops children before the Robot (ao-3pl8)
- [ ] Workerd test: a secret value never appears in the child's log (ao-xl6g)
- [ ] Workerd test: Task tools refuse a Subagent as assignee; the directory lists no Subagent (ao-2fgp)
- [ ] API: GET /api/robots/:id/subagents and the child session's events and trajectory pages
