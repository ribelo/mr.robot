# 06: Cold chapters in R2

**What to build:** The tidy pass moves chapters outside the window (last 30 chapters or 60 days, whichever keeps more) to R2 one object each, deletes their event rows, keeps chat items; a cold chapter's Trajectory loads from R2 on demand; delete and the resets remove the prefix (ec-4qsf, ec-aly5, ec-2rdv, ec-cgsl).

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] Workerd test with the R2 stub: the move at the window, the cold Trajectory, delete and resets
- [ ] The scale test passes with cold chapters present
