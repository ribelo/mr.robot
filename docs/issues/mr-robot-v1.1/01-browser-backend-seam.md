# 01: Browser backend seam and per-robot backend choice

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-wgtd, rb-ybt4, rb-b3yf, rb-bcui, rb-4n0b, rb-kank, rb-y50l

**What to build:** A robot's advanced settings let the owner pick its browser backend; the Home has a default. Browser Run, as implemented today, becomes the first backend behind one seam that owns the robot's browser tools, cookies and storage, screenshots, live view and takeover; a backend supplies only a CDP Chrome and its usage. Browser minutes are recorded per backend into usage and spend limits. The observe step recognises bot-check and block pages and the robot reports the block with the backend name instead of retrying.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Robot DO test: switching backend keeps cookies and storage across the next open
- [ ] Advanced settings and Home settings show and save the backend choice
- [ ] Usage shows browser minutes per backend and counts them against limits
- [ ] A block page fixture produces a robot report naming the backend; no retry loop
- [ ] Browser Run behaviour on the live deployment is unchanged
