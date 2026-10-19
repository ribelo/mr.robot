---
title: "Mr. Robot v1.14 — Always-on lessons: steering, Subagents, Auto review, idle compaction, oversized results, a computer, cost by source"
status: ready-for-agent
story-prefix: ao
parent: mr-robot-v1.13.md
---

# Mr. Robot v1.14 — Always-on lessons

## Problem Statement

The owner compared Mr. Robot with Lee Robinson's description of Grok Bot's harness (Stanford CS146S, "How always-on agents work", 2026; transcript in docs/research/lee-robinson-always-on-agents-transcript.txt) in a grill session on 2026-10-19. Most of the architecture matches: the agent loop lives in a Durable Object and the browser behind a seam, a Wake-up queue in SQLite survives restarts, untrusted content is labelled, memory is files with a static prompt prefix, Tasks replace routines. Seven things do not, and each costs him today or will soon:

1. **A FIFO queue.** Every Wake-up (the owner's message, a Task, a webhook, a Robot message) becomes its own Turn, in order of arrival. When a Robot works on a Task and the owner writes "stop, do this first", the message waits until the Task Turn ends. DSH already has three inbox verbs (steer, follow-up, inject); Mr. Robot uses only follow-up.
2. **Lost tool output.** A tool result over the limit is cut and the rest is gone; the Robot cannot recover it. DSH ships a spill service that keeps the whole result retrievable, but its only backend is the host filesystem.
3. **No Subagents.** A Robot that reads forty pages fills its own context and compacts sooner; it cannot hand expensive work to a fresh context. The owner excluded sub-robots in v1 and now wants them, in the DSH shape, with explicit limits.
4. **No Auto review.** Grants are allow / ask / deny per item. Between rubber-stamping Asks and granting everything there is nothing. DSH has an experimental Auto review plugin (a model reviews each call before it runs); it uses the same model as the agent and lives in the Web profile.
5. **Compaction only under pressure.** A Robot compacts in the middle of a Turn when its budget is hit, never while idle on a warm cache. Mr. Robot, which the owner talks to all day, has no cache warming either; the owner's desktop profile has both measured and tuned.
6. **No computer.** A Robot cannot run a program. The owner can imagine a Robot that needs Python with NumPy and Pandas; nothing in Workers can do that.
7. **Cost without sources.** A Robot's cost is one number; the owner cannot see whether the model, the browser or (soon) the computer costs the money.

One more came from the session: Mr. Robot already records what a Robot works on only from the Task Wake-up or from the Robot's own `task_focus`, once per Turn. With steering, the owner can redirect a Robot mid-Turn, and the Robot has no way to say so.

Also the DSH packages Mr. Robot builds on are at 0.2.0-rc.2; the spill, Subagent and Auto review packages this spec needs are in 0.2.1-rc.2.

## Solution

**Steer and follow-up.** A Wake-up carries a delivery: *steer* reaches a running Turn at its next step; *follow-up* waits for its own Turn. Who steers is a fact about the sender, not a choice the Robot makes: the owner (through the app, Discord or any Channel the owner is identified on) steers; Mr. Robot steers the Robots it directs; everything else — Tasks, webhooks, other Robots, Threads, platform notices — follows up. Ctrl+Enter in the composer sends a follow-up on purpose. Queued follow-ups from the same sender collapse into one Turn; a Task never shares a Turn. A steer appears in the Conversation at the point where the Robot consumed it; nothing tries to say which reply answers what. The Robot may change or drop its Task focus with `task_focus`, giving a reason, when the owner redirects it; the dropped Task's Attempt ends as skipped with that reason.

**Oversized results go to the Workspace.** The DSH spill policy is mounted with a Workspace backend: a result over the inline budget reaches the model as head and tail plus the path of the complete result under `spill/` in the Robot's Workspace, readable with the file tools it has. Nothing is lost; spill files are tidied after 30 days.

**Subagents, in the DSH shape, depth one.** A Robot with the `subagents` grant may call `subagent` (fresh context) or `subagent_fork` (inherits its context) with a task, a model from the list the owner allowed, and a thinking effort. A Subagent is a second DSH agent inside the same Robot Durable Object with its own session log: the Robot's grants minus delegation, Robot messaging, Threads, shared-file edits and Asks; the Robot's Workspace, its browser (own tab, same logins) and, when granted, its computer. The Robot's Turn may end while Subagents run; a Subagent's report is a platform Wake-up (follow-up) that starts a new Turn. The Robot can message or interrupt its Subagents; the owner sees them in a "N Subagents" dropdown in the Robot header, each with its own Chat and Trajectory, and may Interrupt one there. Subagents are not Robots: never a Task's doer, never a Fleet row, never in the Robot directory; they show as an expandable line under their Robot in Mission Control. Their tokens count to the Robot and the owner. At most three run at once per Robot.

**Auto review as a Robot setting.** A plugin modelled on DSH's experimental Auto review: before each call of an item at level allow, a reviewer model classifies the call (low / medium / high) and allows or denies it; a denied call becomes an Ask to the owner with the reviewer's reason, so the model never finally blocks the owner. The reviewer's provider, model and effort are a Robot setting; the Home sets a default; off by default. Items at ask keep asking; Subagents are reviewed with the Robot's setting.

**Cache warming and idle compaction, each a plugin, each a Robot setting.** Nothing changes inside a Turn. When a Turn ends and nothing is queued, a timer starts. A Robot with *cache warming* on refreshes the provider cache at the measured idle moments (54, 108, 162 minutes on a one-hour cache), so the owner's next message is cheap; Mr. Robot has it on by default. A Robot with *idle compaction* on compacts once, shortly before the cache would expire (54 minutes), on the warm prefix, so the next Wake-up starts from a cheap summary; other Robots have it on by default. Right before an idle compaction the Robot gets one bounded step: "compaction is coming, write what matters to memory now". A Wake-up during the wait cancels the timer. A context below a small floor is left alone.

**A computer, minimal.** A grant `computer` gives a Robot a Cloudflare Sandbox container (the python image: Python 3.11, NumPy, Pandas, matplotlib, Node, Bun, git) with tools to run commands and move files. The container disk is scratch; the Workspace is the durable disk: the Workspace's `computer/` folder is copied in at boot and copied back when the Turn ends or the computer stops; `computer/setup.sh` in it runs at boot. The computer stops ten minutes after the last command and boots again on the next. Images are deploy artefacts; one image, chosen in the repository, no catalogue.

**Cost by source.** Usage is kept per source — model, browser, computer, services — per Robot and per Member, and shown as a breakdown with the total. Computer minutes are priced at Cloudflare's container rates and count toward the spend limit.

## User Stories

### DSH upgrade
1. As an operator, I want the Worker built on DSH 0.2.1-rc.2 with every mounted package updated and the existing tests green, so that the spill, Subagent and Auto review packages are available ^ao-ejub
2. As an operator, I want the dependency lint kept (no Node-bound DSH package, no Effect inside DSH packages in the Worker bundle), so that the upgrade does not pull the host filesystem into Workers ^ao-ggzv
3. As an owner, I want existing Conversations to render and continue after the upgrade, so that history survives the version ^ao-wzw9

### Steer and follow-up
4. As an owner, I want my message to reach a working Robot at its next step instead of waiting for its Turn to end, so that "stop, do this first" is heard now ^ao-9570
5. As an owner, I want my message to a sleeping Robot to start a Turn as today, so that steering and waking are one gesture ^ao-ti08
6. As an owner, I want Ctrl+Enter to send a follow-up that waits for its own Turn, so that I can queue work without interrupting ^ao-q2z4
7. As an owner, I want my messages through Discord or any Channel that identifies me treated like app messages, so that the owner is the owner on every Channel ^ao-rsfo
8. As Mr. Robot, I want my messages to the Robots I direct to steer them, so that redirecting staff works the way the owner's redirecting me works ^ao-8848
9. As an owner, I want Tasks, webhooks, other Robots' messages, Threads and platform notices to arrive as follow-ups, each in its own Turn after the current one, so that outside input never cuts into running work ^ao-m648
10. As an owner, I want several queued follow-ups from the same sender to collapse into one Turn, and a Task Wake-up never to share a Turn, so that a burst of messages costs one Turn and every Attempt stays one Turn ^ao-rdhs
11. As an owner, I want a steer shown in the Conversation and the Trajectory at the point where the Robot consumed it, with no label about which reply answers it, so that the log tells what happened and claims nothing more ^ao-lfxt
12. As a Robot, I want the platform prompt to tell me that a steer may change what I am doing and that I say so in my own words, so that the owner is never guessing ^ao-03p5
13. As an owner, I want a steer that arrives while a Takeover is pending or a Subagent report is awaited to be delivered when the Turn resumes, so that nothing is lost in a wait ^ao-zk5r

### Changing focus
14. As a Robot, I want task_focus to take the Task to focus on, or none, and a reason, callable more than once per Turn, so that I can follow the owner's redirection and say why ^ao-lj6z
15. As an owner, I want a Task dropped mid-Turn to end its Attempt as skipped with the Robot's reason, and Mission Control to show the new focus at once, so that the fleet never shows stale work ^ao-cvpx
16. As an owner, I want a later Wake-up of the dropped Task to start a fresh Attempt as today, so that a redirection costs the Task nothing ^ao-n2fo

### Oversized tool results
17. As a Robot, I want a tool result over the inline budget to reach me as head and tail plus the path of the complete result in my Workspace, so that nothing a tool returned is lost ^ao-hf02
18. As a Robot, I want to read a spilled result with my file tools (read with a line range, grep), so that I recover exactly the part I need ^ao-5lzl
19. As an owner, I want spill files kept under spill/ in the Workspace, listed last in the Files view and tidied after 30 days, so that they do not crowd the Robot's files ^ao-ry61
20. As an owner, I want the inline budget to follow the Robot's context budget, so that a small Robot spills sooner than a large one ^ao-antj

### Subagents
21. As an owner, I want a grant item subagents, off until granted, so that a Robot delegates only when I allowed it ^ao-zzga
22. As an owner, I want the subagents grant to carry the list of provider and model pairs a Robot's Subagents may run on, empty by default, so that nothing is implicit; an empty list means the Robot cannot delegate ^ao-2z4n
23. As a Robot, I want subagent and subagent_fork tools that take a task, a label, an optional model from my allowed list and a thinking effort, so that I hand expensive work to a fresh or an inherited context ^ao-r3oq
24. As an owner, I want a Subagent to have no delegation tool, so that depth stays one ^ao-8s1d
25. As an owner, I want a Subagent to hold the Robot's grants minus delegation, Robot messaging, Threads, shared-file edits and Asks, so that it can do no more than its Robot and cannot put questions to me ^ao-sbc9
26. As a Robot, I want a Subagent's call that would need an Ask to fail with a clear error that the Subagent reports to me, so that I ask the owner myself ^ao-3umf
27. As a Robot, I want a Subagent to use my Workspace, my browser in its own tab with my logins, and my computer when I have one, so that it works where I work ^ao-ab01
28. As a Robot, I want my Turn to be able to end while Subagents run, and each Subagent's final report to wake me as a follow-up, so that I sleep while they work ^ao-w9lq
29. As a Robot, I want send_message to a running Subagent and interrupt_agent, so that I steer and stop my Subagents ^ao-nc31
30. As an owner, I want the Robot header to show "N Subagents" with a dropdown, each opening the Subagent's own Chat and Trajectory, with Interrupt there and no composer, so that I watch and stop but talk only to the Robot ^ao-ce55
31. As an owner, I want one card per delegation in the Robot's Chat (label, model, status, result line) and the full exchange in the Trajectory, so that daily use stays calm and the detail is one tap away ^ao-15ui
32. As a Member, I want Mission Control's Fleet row to say "working · N Subagents" and expand to one line per Subagent (label, since when, running tool, Interrupt), so that I see parallel work without a new table ^ao-j8t9
33. As an owner, I want Subagents never to be a Task's doer, never in the Robot directory and never a Fleet row, so that a Subagent is a tool of its Robot, not an actor ^ao-2fgp
34. As an owner, I want Subagent tokens counted to the Robot and to me, and a crossed spend limit to stop Subagents first, then the Robot, so that fan-out cannot drain a subscription ^ao-3pl8
35. As an owner, I want at most three Subagents running at once per Robot, a fourth call refused with a message, so that fan-out is bounded ^ao-6jz6
36. As an owner, I want a platform restart to resume running Subagents the way a Turn resumes (a note, no redo of finished steps), so that a restart loses no work ^ao-ij3i
37. As an owner, I want Interrupt on the Robot to interrupt its Subagents, a Rewind to before a delegation to archive them with the log, and deleting the Robot to delete them, so that a Subagent never outlives its reason ^ao-qy77
38. As an owner, I want the Trajectory of the Robot to show a delegation as one entry that opens the Subagent's Trajectory, so that the Robot's log stays readable ^ao-i3q9
39. As an owner, I want secrets masked in a Subagent's log as in the Robot's, so that a password never shows anywhere ^ao-xl6g

### Auto review
40. As an owner, I want an Auto review switch in a Robot's advanced settings, off by default, so that I turn a model reviewer on for the Robots that need it ^ao-c8k9
41. As an owner, I want the reviewer's provider, model and thinking effort chosen per Robot, with a Home default, so that a cheap model reviews without a code change ^ao-6m9i
42. As an owner, I want every call of an item at level allow reviewed before it runs, and items at ask to keep asking me, so that review adds a check and removes none ^ao-wkpt
43. As an owner, I want a denied call to become an Ask with the reviewer's reason, and a failed review to fail the call with its error, so that the reviewer never finally blocks me and never silently runs a call ^ao-gf33
44. As an owner, I want a Subagent's calls reviewed with its Robot's setting, so that delegation does not escape review ^ao-6boj
45. As an owner, I want reviewer calls counted as model cost with their own line, so that I see what review costs ^ao-hfni
46. As an owner, I want the Trajectory to show which calls were reviewed and the decision, so that I can judge the reviewer ^ao-jn6z

### Cache warming and idle compaction
47. As an owner, I want a per-Robot switch cache warming, on for Mr. Robot by default, that refreshes the provider cache at 54, 108 and 162 minutes of idle, so that my next message to Mr. Robot is cheap ^ao-jlr0
48. As an owner, I want a per-Robot switch idle compaction, on for other Robots by default, that compacts once at 54 minutes of idle on the warm prefix, so that the next Wake-up starts from a cheap summary ^ao-f4sp
49. As an owner, I want neither plugin to act inside a Turn or while anything is queued, and a Wake-up during the wait to cancel the timer, so that a Robot in conversation never compacts under me ^ao-8hi8
50. As a Robot, I want one bounded step before an idle compaction that tells me compaction is coming so I write what matters to memory, so that the summary can lose nothing I needed ^ao-7bq9
51. As an owner, I want a context below a small floor left alone, so that an idle compaction never costs more than it saves ^ao-z22f
52. As an owner, I want both switches and the floor editable by Mr. Robot for other Robots like any setting, so that I configure by talking ^ao-5zin
53. As an owner, I want warming and compaction behaviour to depend on the provider's cache window (one hour for Claude, the provider's own for others), so that the moments are right for each Provider ^ao-c3er

