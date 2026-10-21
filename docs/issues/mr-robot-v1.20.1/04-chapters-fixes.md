# 04: Rewind labels from chat rows; Turn lock for Rewind, chapter close and Clear history; crash-ordered resets; search covers cold chapters

**What to build:** Decisions 7, 8 and 9. Findings: v1.19#1, #2, #3, the interleaved-close and rewind-under-Turn findings, the Subagent label finding, the backfill and stale length notes where one line fixes them.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd test: a Rewind across a cold chapter names the tools used since, including Subagent work
- [x] Workerd test: an idle close and a Turn close cannot open two chapters from one parent; a Rewind waits for a running Turn
- [x] Workerd test: Clear history interrupted after its first write leaves a working Robot and a tidy that finishes on the next alarm; Reset and delete remove R2 chapters
- [x] Workerd test: a chapter that goes cold before indexing is found by search afterwards

## Closing note

v1.19-review findings #1 to #6 are confirmed in the code. apps/worker/test/chapters-fixes.test.ts covers them:
- A Rewind into a cold chapter, past a delegation, gets a label naming subagent and the Subagent's write, read from R2.
- A Rewind under a running Turn answers 409. A message sent at the same moment as a Rewind lands in the chapter the Rewind opened, and no two chapters share a parent.
- Clear history removes the cold objects. A purge left by an eviction runs at the next alarm, and the Robot works meanwhile.
- A chapter that went cold unindexed is found by search: when moving now, and through R2 for one moved before this fix.

Decisions:
- The Rewind label is read from each log where it lives (logOf: SQLite, or the cold chapter's object). It covers the target chapter after the point, the later chapters on the chain, and their Subagents (a Subagent of the target counts when started after the point). Inner calls of a program count by name; run_code itself does not. The spec said "from the chat rows". I read the logs instead: activity rows hold display tool names merged per step and have no rows for Subagents, while the cold object holds both logs. This also removes the JSON-prefix LIKE of #13.
- The Turn lock is the platform-step slot of ticket 01 (asTurn). A Rewind and a Clear history hold it, so no Turn starts while they read and switch chapters, and a Wake-up queues behind them. A running Turn still makes both answer 409 at once. rollChapter is single flight, and after its await it checks the chapter and the Turn again before its transaction.
- Clear history: the cold objects are listed first. One transaction then removes the history, opens the new live chapter and names the objects in kv cold-purge. The deletes follow, and a duty (cold-purge) retries whatever remains at the next alarm. Reset (Member reset) and delete go through destroy, which already removes the cold prefix before the storage; the existing cold-chapters test covers delete.
- Search: the cold move catches the chapter's index up before deleting its rows. The all-indexed sentinel is written only when no chapter is left behind. The cold tidy indexes a cold chapter that is behind from its R2 object, in its batch.
- In passing: #8, the deputy's robot_conversation page is clamped to 50, and its description says to search for older items. Bounds in the JSON schema were refused by the code-mode SDK check, so the clamp is in execute.
- Accepted, with why:
  - #7: a running Subagent defers the close to a Turn boundary, to keep the Subagent's chapter. A chapter longer than a budget then compacts again.
  - #9: the PWA's own chat search is unchanged, as a UI scope for later.
  - #10: the cold object path is as recorded in the v1.19 note.
  - #11, #12: test gaps of the scale test, left.
  - #14: stale lengths of cold chapters are what current() relies on, and the new behind() uses it.
  - #15: a lost cold object renders empty. The data is gone either way.
  - #16: the backfill sentinel holds in practice.
  - #17: a notice and its side row outside a transaction are two writes. An eviction between them loses one notice.
  - #18, #19: an Ask after the point stays open after a Rewind. The owner still owes the decision, and the Robot gets its answer as an askAnswer.
  - #20: undone is kept for old rows.
  - #21: per-chapter windows in the PWA, a UI note.
