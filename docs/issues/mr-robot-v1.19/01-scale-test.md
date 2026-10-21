# 01: The scale test, run against today

**What to build:** A workerd test scale.test.ts seeds a year of a busy Robot through the persistence seam (about 150 000 events in 400 spans of realistic sizes) and drives the system through the edge API with the scripted model, asserting row and time budgets for opening the chat, loading a page, waking a Turn, opening a Trajectory span and searching; budgets are named constants with their reasoning; the numbers are printed. Run it first against today's code: the failures and the measured numbers, including whether DSH's resume reads from zero or from the checkpoint, go in this ticket's closing note (ec-2lts, ec-o5pz, ec-olsc).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The test exists, seeds the year, prints its numbers, and fails on today's code where the budgets are exceeded
- [x] Closing note: the numbers today, and the resume finding

## Closing note

apps/worker/test/scale.test.ts seeds 146 000 events (91 MB of JSON, 400 spans of 19 Turns of 19 events and a compaction checkpoint each, spread over 365 days) into one Robot's live Conversation through SqliteSessionLog (the persistence seam), restarts the Robot, and then measures through the edge API and the Robot's RPC. Rows are counted at the Robot's SQLite: the test Robot wraps its storage's exec and sums each cursor's rowsRead (test/sql-reads.ts); "session rows" are statements on session_event, session_log, chat_item or chat_search. The generator is test/scale-year.ts; its event shapes are the ones a real Turn on the scripted model writes (captured once while writing the test).

Numbers on today's code (local workerd, the full suite running beside it):

| measure | time | session rows | note |
|---|---|---|---|
| seed | 3.1 s | | 146 000 events, 91 MB |
| chat open (GET conversation) | 486 ms | 146 081 | returns all 23 203 items |
| chat page 2 (conversationPage RPC) | 396 ms | 146 039 | 20 items |
| Trajectory (GET trajectory) | 481 ms | 146 039 | status 500: the 89 MB answer is over the 32 MiB RPC limit, so the Trajectory of a year-old Robot does not open at all |
| Trajectory events page (GET events?limit=400) | 76 ms | 400 | inside the budget |
| search, early and late word | 3 ms each | 4 | inside the budget |
| agent resume after a restart | 545 ms | 146 132 | |
| Turn wake after a restart | 3.8 s | 1 168 782 | the whole log is read about 8 times in one Turn |

Resume finding: DSH resumes from zero. The agent loop's resume calls handle.read(0) and holds every event in memory (dsh-agent-loop, resumeWith), and the measurement shows it: one read from seq 0 of 146 039 rows. The checkpoint does not bound it; only a short live session does.

Decisions:
- Budgets are constants at the top of the test with their reasoning: chat open and page 200 session rows and 500 ms (the spec's numbers), Turn wake 5 000 rows and 3 s, a Trajectory page 1 000 rows and 1 s, search 500 ms. The chat page is measured through conversationPage today because the edge has no paged chat yet; ticket 03 moves it to the edge cursor.
- The four budgets today's code exceeds (chat open, chat page, Trajectory, Turn wake) are it.fails, so the suite stays green and the failure is recorded; the ticket that fixes each turns it into it.
- The seeded texts are smaller than the spec's 0.5 to 1 MB a day (about 0.25 MB a day) so that the guard stays a 10-second test; the event count, which is what the readers scale with, is the spec's.
