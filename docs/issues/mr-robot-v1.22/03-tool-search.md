# 03: tool_search, the index, the evaluation set, the measurement

**What to build:** tool_search ranks the mounted, grant-filtered tools with weighted keyword search, lifts the restriction on its matches and returns their names with one line each (DSH announces the declarations); the index built at composition and on grant change; the evaluation set and its recall test; the token and cache measurement on both routes; Trajectory rendering; prompt and docs.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Workerd test: a found tool is declared by DSH's tool-addition message, verbatim, and callable in the next program; nearest names on a hidden tool; grant filtering; recall@5 ≥ 0.9 on the evaluation set
- [ ] Component test: the Trajectory rendering
- [ ] Closing note: tokens before and after, the weights and their measurement
