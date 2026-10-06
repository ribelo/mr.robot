# 17: Admin view

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-d2uv, robot-r2uz, robot-bden, robot-vfqd, robot-bvme

**What to build:** The Home admin sees all robots with their state (sleeping, working, waiting for you, paused, blocked), all routines across robots, members (invite, remove), providers and subscriptions, skills, grants and costs in one place.

**Blocked by:** 06 Routines on Durable Object alarms; 13 Providers, subscriptions and per-robot model; 14 Usage accounting and spend limits; 16 Home skill library and per-robot skill grants

**Status:** ready-for-agent

- [ ] Fleet list reflects live DO state
- [ ] Cross-robot routine list with next runs
- [ ] Invite creates a pending Member accepted on first sign-in; remove revokes access and pauses their robots
- [ ] Cost table matches the Member and robot counters
