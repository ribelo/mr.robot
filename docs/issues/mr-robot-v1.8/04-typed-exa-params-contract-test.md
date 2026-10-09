# 04: Typed Exa SDK parameters and the tool contract test

**Parent:** mr-robot-v1.8 (../mr-robot-v1.8.md) — stories ts-pg3q, ts-2zf7

**What to build:** Exa tools reach the code-mode SDK with typed, described parameters instead of unknown: find why schema-only tools are emitted as unknown and fix the generator or the schemas. A contract test iterates the mounted tools of a fully granted Robot and asserts: description present, every parameter described, web_search absent, drive_replace present, and a simulated failure rejects instead of returning.

**Blocked by:** 01, 02, 03

**Status:** ready-for-agent

- [ ] SDK declarations for web_search_exa, crawling_exa, get_code_context_exa, exa_agent_* show typed parameters
- [ ] Contract test passes over every mounted tool
