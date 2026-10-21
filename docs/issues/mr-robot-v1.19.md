---
title: "Mr. Robot v1.19 — The endless Conversation that stays small: chapters, materialized chat, Trajectory per chapter, Rewind without a ghost, cold storage, a scale test"
status: done
story-prefix: ec
parent: mr-robot-v1.18.md
---

# Mr. Robot v1.19 — The endless Conversation that stays small

## Problem Statement

A Robot's Conversation never ends. It is stored as one session log in the Robot's Durable Object SQLite (one row per event), and DSH's compaction appends a checkpoint to the same log rather than starting a new one; the model reads from the last checkpoint on, the log keeps everything. On 2026-10-21 the owner asked what happens after a year of daily use. The answer: storage is fine (a busy Robot writes 0.5–1 MB a day; the Durable Object allows 10 GB), but two readers read the whole log from seq 0:

1. **The Conversation and Trajectory views.** Every page of the chat reads every stored event of the live session, parses it, folds every chat item, reverses the list and slices twenty items. After a year that is hundreds of megabytes of JSON parsed on every open, in an object with 128 MB of memory. It fails long before a year.
2. **Resuming the agent.** The persistence handle exposes read(offset = 0) and the agent is rebuilt from the log when the Durable Object wakes. Whether DSH reads from the checkpoint or from zero is a hypothesis this spec's first ticket settles by measurement; either way the live session must be short by construction.

