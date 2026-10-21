# 02: Declared versus bound: the fixed set and the renderer

**What to build:** Every tool registered as today; DSH's restrict applied at composition so only the fixed set (say, ask, react, skill, request_credential) and tool_search are visible and callable; a chapter seed and a fenced step and a Subagent start restricted the same way; a call to a hidden tool fails with "not available; search for it". No harness change.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test: a fully granted Robot's SDK block holds the fixed set only; a hidden tool called by name fails with the message; a chapter seed, a fenced step and a child start restricted
- [ ] No dependency patch exists; DSH's tool-update path is what declares a found tool
