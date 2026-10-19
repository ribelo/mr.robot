# 01: DSH 0.2.1-rc.2 upgrade

**What to build:** The Worker and the PWA build on DSH 0.2.1-rc.2 (ao-ejub, ao-ggzv, ao-wzw9). Every @deepseek-ai/dsh-* dependency moves together; the spill, spill-policy, tool-subagent (in-process spawn and fork), subagent-control packages become available to later tickets but are not yet mounted. A person opens an existing Robot after the deploy and its Conversation and Trajectory render and continue.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] All DSH packages at 0.2.1-rc.2; pnpm test green in workerd and the PWA
- [ ] Dependency lint passes: no Node-bound DSH package, no Effect inside DSH packages in the Worker bundle (ao-ggzv)
- [ ] Workerd test: a session log written by the previous version renders and a new Turn appends to it (ao-wzw9)
- [ ] Breaking API changes between 0.2.0-rc.2 and 0.2.1-rc.2 listed in the ticket's closing note
