# 02: Input validation before any call

**Parent:** mr-robot-v1.8 (../mr-robot-v1.8.md) — stories ts-6z2k, ts-3d3n, ts-lnox, ts-nivs, ts-yf1d

**What to build:** delete_file throws when the file does not exist. calendar_events refuses a start after its end. schedule_create refuses after_seconds under 60. robot_directory returns { robots: [], hint } instead of prose. exa_agent_list_events and every tool with required parameters validate them before calling a service, with an error naming the parameter.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd tests for each listed case
- [ ] Error messages name the parameter and the rule
