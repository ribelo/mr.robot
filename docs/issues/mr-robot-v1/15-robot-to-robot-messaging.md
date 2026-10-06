# 15: Robot-to-robot messaging and Mr. Robot coordination

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-hk2s, robot-70kf, robot-i3et, robot-bsvs, robot-mv15, robot-ppzu, robot-bjq5, robot-eiin

**What to build:** A robot lists the robots it may message, sends a work request to a granted recipient, and gets the reply in its own conversation; the recipient sees a labelled robot message and runs an unattended turn. Recipient grants are approved by the Member. Mr. Robot uses this to create, configure and task other robots when the Member asks it to. No subagents exist.

**Blocked by:** 07 Code mode executor, tool grants, advanced settings

**Status:** ready-for-agent

- [ ] Directory shows only granted, reachable, active robots
- [ ] Request without recipient grant is refused; reply needs no reverse grant
- [ ] Outbox survives DO hibernation and delivers once (idempotency key)
- [ ] Chain cap and queue cap enforced
- [ ] Robot messages render with sender avatar and name
