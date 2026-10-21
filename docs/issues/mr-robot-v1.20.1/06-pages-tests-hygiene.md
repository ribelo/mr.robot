# 06: People pages, flaky tests, robot.ts hygiene, remaining notes

**What to build:** Decisions 14, 15, 16 and 17.

**Blocked by:** 01, 03

**Status:** done

- [x] Workerd test: the owner deletes and restores a people page; two Robots' INDEX.md writes serialize
- [x] The two timing-bound tests poll state; requires-hosts asserts a counted Host; the plan test asserts renamed_classes
- [x] The memory index, people and dream host methods live in their plugins' modules; closing note with robot.ts line count before and after
- [x] Every remaining note or drift finding of the four reviews is either fixed or recorded as accepted with one sentence, in the closing note

## Closing note

**People pages** (v1.20-review #3, #18, #31a, #33, #34). The owner now deletes and restores a people page through the Files routes:
- A delete removes the Member row and keeps the last version in the history. A delete of a page that does not exist answers 404 instead of a false "deleted".
- A restore writes the version back as a new version by the owner.

people-pages.test.ts covers this in both modes, with two Robots writing two pages at the same moment: INDEX.md lists both. INDEX.md is serialized by the Member DO and was already sound (#34). The lost update of two Robots editing one page (#18) is accepted: a page is written whole, and the dropped text stays in the history as a version. The only remedy is a compare-and-set the spec does not ask for. files.ts now reports only the refusal as read-only; any other failure of the Member DO is passed on as it is (#33).

**Tests** (cross-review #14, #15, #16; v1.18-review #24):
- requires-hosts: drop() polls the Space until the Host is offline, instead of a fixed 100 ms pause. The facet test now also drops the held Host and asserts that the next occurrence does not run.
- I tried asserting runDurableObjectAlarm's boolean (#16), and it failed under load: the alarm can ring by itself before the call, which then answers false. So it is not asserted, with a comment why.
- The Box spend test already polled with vi.waitFor and stays as it is.
- The plan test asserts the namespace keeps the logical id Home with the class Space, which is what Alchemy's provider turns into renamed_classes (alchemy WorkerProvider.js, "previousClassName !== binding.className"). Alchemy computes the migration only at deploy, from the live account's DO tags, so the offline plan has no migration to assert. This item is done as far as the plan can show it.

**robot.ts**: the memory index, its catch-up and search, the people-page host methods, and the dream's route, evidence and tidy moved to robot/robot-memory.ts (RobotMemory). Line counts:
- 4,524 after v1.20;
- 4,621 before this ticket, because v1.20.1 01–05 added the Turn slot, crash-ordered clear, masks and scrub ordering;
- 4,541 after the move;
- 4,561 with the owner's people-page delete and restore.

robot.ts remains the largest file. Further splits (Box, Pages, files) are not in this spec.

**Fixed in passing, one line each:**
- cross #9: the Box door refuses a body over 64 KB before reading it.
- cross #17: typecheck now compiles packages/protocol.
- cross #20: only the owner stops the Box.
- v1.20 #22: the dream's skip rule counts every Attempt closed since the last dream, as the spec says. The note still lists only the failed and skipped ones.

**Accepted, with why.** Cross-cutting:
- #7: the browser probe is admin-only and manual.
- #8: pairing codes are about 45 bits and expire in 15 minutes. Rate limits and sealing the token at rest belong to a security pass, not to this fix release.
- #10: v1 login entries predate v2 and are rewritten on their next save.
- #11: memory steps and warming run before a limit check. A blocked Robot's next Turn stops at the limit, and the steps are bounded.
- #13: the safety net has no allow-list by design ("speak now"). Its step count is exact since ticket 01.
- #18: boot migrations are idempotent. The two-statement merge repeats safely.
- #19: the unreachable help-Ask branch is kept for old open Asks.

v1.20-review:
- #10: a restart inside a platform step can replay its instruction once. This is recorded in ticket 01.
- #12: an unavailable dream model blocks the night's Turn, and the owner sees "blocked" and changes the model. A silent fallback would hide the setting.
- #13: a dream that waited runs after the Turn it waited for, still under its fence.
- #14: the first 03:00 after the key is set is planned, not run. One night is lost once per Robot.
- #15: a time-zone change takes effect after the next dream hour.
- #17: writtenBy's HEADs per idle cycle are bounded by the tracked set.
- #19: with the Space default off, a Robot without its own setting wakes at 03:00 and does nothing (ticket 03).
- #21: the dream is a Turn in the live chapter, not a chapter of its own. Opening a chapter for it would close the person's chapter every night.
- #23: the docs name the memory steps' tools as the fences do since ticket 01. The scrub's tools are the same file tools.
- #24: _template.md is the platform's template, not memory, and is not indexed.
- #25: idleCompaction false with warming still closes at 216. This was decided in v1.20 02 (warming implies the close).
- #26–#31 are covered by tickets 01–06.
- #32: the line count is above.

The v1.18-review and v1.19-review notes are recorded in tickets 05 and 04.
