# 03: The memory sweep before idle compaction

**What to build:** The bounded step before idle compaction becomes the memory sweep with its instruction; skipped when no daily note changed since the last sweep; writes carry author sweep and are versioned; the Trajectory records what changed (rm-glmd, rm-5org, rm-hhxa, rm-l4t8).

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] Workerd test: the sweep runs with its instruction on the Robot's model before idle compaction and never during a Turn; skipped without changed notes; writes versioned as sweep; Trajectory entry (rm-glmd, rm-5org, rm-hhxa, rm-l4t8)
