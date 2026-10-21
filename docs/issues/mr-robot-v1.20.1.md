---
title: "Mr. Robot v1.20.1 — Review fixes for v1.18, v1.19, v1.20 and the cross-cutting findings"
status: ready-for-agent
parent: mr-robot-v1.20.md
---

# Mr. Robot v1.20.1 — Review fixes

## Problem Statement

Four read-only reviews of the implemented v1.18, v1.19 and v1.20 (docs/review/v1.18-code-review.md, v1.19-code-review.md, v1.20-code-review.md, cross-cutting-review.md; 108 findings) found bugs that the green suite does not catch. The planning session verified the serious ones in the code on 2026-10-21 and designed the fixes below. Findings are cited as <review>#<n>. Each ticket's first step is to confirm the cited findings against the code; a finding that turns out false is recorded as such in the closing note and left alone.

## Decisions

1. **Platform steps and code mode.** The step fence refuses by inner tool name; on a code-mode Robot (the default) the only callable tool is run_code, so every fenced step (snapshot, sweep, dream, the definition scrub) was inert while advancing its bookkeeping, and the person's Turn was tool-less during an in-Turn snapshot (v1.20#1, #2; v1.18#3). Fix: run_code is transparent to every fence (always allowed; the inner calls a program makes are what the fence judges); every v1.20 test runs in both modes with code mode first; the bookkeeping (SWEPT_AT, the memory mark, DREAMED_AT) advances only when the step ran at least one allowed tool or ended by the model's choice, never on a refused step.
2. **Platform steps take the Turn.** A platform step that is not inside a person's Turn (idle snapshot, sweep, dream, the definition scrub) runs as a Turn of its own cause: Wake-ups queue behind it as behind any Turn, so no Turn shares its fence or its author (v1.18#3). The fence is owned: it is opened with a token and closed only by the same token; a compaction that becomes due inside a platform step runs no snapshot (the step has its own file tools and the dream has no business snapshotting); a snapshot inside the person's Turn fences exactly its three steps and hands the Turn back with every tool (v1.20#3, snapshot suppression finding).
3. **Secrets outlive a Turn.** The session redactor masks with every secret value the Robot may read (its login entries' passwords and TOTP seeds, its secrets at allow reading, refreshed when grants change) and with the running Turn's revealed values, so a value the model repeats in a later Turn never reaches session_event, chat_item, the FTS index or an R2 chapter (cross#1). The same mask applies to Pages, definitions, dream files and spill files at write.
4. **Auto review sees one Turn, redacted, bounded.** The reviewer gets the current Turn's history after redaction, truncated to a fixed budget (the last 24 messages or 16 k tokens, whichever is smaller) plus the pending call (cross#2).
5. **Shared Pages follow their owner.** Removing a Member deletes the Member's shared_page rows; /p checks the Member's status and the Robot's (paused or setup: the page serves, the PDF answers 503) (cross#3).
6. **Duties never re-arm in the past.** A duty that refuses because the Robot is busy re-arms at now + heartbeat; nextAt is clamped to now (cross: 03:00 storm; v1.20 re-arm). The dream-hour close honours the Space's default when the Robot has no setting (cross). The dream's usage is priced at the model that ran it (v1.20).
7. **Rewind and cold chapters.** The external-effects label is built from the chat rows (activity rows carry tool names and stay when a chapter goes cold) and from the Subagent sessions of the span, never from session_event alone (v1.19#1, Subagent finding). Rewind, chapter close and Clear history take the Turn lock (single flight): a Rewind under a Turn, two chapters from one parent, and Clear history racing a Turn end (v1.19 interleave findings).
8. **Clear history, Reset, delete are ordered for a crash.** The new live chapter is written first, then the old chapters are tombstoned and removed by a resumable tidy (SQLite rows, R2 objects, search rows), so an eviction between steps leaves a working Robot and a tidy that finishes later (v1.19#2).
9. **Search covers every chapter.** registerChapters tracks every chapter; the cold move indexes a chapter before deleting its rows; the catch-up never writes the all-indexed sentinel for a chapter it could not read (v1.19#3).
10. **Marketplace.** Add returns the Member's RobotSummary and is idempotent for (member, slug) while the created Robot is still in setup; the admin's list shows every definition (published, own, every Member's unpublished) with its state; a repository form that fails to parse keeps the last good definition and marks it invalid with the parse error (v1.18#1, #2, malformed form).
11. **Definitions.** The scrub runs after the platform has generated tasks.yaml and README, is confined to the staged prefix, and publishing requires the scrub step to have run and ended (v1.18 scrub findings; v1.20#2).
12. **File history is the only write path for tracked files.** The presign endpoint refuses paths in the tracked set (persona, memory, Member files); the 90-day trim runs in the Workspace tidy pass, not only on a write (v1.18 presign and trim findings).
13. **Grok import is bounded.** Allowed host x.ai only, 5 MB cap, 15 s timeout, performed by the edge Worker and handed to the Space DO as data (v1.18 fetch finding).
14. **People pages.** The owner can delete and restore a page (DELETE removes the Member row and keeps history; Restore works); two Robots' writes to INDEX.md are serialized by the Member DO (v1.20 page findings).
15. **Tests.** The two timing-bound tests poll state instead of waiting; requires-hosts asserts that a Host was counted; the Alchemy plan test asserts the renamed_classes migration (cross and v1.18 test gaps).
16. **robot.ts.** The host methods v1.20 tickets 03 to 06 added to robot.ts (memory index, people pages, dream) move to their plugins' host modules; the closing note records the line count (v1.20 ticket 00 intent).
17. **Everything else** in the four reviews marked note or drift is read, and either fixed in passing when it is one line, or recorded in the ticket's closing note as accepted with one sentence why.

## Testing Decisions

Every fix lands with the test that would have caught it, through the edge API in workerd with the scripted model, in both modes where the fix touches a platform step. No unit tests on plugin internals.
