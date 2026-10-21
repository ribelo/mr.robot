# 01: Platform steps in code mode, owned fences, steps as Turns

**What to build:** Decisions 1 and 2: run_code transparent to every fence; bookkeeping advances only after a real step; idle snapshot, sweep, dream and the definition scrub run as Turns of their own cause with Wake-ups queued behind them; the fence is opened and closed with an owner token; no snapshot inside a platform step; the in-Turn snapshot fences exactly its three steps; every v1.20 test runs in code mode first and direct mode second. Findings: v1.20#1, #2, #3, the snapshot suppression finding; v1.18#3.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd tests in code mode: the snapshot, the sweep and the dream read and write files; a Wake-up during a sweep waits and runs with every tool; a pressure compaction inside a dream runs no snapshot and the dream's fence stays; the in-Turn snapshot hands every tool back
- [ ] Bookkeeping does not advance on a refused step (test)
