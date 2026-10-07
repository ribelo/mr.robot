# 04: Takeover and live view open the browser on demand

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-keaw, rb-yvct, rb-hq0l

**What to build:** Opening the takeover window or the live view when no browser session is open starts one on the robot's backend at its last page with its state restored, so the owner never waits on 'Waiting for the screen'. The panel thumbnail and the takeover window show the same screen. The browser closes again after hand-back when no turn needs it.

**Blocked by:** 01 Browser backend seam and per-robot backend choice

**Status:** ready-for-agent

- [ ] Live: takeover on an idle robot shows its last page within seconds
- [ ] Panel live view and takeover show the same frames
- [ ] After hand-back with no turn the session closes and minutes stop
- [ ] Works on every backend available at the time
