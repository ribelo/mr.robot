# 04: Chain walking and account state

**Parent:** mr-robot-v1.10 (../mr-robot-v1.10.md) — stories pa-kvsr, pa-q0dg, pa-14yx, pa-dus3, pa-gqff, pa-bc78, pa-hq0v

**What to build:** Limit and broken failures are classified; the Robot moves to the next usable entry with a line and continues; it returns when an earlier entry recovers; all-unusable blocks and resumes by alarm; broken accounts notify once, recover after 6 hours or with Check now.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Workerd tests: 429 with reset → switch, line, continue, return after reset; 401 → broken, one notification, 6-hour retry, Check now; all unusable → blocked and resumed by alarm
