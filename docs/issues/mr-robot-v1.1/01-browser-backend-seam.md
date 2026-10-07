# 01: Browser backend seam and per-robot backend choice

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-wgtd, rb-ybt4, rb-b3yf, rb-bcui, rb-4n0b, rb-kank, rb-y50l

**What to build:** A robot's advanced settings let the owner pick its browser backend; the Home has a default. Browser Run, as implemented today, becomes the first backend behind one seam that owns the robot's browser tools, cookies and storage, screenshots, live view and takeover; a backend supplies only a CDP Chrome and its usage. Browser minutes are recorded per backend into usage and spend limits. The observe step recognises bot-check and block pages and the robot reports the block with the backend name instead of retrying.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Robot DO test: switching backend keeps cookies and storage across the next open
- [x] Advanced settings and Home settings show and save the backend choice
- [x] Usage shows browser minutes per backend and counts them against limits
- [x] A block page fixture produces a robot report naming the backend; no retry loop
- [x] Browser Run behaviour on the live deployment is unchanged

Verified 2026-10-07:
- Robot DO tests (browser-backends.test.ts): a Robot follows the Home default until it picks its own backend; after switching to another backend the next open goes there and the login carries over; browser time per backend appears in usage; a block page is reported with the backend and a second open of the same site in the Turn is refused.
- Staging on real Browser Rendering (15 checks): a "You have been blocked" page and a DataDome iframe page are both classified as blocked.
- Live: a Robot on Browser Run opened allegro.pl; the tool reported "This page blocks your browser (Browser Run)" and the Robot told the owner without retrying. Its panel showed 0.2 browser min (Browser Run) in usage. Advanced settings show the Browser choice with the Home default and each backend's note; Admin has the Home default. Container backends are listed as not available until ticket 02 deploys them.
