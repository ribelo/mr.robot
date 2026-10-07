# 03: Host browser behind the browser seam

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-mqwd, hs-3wqx, hs-zmbc, hs-43aj, hs-1fp6, hs-nwcl, hs-8teq, hs-fnpy

**What to build:** The app launches the installed Chrome with a dedicated profile and a visible window and exposes CDP over the channel; the Robot DO offers it as backend 'Host browser: <name>' with the same tools, cookies kept in the host profile, block detection, usage (host minutes), live view and takeover relayed through the app. A robot on an offline host reports and notifies instead of using a cloud browser. The Allegro run (search, open offer, add to cart, stop before payment) is executed on the owner's host and recorded here.

**Blocked by:** 01 Host app, pairing, registry, channel

**Status:** ready-for-agent

- [ ] Robot on 'Host browser: <owner's PC>' opens, observes, acts, screenshots
- [ ] Live view and takeover from the PWA work on the host browser
- [ ] Allegro run recorded with result
- [ ] Host offline: robot reports, owner notified, no cloud fallback unless configured
- [ ] Usage shows host browser minutes
