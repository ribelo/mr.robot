# 02: Chapters: a compaction opens the next session

**What to build:** session_log gains the chapter columns; a compaction closes the live chapter and opens the next session seeded with the checkpoint and the memory baseline, inheritedEventCount set, liveSessionId switched; the Robot resumes on the live chapter alone; memory behaves as before; Subagent sessions belong to their chapter; a migration registers existing sessions as chapters (ec-7oq8, ec-srfn, ec-7s3l, ec-ndqf, ec-h8ib).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test: a compaction closes and opens; resume touches the live chapter only; the baseline and change notes unchanged; Subagents keep their chapter; the migration
- [ ] The scale test's Turn-wake budget passes
