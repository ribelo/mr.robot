# 02: Chapters: a compaction opens the next session

**What to build:** session_log gains the chapter columns; a compaction closes the live chapter and opens the next session seeded with the checkpoint and the memory baseline, inheritedEventCount set, liveSessionId switched; the Robot resumes on the live chapter alone; memory behaves as before; Subagent sessions belong to their chapter; a migration registers existing sessions as chapters (ec-7oq8, ec-srfn, ec-7s3l, ec-ndqf, ec-h8ib).

**Blocked by:** 01

**Status:** done

- [x] Workerd test: a compaction closes and opens; resume touches the live chapter only; the baseline and change notes unchanged; Subagents keep their chapter; the migration
- [x] The scale test's Turn-wake budget passes

## Closing note

apps/worker/test/chapters.test.ts covers the boundary, the resume, memory, Subagents and the upgrade. The scale test now seeds its year as 400 chapters through the real close (each span's compaction closes its chapter); its Turn wake is an it: 623 ms and 2 354 session rows (was 3.8 s and 1 168 782), the agent resume reads 373 rows from the live chapter (was 146 039). Its Trajectory budget passes too, because GET trajectory shows the live chapter now (ticket 04 adds the others).

Decisions:
- Chapters are a table of their own (apps/worker/src/robot/chapters.ts: ordinal, parent and the parent seq it was seeded from, first own seq, cut, opened, closed at and by, superseded), not columns on session_log. session_log stays DSH's persistence record and also holds Subagent sessions, which are not chapters; a separate table leaves no column that is meaningless for them.
- The seed is not DSH's fork seed. A fork seed copies the whole prefix, so a chapter seeded that way would be as long as everything before it. The seed (apps/worker/src/agent/chapter-seed.ts) is DSH's surface at the end of the closing chapter, each message written again as an append (the system prompt, the checkpoint and what came after it), with the latest request header, inside a closed Turn that keeps DSH's turn numbers going, ending in the inherited marker. inheritedEventCount is the marker's seq: DSH refuses an inherited count longer than the seed, so the spec's "inheritedEventCount = the parent's length" cannot hold; the parent's last seq is kept as the chapter's parent seq instead. DSH validates the seed before it is stored (Session.create); a seed it refuses leaves the chapter live, as before chapters.
- The chapter closes at a Turn boundary, not inside the compaction: DSH compacts within a Turn and the agent keeps running on its session. A compaction marks the live chapter; it closes after the Turn ends, after an idle compaction, or before the next Turn if the Robot slept in between, and only when no Subagent runs in it. The new session and the switch to it are written in one transaction.
- Memory: the baseline marker follows the context into the new chapter, so the plugin injects exactly what it would have after the compaction (one baseline, then change notes). A Subagent's compaction no longer clears the Robot's own baseline marker.
- The upgrade registers every Robot session as a chapter, ordered by creation, linked by the old rewind rows; sessions off the chain to the live one (undone Rewinds) are superseded. Ticket 05 builds on this.
- Readers moved to chapters where the Turn path would otherwise read the history: the Turn's end reads only its own items, the registry's last line reads the newest chapters, the resume reads the live chapter. The chat still folds every chapter of the chain (ticket 03 makes it a table), search covers every chapter of the chain and indexes a chapter that is behind at the first search, the Subagent list covers the chain. A Rewind before a delegation now keeps the earlier delegation in the list: its chapter is still part of the Conversation up to the cut (subagents.test.ts updated).
