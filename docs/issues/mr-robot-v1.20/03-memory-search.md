# 03: memory_search and the end of note injection

**What to build:** A full-text index over the indexed set in the Robot's SQLite, updated by every writer and restore, built bounded on the first Turn after the upgrade; memory_search with ranked matches (path, lines, snippet, date); Subagents read-only; daily notes out of the baseline; the prompt's search rule; limits recorded (dm-cl1p, dm-hmet, dm-yn3q, dm-vh11, dm-g4in, dm-zpoo).

**Blocked by:** 00

**Status:** done

- [x] Workerd test: baseline without notes; search fields and ranking; reindex on each writer; bounded initial index; the child's tool
- [x] Scale test extended with search on a year of notes

## Closing note

apps/worker/test/memory-search.test.ts: the memory message has no daily note and the prompt names memory_search; the ranked match carries path, lines, date and snippet; a file outside the indexed set is not found; the owner's edit, a restore and a delete reindex at once; USER.md and SPACE.md are found by content; 150 notes of a Robot from before the index take two Turns (100, then the rest); a Subagent's request has the tool. scale.test.ts: 365 daily notes, an early and a late word found in about 5 ms each, catch-up included (the v1.19 numbers stayed where they were).

Decisions:
- The index is robot/memory-index.ts: an FTS5 table memory_index (LIKE where FTS5 is missing, as conversation search does) with one row per paragraph (blank lines separate them, a heading starts one), and memory_indexed with each file's version (its R2 etag; for the Member and Space files, a hash of the content). Ranking: bm25, then the newest note; a word matches as written and as a prefix; the words are joined with OR.
- Writers: makeWorkspace takes an onChange callback, so every Workspace write and delete (the Robot, the owner, the snapshot, the sweep, a restore) reindexes the file at once; a streamed write marks it stale. The Member files and SPACE.md are written in other Durable Objects, so they are compared by content at each catch-up. The catch-up runs at every Turn's start and before every search, at most 100 files.
- Daily notes left the memory message and the persona snapshot. An owner's edit of a daily note no longer makes a change note (there is nothing in the context to replace). The time-zone test for daily notes in the baseline is deleted: that behaviour is gone.
- The prompt line is one sentence ("call memory_search, never your impression") to stay inside the 2 900-word budget; reading today's note with read is in the tool's description and the memory skill.
- Limits, recorded in memory-index.ts: full text only, no vectors; no stemming for English or Polish.
- The index object is made again when its tables are gone (Reset everything and Start over drop every table).
