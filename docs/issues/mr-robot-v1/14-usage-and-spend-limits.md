# 14: Usage accounting and spend limits

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-vfqd, robot-vqtw, robot-x26m

**What to build:** Every turn's tokens and cost are accumulated per robot and per Member. A monthly spend limit per robot (default from the Home) and per Member stops a robot that crosses it: it enters blocked: limit, notifies the owner, and resumes when the limit is raised. Usage is visible per robot.

**Blocked by:** 13 Providers, subscriptions and per-robot model

**Status:** ready-for-agent

- [ ] Token meter per turn sums to the robot and Member counters
- [ ] Crossing the limit mid-turn finishes the turn and blocks the next wake-up
- [ ] Raising the limit unblocks and queued wake-ups run
- [ ] Usage view shows the current month per robot
