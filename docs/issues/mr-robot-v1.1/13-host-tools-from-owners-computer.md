# 13: Host tools from the owner's computer

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories (postponed; spec Out of Scope)

**What to build:** As Grok Bot does when its desktop app runs: a connector in this repository registers the owner's computer as a second execution place beside the cloud box, over an outbound connection, available while the computer is on. Robots see box tools (box_read, box_write …) and host tools (host_read, host_write, host_run/bash) and can drive Leash for a real home browser. Postponed: the product must work without the computer first.

**Blocked by:** 01 Browser backend seam and per-robot backend choice

**Status:** postponed

- [ ] Computer online shows as available in the panel; host tools appear only for granted robots
- [ ] Computer offline: host tools absent, nothing fails
