# 01: The scale test, run against today

**What to build:** A workerd test scale.test.ts seeds a year of a busy Robot through the persistence seam (about 150 000 events in 400 spans of realistic sizes) and drives the system through the edge API with the scripted model, asserting row and time budgets for opening the chat, loading a page, waking a Turn, opening a Trajectory span and searching; budgets are named constants with their reasoning; the numbers are printed. Run it first against today's code: the failures and the measured numbers, including whether DSH's resume reads from zero or from the checkpoint, go in this ticket's closing note (ec-2lts, ec-o5pz, ec-olsc).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The test exists, seeds the year, prints its numbers, and fails on today's code where the budgets are exceeded
- [ ] Closing note: the numbers today, and the resume finding