### A computer
54. As an owner, I want a grant item computer, off until granted, that gives a Robot a Cloudflare Sandbox container on the python image, so that a Robot that needs Python has one ^ao-8x0c
55. As a Robot, I want computer_run (a command, its output, exit code, with a time limit), computer_read and computer_write for files on the computer, so that I run programs and read their results ^ao-xokp
56. As a Robot, I want the computer/ folder of my Workspace copied into the computer at boot and copied back when my Turn ends or the computer stops, so that what I keep there survives ^ao-7ptt
57. As a Robot, I want computer/setup.sh, when present, run at boot, so that the packages I need are installed before my first command ^ao-ia4z
58. As an owner, I want the computer to stop ten minutes after its last command and boot again on the next, so that an idle computer costs nothing ^ao-joux
59. As an owner, I want computer minutes priced at Cloudflare's container rates and counted toward the Robot's spend limit, so that a runaway script is capped ^ao-54j2
60. As an owner, I want computer commands reviewed by Auto review when it is on, so that the shell is not an escape from review ^ao-7lcd
61. As an owner, I want the computer image to be one deploy artefact in the repository, with no runtime catalogue, so that what runs is what was deployed ^ao-h1wn
62. As an owner, I want the computer's state (off, booting, running, stopping) in the Robot panel with a Stop button, so that I see and stop it ^ao-9q18
63. As an operator, I want the computer behind the same kind of seam as the browser backend, so that a different runtime later is an adapter, not a rewrite ^ao-33fs

