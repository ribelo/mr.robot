# 18: Channel seam with the PWA as first adapter

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-9xoj

**What to build:** Channels are an adapter contract: inbound events become wake-ups on the robot's conversation, robot output and notifications go to every enabled channel, replies return to the channel the message came from. The PWA channel is re-expressed through the contract and a contract test suite exists so that Discord can be added as a second adapter after v1 without touching the robot.

**Blocked by:** 11 Web Push and notification settings

**Status:** ready-for-agent

- [ ] PWA chat and push run through the channel contract
- [ ] Contract test suite passes against the PWA adapter and a fake adapter
- [ ] Robot settings list enabled channels per robot
