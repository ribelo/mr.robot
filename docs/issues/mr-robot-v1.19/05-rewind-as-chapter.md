# 05: Rewind as a chapter, no ghost, no undo

**What to build:** Rewind opens a new chapter seeded from the chosen point in the live or an older chapter; later chapters are superseded and readable, greyed; no synthetic message in the seed; the external-effects notice rides as the next Wake-up's label; undo removed; old rewind archives migrated as superseded chapters (ec-i74p, ec-utsf, ec-cc6i, ec-eaz3).

**Blocked by:** 04

**Status:** done

- [x] Workerd test: rewind in the live chapter and in an older one; superseded marking; the seed holds no synthetic message; the label on the next Wake-up; undo endpoints gone; migration of old archives
- [x] Component test: superseded chapters greyed in the picker

## Closing note

rewind.test.ts (a Rewind in the live chapter and into an older one; superseded marking; no note in the seed; the label on the next Wake-up and only on it; undo gone), chapters.test.ts (old archives and an undone Rewind registered as chapters, ticket 02's migration) and apps/web/test/trajectory-chapters.test.tsx (a superseded chapter greyed in the picker, with its line under the bar).

Decisions:
- A Rewind seeds its chapter the way a compaction does (chapterSeed): what the model saw at the point, written again as a fresh log. When the point falls between a tool call and its result, the seed ends before that call, so the model never sees a call without an answer. DSH validates the seed first; a point it refuses is a 409.
- POST rewind takes chapter (an ordinal) beside atSeq or beforeTurn; without it, the live chapter. The point must be one of the chapter's own events. A superseded chapter is read-only: rewinding to it is a 409, and the Trajectory page hides Rewind… for it. The Rewind sheet lists the Turns of the chapter shown.
- The chapter rewound to is cut at the point; the live chapter closes "by a Rewind"; every chapter after the point is superseded. The rewind row is still written (the RewindView answer), so the history of Rewinds stays in the store.
- The label: "[Rewound to <time>: external effects since then stand: you used <tools>; check the real state before you repeat or contradict anything]", the tools being those called after the point in that chapter and in every chapter it supersedes (read with one SQL query per chapter, no JSON parsing), at most 12 named. It is stored, and the next Turn's first Wake-up carries it after its time label, then it is deleted. The chat's member label pattern drops it with the time.
- The chat shows a notice "Rewound to <time>. What came after is kept, greyed, in the Trajectory." in the new chapter.
- Removed: undoRewind (program, RPC, endpoint, PWA client and button), the platform's seedSession and the composition's seed input (a seeded chapter is stored whole before its first Turn and resumed like any session), ChapterStore.restore and archivedTrajectory.
- Subagents started after the point (in the rest of that chapter and in the live chapter) are archived as before.