### Cost by source
64. As an owner, I want a Robot's monthly cost shown by source — model (with reviewer and Subagents as lines), browser, computer, services — with the total, so that I know where the money goes ^ao-zbld
65. As a Member, I want my own monthly cost by source across my Robots, so that I see the same breakdown for myself ^ao-ef5t
66. As a Home admin, I want the Admin costs view by source for every Robot and Member, so that the Home's bill is explained ^ao-ypas
67. As an owner, I want the spend limit to count every source, so that one cap covers everything a Robot spends ^ao-nkkb

### Glossary and docs
68. As the owner, I want GLOSSARY.md to define Subagent, Steer, Follow-up, Auto review, Idle compaction, Cache warming, Computer and Spill, and to update Wake-up and Turn, so that the vocabulary has one word per thing ^ao-yn59
69. As an owner, I want the product docs and the platform prompt to cover steering, focus changes, Subagents, Auto review, the computer and spilled results, so that a Robot answers questions about them correctly ^ao-cetv
70. As an owner, I want the prompt preview to show the new sections, so that I can read what a Robot is told ^ao-o1w1

## Implementation Decisions

- **DSH 0.2.1-rc.2.** Every `@deepseek-ai/dsh-*` dependency moves together. Packages mounted anew: spill, spill-policy, tool-subagent with the in-process spawn and fork backends, subagent-control (send_message, interrupt_agent, list_agents). The experimental Auto review package is not mounted; its listener is copied as a Mr. Robot plugin (below). The dependency lint stays the gate.
- **Delivery on the Wake-up.** The Wake-up row gains `delivery: 'steer' | 'followup'`, decided by the platform when the Wake-up is queued, from the sender: a Member who owns the Robot (any Channel) and the Member's Mr. Robot acting as deputy → steer; everything else → followup. A composer flag (Ctrl+Enter) forces followup. The drain loop keeps one Turn at a time; while a Turn runs, a queued steer is handed to the running agent with `agent.steer()` at once instead of waiting; when no Turn runs, both kinds start a Turn through `agent.followup()` as today. Follow-ups from one sender that are queued together are joined into one message with a separator the prompt explains; a Task Wake-up is never joined. The session log records a steer with its Wake-up id; the Conversation projection places it at its consumed position.
- **Focus.** `task_focus({ task_id: string | null, reason: string })` may be called any number of times in a Turn. Changing or clearing focus finishes the previous Attempt as `skipped` with `firstLine = reason`, starts an Attempt for the new Task, and updates the registry row. The once-per-Turn rule and the "refused when already set" rule go.
- **Spill.** A `WorkspaceSpillStore` implements DSH's spill store over R2 under `<robot>/spill/<session>/<id>-<name>.txt`; the locator is the Workspace path, the retrieval hint names the file tools. `maxInlineTokens` is derived from the context budget (budget / 16, floor 2 000, cap 12 500). Tidy on the existing workspace tidy pass: spill files older than 30 days. The Files view sorts `spill/` last.
- **Subagents.** Grant item `tool:subagents` with a payload `allowedModels: { provider, model }[]` (the first grant item with a payload; the grant table gains a nullable JSON column). The Robot composition mounts tool-subagent with in-process spawn and fork, `maxDepth: 1`, `modelSelection` from the grant, and a child preset derived from the Robot's composition with the excluded tools removed (delegation, robot_send and the directory, thread_*, memory_write_shared / propose_member_file_edit, propose_grants, propose_review, need_help, react). The ask gate inside a child returns a failure instead of creating an Ask. A child session is a second session in the Robot DO's session tables, with `parent_session` and `label` columns; the DO holds the child agents in memory and keeps itself awake (waitUntil) while any runs; a child's final report becomes a platform Wake-up (followup) with the label and the report text; the Robot's running Turn, if any, gets it as an inject. Child usage is written to the Robot's usage rows with `source = 'subagent'`. `maxConcurrent = 3` is a constant for now. Restart: child sessions with an active turn resume with the same note the Robot uses. Interrupt, Rewind and delete cascade through the child list. The browser seam gives a child its own tab id under the Robot's browser session; cookies are the session's.
- **PWA for Subagents.** The Robot header gets a "N Subagents" control listing children (label, model, status, since); each opens `#/robots/:id/subagents/:child` with the Chat and Trajectory components over the child's session, a Stop button, no composer. The Chat shows a delegation card (same card family as Task cards). The Trajectory shows the delegation entry linking to the child. Mission Control's Fleet row shows the count and expands.
- **Auto review plugin.** A pre-execute listener in the Robot composition (not the Web preset glue) with the same review prompt and JSON contract as DSH's experimental package: five sections, strict `{ risk, decision, reason? }`, only the three valid pairs. Differences: the reviewer route (provider, model, effort) is a Robot setting with a Home default; a denial returns the ask decision carrying the reason, so the existing tool-call Ask path shows it; a reviewer failure fails the call. Reviewed calls get a `review` field on the tool event. Reviewer usage is written with `source = 'review'`. Items at `ask` bypass the reviewer (they ask anyway). Children inherit the Robot's setting.
- **Idle plugins.** Two Robot settings `cacheWarming: boolean` and `idleCompaction: boolean`, plus `idleCompactionFloorTokens` (default 20 000). On `endTurn` with an empty queue the Robot sets a DO alarm at the first idle moment; any `wake()` clears the idle plan. Warming: a minimal request on the Robot's current model chain entry that replays the cached prefix (as the owner's desktop plugin does), at 54 / 108 / 162 minutes for a one-hour cache; for providers without a known cache window, warming is a no-op and compaction uses 54 minutes. Idle compaction: at 54 minutes, if the live context is above the floor, the Robot gets one platform step ("compaction is coming; write what matters to memory now; do not reply to the owner") bounded by a step limit, then the existing compaction engine runs with the Robot's compaction instruction; the memory baseline is refreshed after it as today. Defaults at creation: Mr. Robot warming on / compaction off; other Robots the reverse. Mr. Robot's deputy settings tool gains these fields.
- **Computer.** A `Sandbox` Durable Object class from `@cloudflare/sandbox` (1.x) bound to the Worker, image `docker.io/cloudflare/sandbox:<sdk version>-python` extended by a Dockerfile in the repository; one container per Robot, keyed by Robot id; built and pushed by the deploy. Grant item `tool:computer`. Tools: `computer_run({ command, timeoutSeconds? })` → `{ stdout, stderr, exitCode }` (stdout through the spill policy), `computer_read({ path })`, `computer_write({ path, content })`, all under `/workspace`. A `ComputerBackend` seam (start, run, read, write, stop, state) with the Sandbox adapter and a stub for tests, mirroring the browser seam. Boot: start, copy the Workspace `computer/` prefix into `/workspace/computer`, run `setup.sh` when present. Sync back: on Turn end and before stop, changed files under `/workspace/computer` are written to the Workspace prefix. Idle stop: a DO alarm ten minutes after the last command. Usage: running milliseconds written to `computer_usage (month, ms, cost_usd)` at the Cloudflare container rate constants used for Chrome; counted into the spend limit. Panel: a Computer section with state and Stop.
- **Cost by source.** The per-Robot usage tables are read together into `CostBreakdown = { model: { robot, review, subagent }, browser, computer, services, total }`; the Member and Admin cost views and the spend-limit check use it. No new tables beyond `computer_usage` and a `source` column on the usage rows.
- **Prompt and docs.** The platform prompt gains: steering (a steer may change what you are doing; say so; task_focus with a reason), Subagents (when to delegate, what a Subagent cannot do, report on return), spilled results (read the file), the computer (scratch disk, computer/ folder, setup.sh). Product docs: subagents.md, computer.md, auto-review.md; tasks.md and robots.md updated.
- **Glossary** per ao-yn59.

