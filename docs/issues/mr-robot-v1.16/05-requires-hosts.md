# 05: A Robot that waits for its Hosts

**What to build:** A Robot setting requiresHosts, off by default: a recurring Task that finds any of the Robot's Hosts offline ends its Attempt as failed with the Host named, without a Turn, and notifies once per outage; a scheduled Task parks and runs on the Host's return if the deadline allows, else fails; owner and Robot messages always wake the Robot (ob-5nvd, ob-qgpy, ob-e271, ob-amlz). The setup interview proposes the setting when the Robot asks for a Host facet (ob-kvw3).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test: recurring fails without a Turn and notifies once across two misses; scheduled parks and runs on the online event; scheduled fails at the deadline; an owner message wakes the Robot (ob-5nvd, ob-qgpy, ob-e271, ob-amlz)
- [ ] Component test: the switch in Robot settings (ob-5nvd)
- [ ] The setup prompt proposes the setting with a Host facet (ob-kvw3)
