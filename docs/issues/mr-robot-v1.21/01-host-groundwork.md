# 01: Host groundwork: environment, policy from grants, protocol version, Workspace session

**What to build:** The Host app captures the OS user's login environment at start (scrubbed, allow-listed), builds the sandbox policy per call from the facet grant, carries protocolVersion in the heartbeat (the Worker refuses Workspace RPCs on an older app), and keeps a Workspace session per Robot with the lifecycle; Linux service processes without a user manager; Node tests for all of it (cw-jn59, cw-et7q, cw-dkkw, cw-o4fr, cw-omrg, cw-p4bm, cw-9026).

**Blocked by:** None (can start immediately; needs v1.20 merged)

**Status:** ready-for-agent

- [ ] Host Node tests: environment capture and allow-list; policy from a grant; session lifecycle; version in the heartbeat
- [ ] Workerd test: the Worker refuses a Workspace RPC on an older protocol version with the sentence
- [ ] docs/hosts.md says what git credentials are and what a service Host lacks
