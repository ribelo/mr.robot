# 04: Takeover and live view open the browser on demand

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-keaw, rb-yvct, rb-hq0l

**What to build:** Opening the takeover window or the live view when no browser session is open starts one on the robot's backend at its last page with its state restored, so the owner never waits on 'Waiting for the screen'. The panel thumbnail and the takeover window show the same screen. The browser closes again after hand-back when no turn needs it.

**Blocked by:** 01 Browser backend seam and per-robot backend choice

**Status:** done

- [x] Live: takeover on an idle robot shows its last page within seconds
- [x] Panel live view and takeover show the same frames
- [x] After hand-back with no turn the session closes and minutes stop
- [x] Works on every backend available at the time

Verified live 2026-10-07 on Browser Check:
- Container Chrome: the Robot opened en.wikipedia.org/wiki/Warsaw and ended its Turn (browser closed). Opening the takeover window showed that page within 10 s; closing the window saved a new screenshot (the panel thumbnail), container minutes stayed at 14.6 and the container application reported 0 active instances.
- Browser Run: after switching the backend, the takeover window opened the same page (cookies and last page carried over); Browser Run minutes went 0.3 → 0.4 and stopped after closing.
- The panel thumbnail is the screenshot saved when the browser last closed; the takeover window streams the same page live. The owner can also take an idle Robot's browser without being asked; hand-back then closes it without waking the Robot (Robot DO test takeover.test.ts). A browser opened by a Turn stays open while someone watches and closes when they leave.