## Testing Decisions

A good test drives the system the way a person or a Robot does: through the edge API in workerd with the scripted model, or through a rendered PWA component with a stubbed API; the computer has one integration test against a real container, run by hand like the browser one. No unit test on plugin internals; no test touches the network except the integration test.

- **Workerd through the API with the scripted model** (prior art: v1.13 Task and interrupt tests, v1.8 tool-surface tests): a steer reaches a running Turn at the next step and a follow-up waits (ao-9570, ao-q2z4, ao-m648); owner through a Channel steers, a Robot message follows up (ao-rsfo, ao-8848); same-sender follow-ups join, a Task never joins (ao-rdhs); steer position in the projection (ao-lfxt); task_focus twice in a Turn ends the first Attempt skipped with the reason (ao-lj6z, ao-cvpx, ao-n2fo); an oversized result yields head, tail and a readable Workspace file (ao-hf02, ao-5lzl, ao-antj); the subagents grant with an empty list refuses delegation, a listed model is accepted, an unlisted one refused (ao-zzga, ao-2z4n, ao-r3oq); a child has no delegation tool and the excluded tools (ao-8s1d, ao-sbc9); a child's Ask-level call fails with the message (ao-3umf); the Turn ends while a child runs and the report wakes the Robot (ao-w9lq); send_message and interrupt_agent (ao-nc31); the fourth child is refused (ao-6jz6); restart with a running child resumes it (ao-ij3i); interrupt, rewind and delete cascade (ao-qy77); child usage on the Robot's rows and the spend limit stopping children first (ao-3pl8); Auto review allows, denies into an Ask with the reason, fails the call on a malformed reviewer answer, skips ask-level items, reviews a child's call (ao-wkpt, ao-gf33, ao-6boj, ao-c8k9); idle alarm set on an empty queue and cleared by a Wake-up; warming request at the moments; idle compaction after the memory step, skipped below the floor (ao-jlr0, ao-f4sp, ao-8hi8, ao-7bq9, ao-z22f); computer tools against the stub backend: boot copies computer/, setup.sh runs, sync back on Turn end, idle stop, usage rows and the spend limit (ao-xokp, ao-7ptt, ao-ia4z, ao-joux, ao-54j2); cost breakdown views (ao-zbld, ao-ef5t, ao-ypas, ao-nkkb); upgrade: the existing suite green and an old session log rendering (ao-ejub, ao-wzw9); dependency lint (ao-ggzv).
- **Component tests** (prior art: v1.12 and v1.13 component tests): Ctrl+Enter sends a follow-up (ao-q2z4); the Subagents dropdown, the child view without composer, the delegation card, the Mission Control expandable row (ao-ce55, ao-15ui, ao-j8t9, ao-i3q9); Auto review and idle switches in advanced settings (ao-c8k9, ao-6m9i, ao-jlr0, ao-f4sp); the Computer section (ao-9q18); cost breakdown rendering (ao-zbld); the Files view sorting spill/ last (ao-ry61).
- **Integration, by hand**: a Robot on a deployed staging Worker runs a Python script with Pandas on its computer and reads the result (ao-8x0c, ao-h1wn, ao-xokp), as the browser integration test does today.
- **Alchemy plan test**: the Sandbox container and binding appear in the plan (ao-h1wn).

