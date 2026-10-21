# 06: Cold chapters in R2

**What to build:** The tidy pass moves chapters outside the window (last 30 chapters or 60 days, whichever keeps more) to R2 one object each, deletes their event rows, keeps chat items; a cold chapter's Trajectory loads from R2 on demand; delete and the resets remove the prefix (ec-4qsf, ec-aly5, ec-2rdv, ec-cgsl).

**Blocked by:** 03, 04

**Status:** done

- [x] Workerd test with the R2 stub: the move at the window, the cold Trajectory, delete and resets
- [x] The scale test passes with cold chapters present

## Closing note

apps/worker/test/cold-chapters.test.ts (no move inside 60 days; the move at the window; the chat unchanged; search; a cold chapter's Trajectory whole and paged; a cold chapter's Subagent; Clear history and deleting the Robot remove the objects). The scale test now runs its year's tidy passes: 335 of 400 chapters go to R2 in about 4 s, 24 180 events stay in the Durable Object (was 146 000); every budget passes with them cold, and the Trajectory of cold chapter 200 reads 367 session rows (its chat rows and the live chapter's Turn count) and the object.

Decisions:
- The objects are at chapters/<robot id>/<ordinal>.json, beside the Workspace and outside it (robots/<id>/), so the Robot's file tools never see them. One object holds the chapter's events and the events of every Subagent that ran in it: they age with it (ec-h8ib).
- The window is the spec's: a closed chapter goes when it is not among the last 30 chapters and closed more than 60 days ago (constants CHAPTERS_KEPT and CHAPTER_DAYS_KEPT in cold-chapters.ts). The live chapter never goes; a chapter whose chat is not stored yet, or with a Subagent still running, waits.
- The move runs in the Workspace tidy pass (the daily spill sweep), at most 20 chapters a pass. Its Turns are counted before its rows go. The chapter row, session_log row, chat items and search rows stay.
- Readers of events (the Trajectory, the events page, an excerpt around a chat item, a Rewind into an old chapter, a Subagent's chat and log) read through one function that takes the object when the chapter is cold; the events page of a cold chapter is paged in memory.
- Clear history (and so Start over) and deleting the Robot (and so Reset everything, which deletes the Member's Robots) delete the prefix. After Clear history the ordinals start at 1 again, which is why the objects must go with it.
