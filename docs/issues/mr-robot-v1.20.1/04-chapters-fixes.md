# 04: Rewind labels from chat rows; Turn lock for Rewind, chapter close and Clear history; crash-ordered resets; search covers cold chapters

**What to build:** Decisions 7, 8 and 9. Findings: v1.19#1, #2, #3, the interleaved-close and rewind-under-Turn findings, the Subagent label finding, the backfill and stale length notes where one line fixes them.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test: a Rewind across a cold chapter names the tools used since, including Subagent work
- [ ] Workerd test: an idle close and a Turn close cannot open two chapters from one parent; a Rewind waits for a running Turn
- [ ] Workerd test: Clear history interrupted after its first write leaves a working Robot and a tidy that finishes on the next alarm; Reset and delete remove R2 chapters
- [ ] Workerd test: a chapter that goes cold before indexing is found by search afterwards
