# 01: Platform steps in code mode, owned fences, steps as Turns

**What to build:** Decisions 1 and 2: run_code transparent to every fence; bookkeeping advances only after a real step; idle snapshot, sweep, dream and the definition scrub run as Turns of their own cause with Wake-ups queued behind them; the fence is opened and closed with an owner token; no snapshot inside a platform step; the in-Turn snapshot fences exactly its three steps; every v1.20 test runs in code mode first and direct mode second. Findings: v1.20#1, #2, #3, the snapshot suppression finding; v1.18#3.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd tests in code mode: the snapshot, the sweep and the dream read and write files; a Wake-up during a sweep waits and runs with every tool; a pressure compaction inside a dream runs no snapshot and the dream's fence stays; the in-Turn snapshot hands every tool back
- [x] Bookkeeping does not advance on a refused step (test)

## Closing note

Findings confirmed in the code: v1.20-review #1 (the fence refused run_code), #2 (the scrub ran fenced, so in code mode it edited nothing), #5 (a Turn that ended inside its snapshot set "taken" and suppressed the next compaction's snapshot), #6 (a snapshot inside the dream lifted the dream's fence), #7 (the snapshot's fence outlived its steps into the safety net), #9 and v1.18-review #9 (a Wake-up during an idle step shared its fence, author and step counter), #11 (an in-Turn snapshot ended by the Turn booked the rest of the Turn as memory), #20 (every step limit was one step short). The ticket cites "v1.20#3" and "v1.18#3". In the reviews those numbers are the people-page delete and the admin's Marketplace list, which tickets 06 and 05 cover. I took the decision text as the scope.

Tests: snapshot, memory-sweep, dreaming, chief-dream, people-pages, memory-search, idle and warming-closing now run each case in code mode first, then with direct calls. The scripted model turns a step's calls into one run_code program when the request offers only run_code (stub-llm.ts, programmed). New cases:
- an in-Turn snapshot the Turn ends inside: the safety net still says, and the compaction follows the snapshot;
- a sweep that ran only a refused tool: the same notes are swept at the next idle compaction;
- a message during an idle step: it waits, then runs in its own Turn with every tool, and the sweep's write stays the sweep's;
- a pressure compaction inside the dream: it starts no snapshot, and the dream's fence still refuses say;
- a dream that ran only a refused tool: the same night's evidence is dreamed on again.

Decisions:
- run_code is transparent to every fence; the calls a program makes go through the same DSH guard and are what the fence judges.
- StepFence is owned: open returns a token (undefined when another owner holds it), and only that token closes it. close returns the tally of allowed and refused calls. A step did its work (stepRan) when it ran an allowed call, or when the model ended it with nothing refused. platformStep returns { startSeq, tally, endedByModel, ran }. The memory mark, SWEPT_AT and DREAMED_AT move only on a step that did its work. DREAMED_AT is set at the dream's end from the time the dream was queued, not when it is queued.
- The step limits now allow exactly their count: the cancel fires at the start of the step after the limit. This applies to platformStep and the dream.
- Idle steps and the definition scrub run as a Turn of their own (Robot.asTurn). While one runs, drain does not start a Turn, so Wake-ups queue behind it and drain when it ends. idleNow also counts it.
- In-Turn snapshot: the steer goes in at the boundary; the step after it is still the person's and has every tool. The fence holds from the next boundary for exactly three steps, then the compaction runs. A Turn that ends inside it closes it before the safety net. That close moves the memory mark only if the snapshot did its work, and never sets "taken", so the next compaction gets its own snapshot. No snapshot starts while a platform step runs or another owner holds the fence. The dream's fence opens before its Wake-up reaches the agent.
- A bug the reviews did not list, found here: a chapter's seed copied assistant messages without their step/start and step/end. DSH's token meter then threw on every measure in any chapter after the first, so no pressure or idle compaction could ever run there again (it only showed as a "step compaction failed" warning). chapter-seed.ts now writes each copied assistant message inside its step, and drops the stale usage the closing chapter reported. A chapter seeded before this fix keeps the broken seed until it is closed some other way (Clear history or Start over); there is no repair pass. The chapters test sets the budget back to 128 000 after its compaction, because the seed keeps the long reply.
- Not fixed: v1.20-review #10 (a restart during a platform step leaves its instruction in DSH's durable inbox). The step is a Turn of its own now, but a restart in the middle can still replay the instruction once.