The owner's view of the product fixes the shape of the fix: the chat is one endless scroll; between two compactions a working Robot exchanges few messages (Mr. Robot is the exception, bounded anyway by its context budget); the Trajectory is an advanced view and may go one span at a time with Previous and Next. He also asked whether Rewind must leave a synthetic message in the model's context (his DSH rewind plugin must, because DSH's context can only grow or have a range replaced), and gave the agent full trust to make the whole thing not explode and not slow down with time.

## Solution

**Chapters.** A Conversation is a chain of chapters. A chapter is one session in the log, running from a compaction checkpoint to the next. A compaction closes the live chapter and opens the next one as a new session seeded with the checkpoint and linked to its parent, the same way a forked Subagent is seeded today. Resume, the memory baseline and every reader that serves the live Robot touch the live chapter only; a chapter is at most a context budget long by construction.

**The chat is materialized.** Chat items are written to a table as events are appended (the projection fold runs per event, as the search index already does), with chapter and position; a page is one SQL query; the PWA scrolls back without end across chapters it never sees. Search covers every chapter. Mission Control reads the tail of the live chapter.

**Trajectory per chapter.** The Trajectory shows one chapter with Previous, Next and a picker (dates, turns, why the chapter closed: compaction, Rewind, or still live); an old chapter loads its own events only.

**Rewind without a ghost.** Rewind opens a new chapter seeded from the chosen point, in the live chapter or an older one; the chapters after the point are marked superseded and stay readable, greyed. No synthetic message enters the model's context: the seed is real history up to the point, and the one thing the Robot must know, that external effects since then still stand, rides as the label of its next Wake-up. Undo rewind goes; the superseded chapters are the undo a person needs.

**Cold storage.** Chapters older than the retention window move whole to R2, one object per chapter; their chat items stay in SQLite, so the scroll never notices; the Trajectory of a cold chapter is fetched on demand. Retention: the last 30 chapters or 60 days, whichever keeps more. Delete and the three resets cover cold chapters.

**A scale test.** A test that seeds a year of a busy Robot through the persistence seam, then drives the system through the edge API with the scripted model and asserts row and time budgets for opening the chat, loading a page, waking a Turn and opening a Trajectory chapter. It runs first to measure today (and settle the resume hypothesis), then stays as the guard.

## User Stories

### Chapters
1. As an owner, I want a Robot's Conversation kept as a chain of chapters, one per span between compactions, so that no reader ever needs the whole history ^ec-7oq8
2. As an operator, I want a compaction to close the live chapter and open the next one as a new session seeded with the checkpoint and linked to its parent, so that the live chapter is always short ^ec-srfn
3. As an operator, I want a Robot that wakes after sleeping to resume from its live chapter alone, so that waking costs the same on day one and day 400 ^ec-7s3l
4. As a Robot, I want the memory baseline and the change notes to behave at a chapter boundary exactly as they do after a compaction today, so that nothing about memory changes ^ec-ndqf
5. As an owner, I want Subagent sessions to belong to the chapter they ran in, so that they age with it ^ec-h8ib

### The chat
6. As an owner, I want chat items materialized into a table as events are written, with their chapter and position, so that a page of the chat is one query ^ec-2sra
7. As an owner, I want the Conversation to scroll back without end, older pages loading across chapter boundaries without my noticing them, so that the chat reads as one ^ec-n0uh
8. As an owner, I want opening a chat and loading a page to read a bounded number of rows regardless of the Robot's age, so that the chat never slows with time ^ec-yxru
9. As an owner, I want conversation_search and the chat search to cover every chapter, so that nothing is lost to the chain ^ec-enqy
10. As an owner, I want the Fleet's 'running tool' and a Subagent's activity read from the tail of the live chapter only, so that Mission Control stays fast ^ec-es5g

### The Trajectory
11. As an owner, I want the Trajectory shown one chapter at a time with Previous and Next and a chapter picker (dates, turns, why it closed), so that I can read any span of the full log ^ec-mwvo
12. As an owner, I want the Trajectory of a chapter to load only that chapter's events, so that an old chapter opens as fast as the live one ^ec-elhb

### Rewind
13. As an owner, I want Rewind to open a new chapter seeded from the chosen point, in the live chapter or an older one, and to mark the chapters after that point as superseded, so that rewinding is the same move as compaction ^ec-i74p
14. As a Robot, I want no synthetic message in my context after a Rewind, and the fact that external effects since the point still stand delivered as the label of my next Wake-up, so that my context is real history plus one honest notice ^ec-utsf
15. As an owner, I want superseded chapters readable in the Trajectory, greyed, and Undo rewind gone, so that nothing is lost and nothing pretends to be live ^ec-cc6i
16. As an owner, I want old Conversations with their rewind archives and undo records to render under the chapter model after the upgrade, so that history survives ^ec-eaz3

### Cold chapters
17. As an operator, I want chapters older than the retention window moved whole to R2 as one object each, with their chat items staying in SQLite, so that the Durable Object's storage stays small for years ^ec-4qsf
18. As an owner, I want the Trajectory of a cold chapter fetched from R2 on demand, so that cold is slower to open but never gone ^ec-aly5
19. As an operator, I want the retention window to be a constant the spec names (the last 30 chapters or 60 days, whichever keeps more), so that it is one number to reverse ^ec-2rdv
20. As an owner, I want delete, Clear history, Start over and Reset everything to cover cold chapters too, so that nothing survives that should not ^ec-cgsl

### The scale test
21. As an operator, I want a scale test that seeds a year of a busy Robot (on the order of 150 000 events in 400 chapters) through the persistence seam and then drives the system through the edge API with the scripted model, so that growth is measured, not hoped ^ec-2lts
22. As an operator, I want the scale test to assert budgets: opening the chat and loading a page read at most a few hundred rows; waking a Turn reads only the live chapter; a Trajectory page reads one chapter; all within time limits the test names, so that a regression fails a test ^ec-o5pz
23. As an operator, I want the scale test to record its numbers in its output and the first run's numbers in the ticket's closing note, so that the baseline is known ^ec-olsc

### Glossary and docs
24. As an owner, I want the glossary to define Chapter, Live chapter, Cold chapter and Superseded chapter and to redefine Conversation, Trajectory and Rewind by them, so that the words are one ^ec-7f03
25. As a Robot, I want docs/mr-robot.md and docs/memory-and-files.md to describe chapters where they describe compaction and Rewind, so that what I read is what the platform does ^ec-74sf

## Implementation Decisions

- **Chapters.** The session_log row gains chapter columns: parent session, the seq in the parent it was seeded from, why it closed (compaction | rewind | live), opened and closed times, and the chapter's ordinal. A compaction's onCompacted hook creates the next session with a seed built from the checkpoint and the memory baseline (the same seed builder the fork path uses), inheritedEventCount = the parent's length, and switches the Robot's liveSessionId; the old session is closed. The Robot's own log table is unchanged in shape. Subagent sessions keep parent_session as today, which is their chapter.
- **Resume.** The agent is resumed on the live chapter only. The first ticket measures whether DSH's resume reads from the checkpoint or from zero; if from zero, the chapter design bounds it anyway and the measurement goes in the closing note.
- **Materialized chat.** A chat_item table (session_id, seq, position, kind, json) written in the same transaction as the event by the existing per-event fold (projection.ts), including items that come from Asks and Tasks today; the conversationPage view becomes a query with LIMIT and a cursor (chapter ordinal, position) that steps across chapters; the PWA's ChatScroll uses the cursor. A one-time backfill folds existing sessions into the table on the first Turn after the upgrade, chapter by chapter, bounded per Turn so a huge Robot backfills over several Turns. conversation_search's FTS index is extended with the chapter.
- **Trajectory.** The trajectory endpoint takes a chapter and returns its events with the chapter list (ordinal, opened, closed, reason, turns); Previous and Next in the PWA; the excerpt reach (40 events) is unchanged.
- **Rewind.** rewind(atSeq) and rewindBeforeTurn become "open a chapter at this point": a seed from the chosen chapter up to the point, the new session linked to it, every later chapter marked superseded. The rewind note that today is written into the new session is replaced by a pending Wake-up label (`[Rewound to <when>: external effects since then stand: <summary>]`) delivered with the next Wake-up. undoRewind and its endpoints and UI are removed; superseded chapters show in the picker, greyed, read-only. Existing archives (old rewinds) are registered as superseded chapters at the migration.
- **Cold storage.** A tidy pass on the existing Workspace tidy schedule moves chapters outside the window to R2 under <robot>/chapters/<ordinal>.json (events only), deletes their session_event rows and marks the session_log row cold; chat_item rows stay; reading a cold chapter's Trajectory fetches the object and parses it on demand. Delete and the resets remove the prefix.
- **Scale test.** A workerd test named scale.test.ts: builds the year through the persistence seam (synthetic events of the kinds the fold knows, 400 chapters, about 150 000 events, realistic sizes), then asserts: GET conversation page 1 reads ≤ 200 session or chat rows (counted through a SQL-counting seam on the store) and answers under 500 ms in the test environment; waking a Turn with the scripted model reads only the live chapter's rows; a Trajectory chapter reads that chapter's rows; search answers under 500 ms; the numbers are printed. Budgets are constants at the top of the test with the reasoning next to them.
- **Glossary** per ec-7f03.

## Testing Decisions

The owner asked what to call the test that proves this. It is not a unit test (no internal), nor a smoke test (it asserts budgets), nor a plain end-to-end test (it does not test a feature). It is a **scale test**: an integration test through the public interface at a size the product must survive, with budgets as assertions. One such test per concern is enough; it is the regression test for "slows down with time".

A good test drives the system the way a person or a Robot does: through the edge API in workerd with the scripted model and the stub backends, or through a rendered PWA component with a stubbed API. No unit test on plugin internals; no test touches the network.

- **Scale test** (new, prior art: none; it is the first of its kind here): the year seeded through the persistence seam; budgets for chat open and page, Turn wake, Trajectory chapter, search (ec-2lts, ec-o5pz, ec-olsc).
- **Workerd through the API with the scripted model** (prior art: v1 trajectory and rewind tests, v1.14 compaction tests, v1.6 conversation search tests): a compaction closes the chapter and opens the next with the checkpoint, the live chapter resumes alone, the memory baseline behaves as before, Subagents belong to their chapter (ec-7oq8, ec-srfn, ec-7s3l, ec-ndqf, ec-h8ib); chat items materialized per event, pages by cursor across chapters, the backfill of an old Robot over several Turns, search across chapters, Fleet activity from the live tail (ec-2sra, ec-n0uh, ec-yxru, ec-enqy, ec-es5g); the Trajectory per chapter with the chapter list (ec-mwvo, ec-elhb); Rewind opens a chapter in the live and in an older chapter, later chapters superseded, no synthetic message in the seed, the label on the next Wake-up, undo gone, old archives migrated (ec-i74p, ec-utsf, ec-cc6i, ec-eaz3); cold move at the window, cold Trajectory from the R2 stub, delete and resets remove the prefix (ec-4qsf, ec-aly5, ec-2rdv, ec-cgsl).
- **Component tests** (prior art: v1.7 stick-to-bottom scroll): the chat scrolls back across chapters with the cursor; the Trajectory's Previous, Next and picker; superseded chapters greyed (ec-n0uh, ec-mwvo, ec-cc6i).

## Out of Scope

Changing when compaction happens (the budget and the idle plugins stay); summarising or deleting chat items (the chat keeps everything); cross-Robot or cross-Space archives; exporting a Conversation; a rewind that edits history in place (DSH's context model forbids it and the chapter model does not need it); cold storage for the Workspace or screenshots; a projection cache for anything but the chat.

## Further Notes

Decisions from 2026-10-21, with what was weighed.

- **Chapters, not one long log, not a new log per Turn.** The owner's instinct was "sessions between compactions"; it matches what DSH's fork seeding already does, so a chapter boundary is a seeded session and nothing new in the persistence contract.
- **Materialize the chat, not the Trajectory.** The chat is read on every open and must be one query; the Trajectory is advanced and per chapter, so it reads one chapter's events and needs no table.
- **Rewind without a ghost.** The owner's DSH rewind plugin must leave a note because DSH's context can only grow or have a range replaced; Mr. Robot owns its persistence and seeds a new chapter from real history, so the note moves to where notices live, the next Wake-up's label. Undo was dropped because superseded chapters are readable; the owner gave full trust on this point.
- **Retention is one number.** 30 chapters or 60 days, whichever keeps more; cold chapters are never deleted by age, only moved.
- **The scale test comes first.** It measures today before anything changes, settles whether DSH resumes from zero, and then guards the fix.
- Seams: the persistence seam (for seeding the year), the edge API in workerd with the scripted model, the R2 stub; component tests. No new seam.