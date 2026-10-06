# 03: A Robot Durable Object runs one turn

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-frf5, robot-q4b2, robot-acr3, robot-ifp6, robot-c8hq, robot-naul, robot-p9jm

**What to build:** A single pre-seeded robot exists; the Member opens its conversation in the PWA, types a message, and the robot answers. Inside: the DeepSeek Harness Cordis tree (session, agent loop, system prompt, tools, llm, compaction, token meter) is assembled inside the Robot DO with an Effect-owned scope, the session log is persisted to DO SQLite through a Mr. Robot persistence plugin, the DeepSeek API is the provider, and the turn runs under the DO so closing the PWA mid-turn does not stop it. Short instructions get a thumbs-up reaction instead of a reply bubble when the robot chooses so. The conversation renders in the simple chat style of the reference screens.

**Blocked by:** 01 Repository skeleton and first Cloudflare deploy

**Status:** ready-for-agent

- [ ] Robot DO API test: message in, turn runs against a stub LLM, reply and event log readable from SQLite
- [ ] Closing the WebSocket mid-turn leaves the turn running; reopening shows the finished reply
- [ ] A DO eviction between two tool results resumes the turn from the last persisted event
- [ ] Session log is append-only; a second turn appends after the first
