# 08: Browser Rendering provider with Leash primitives

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-l9te, robot-t0vc, robot-b49q, robot-0eew

**What to build:** A robot opens a page in Cloudflare Browser Rendering, observes it, acts on it and takes screenshots through the browser-use seam, using the Leash primitives ported to Effect. Cookies and storage are saved to the Robot DO when the browser closes and restored when it opens, so the robot stays logged in across wake-ups. The robot panel shows the last screenshot as its screen thumbnail. Ordinary CAPTCHAs are solved by the robot itself.

**Blocked by:** 07 Code mode executor, tool grants, advanced settings

**Status:** in-progress

- [ ] Integration test on staging: open, observe, act, screenshot against a fixture site
- [x] Login state survives DO hibernation and a new browser session
- [x] Browser session is closed when the turn ends and no browser-use call is pending
- [x] Thumbnail in the panel updates after each screenshot


**Pending:** The integration test exists (apps/worker/test/integration); it needs a deployed account to run.