## Out of Scope

Subagent depth above one; Subagents as Task doers or Fleet rows; the owner messaging a Subagent directly; out-of-process Subagent backends (ACP, Codex, Claude Code); a configurable Auto review policy or deterministic exemptions; a TTL scratchpad (the daily note is the scratchpad); dynamic tool discovery (code mode covers it); a runtime image catalogue or Mr. Robot editing Dockerfiles; a persistent container disk; GPU or long-running services on the computer; the computer as a browser host; Temporal or any workflow engine; a per-reply attribution of steers; warming for providers without a known cache window.

## Further Notes

Decisions from the grill session 2026-10-19 (five rounds), with what was weighed.

- **Steer by sender, not by content.** Automatic detection of what a message means was rejected: the Robot declares its focus and reason itself; the platform only decides delivery from who sent it. The owner called this the "Karen test": a person must be able to redirect a Robot without knowing the mechanism.
- **No scratchpad.** Lee Robinson's third memory layer (ephemeral notes with a TTL) was judged a workaround for compaction losing in-flight state, which Mr. Robot keeps in Tasks, the daily note and the compaction instruction.
- **Subagents were first excluded, then taken.** The cost is glue and UI, since the packages are DSH's; the limit is depth one and an explicit model list, because "everything must be declared". Subagents are tools of a Robot, not actors — that removed most of the feared complexity.
- **Auto review copies DSH's mechanism** rather than mounting the experimental package: the owner wants a different (cheaper) reviewer model, a per-Robot switch and no dependence on a Web-profile layer; the mechanism is kept identical so a later stable DSH version can replace it.
- **Idle, never mid-Turn.** The owner's rule: a Robot keeps going as long as it has context; proactive work happens only when it is idle and the cache is about to expire. The moments (54 / 108 / 162 minutes) come from the owner's measured desktop profile.
- **The computer is in, minimal.** An outside-in review found that a runtime catalogue of images is impossible on Cloudflare (images are deploy artefacts), that the python Sandbox image already holds what the owner named, and that the durable thing is a setup script in the Workspace, not the image. The owner gave the file-sync and idle-stop decisions to the agent; they are recorded above to reverse.
- **Cost by source** was the owner's requirement, higher granularity than one number, with the total kept.
- Seams: the existing edge API in workerd with the scripted model is the single seam for every behaviour above; the computer adds one backend seam like the browser's. No new seam elsewhere.
