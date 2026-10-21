# 07: Glossary and docs

**What to build:** The glossary defines Chapter, Live chapter, Cold chapter and Superseded chapter and redefines Conversation, Trajectory and Rewind; docs/mr-robot.md and docs/memory-and-files.md updated (ec-7f03, ec-74sf).

**Blocked by:** 02, 03, 04, 05, 06

**Status:** done

- [x] GLOSSARY.md and the docs updated

## Closing note

GLOSSARY.md defines Chapter, Live chapter, Superseded chapter and Cold chapter and redefines Conversation, Trajectory and Rewind by them. The product docs the Robots read are apps/worker/src/docs/mr-robot.ts and memory-and-files.ts (published to the Workspace as docs/mr-robot.md and docs/memory-and-files.md): the first now says what a chapter is, what a Rewind does (no note, the label on the next Wake-up, no undo, superseded chapters) and what cold storage means; the second says how the memory message crosses a chapter boundary. The docs test's 900-word limit holds. The README's layout line names chapters, the stored chat and cold chapters.

The platform prompt's line "After a rewind they still stand" stays true and was left as it is. A flaky clean-up in the Fleet test (box.test.ts) finished a Job that was a plain run under load; it now finishes the Job only when the command was spawned.
