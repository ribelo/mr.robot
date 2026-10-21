# 04: Trajectory per chapter

**What to build:** The trajectory endpoint takes a chapter and returns its events with the chapter list; Previous, Next and a picker in the PWA; an old chapter loads its own events only (ec-mwvo, ec-elhb).

**Blocked by:** 02

**Status:** done

- [x] Workerd test: the chapter list and one chapter's events
- [x] Component test: Previous, Next, the picker
- [x] The scale test's Trajectory budget passes

## Closing note

chapters.test.ts (the list with dates, Turns and reason; one chapter's own log by GET trajectory?chapter= and GET events?chapter=; 404 and 400) and apps/web/test/trajectory-chapters.test.tsx (Previous, Next, the picker). Scale test: the Trajectory of the live chapter and of chapter 200 read 740 session rows each (the chapter, plus counting the live chapter's Turns), the events page of chapter 200 373; was a 500 over the RPC limit.

Decisions:
- The chapter is a query parameter (?chapter=<ordinal>) on the two existing endpoints, GET trajectory and GET events; without it they show the live chapter, so the DSH trajectory view and the Rewind sheet work as before. Trajectory now carries chapter and chapters (ChapterView: ordinal, session, opened, closed at and by, superseded, Turns, first own seq).
- The Turns of a chapter are counted when it closes and stored (a new column); the live chapter's are counted on each request (a LIKE on the stored event's type, one chapter of rows); chapters registered by the upgrade are counted once, the first time they are listed.
- The PWA shows the chapter bar (ChapterBar) above the DSH view when there is more than one chapter; a picked chapter's view does not read again on live changes, since a closed chapter does not change. A superseded chapter is already marked in the picker and under the bar; ticket 05 makes them.
- The Fleet test from ticket 03 now holds the Box command both as a run and as a Job: a foreground command runs as a Job the tool waits for, and the plain run that the hold covered is used only at boot, which made it pass or fail by order.
