# 01: Connector core, Plugins page, per-plugin settings rows

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-dbm9, cn-s1pd, cn-a1i0, cn-qs78, cn-xezx, cn-bsge, cn-f6ux

**What to build:** Connections per Member (private or Home-shared), granted per robot, secrets in the vault as credential references, configuration per plugin derived from its schema; a Plugins page with on/off per Home and a settings page with one row per plugin (status, Connect/Manage) as in the DSH references; tools take an account parameter when several connections exist; every connector call recorded in the trajectory with secrets masked.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Plugins page and settings rows render from plugin schemas; adding a plugin adds its row without UI code
- [ ] Robot DO test: an ungranted connection is invisible to the robot; a Home-shared one is usable by another Member's robot once granted
- [ ] Secret fields never appear in configuration, logs or trajectory
- [ ] Account parameter routing verified with two fake connections
