# 02: Provider accounts: many per Provider, shared one by one

**Parent:** mr-robot-v1.10 (../mr-robot-v1.10.md) — stories pa-i3le, pa-f281, pa-mdlk, pa-cv06

**What to build:** Each Provider holds many accounts per person with labels and per-account sharing; existing credentials and OpenCode keys migrate; the profile lists accounts per Provider with Add account; Robots keep running on the first usable account of their Provider until ticket 03.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] account table and migration; Home provider_account index
- [ ] API and Profile UI: add many, rename, share, remove
- [ ] OpenCode pool code removed; workerd tests for many accounts, sharing, migration
