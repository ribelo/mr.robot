# 05: Marketplace and definitions

**What to build:** Decisions 10, 11, 12 and 13. Findings: v1.18#1, #2, the malformed-form deletion, the scrub ordering and confinement, presigned writes bypassing history, the trim on write only, the unbounded Grok fetch.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test: Add returns a RobotSummary and a repeated Add does not create a second Robot; the admin sees unpublished definitions of a Member; a malformed repository form keeps the last good definition and shows the error
- [ ] Workerd test: the scrub runs after tasks.yaml and README exist, writes only under the staged prefix, and publishing without a completed scrub is refused
- [ ] Workerd test: presign refused for a tracked path; the trim runs in the tidy pass
- [ ] Workerd test: the Grok fetch refuses another host, a body over 5 MB and a slow server
