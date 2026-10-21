# 02: Secrets outlive a Turn; Auto review sees one bounded, redacted Turn

**What to build:** Decisions 3 and 4. Findings: cross#1, cross#2.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test: a secret revealed in Turn 1 and repeated by the model in Turn 2 is masked in session_event, chat_item, the FTS index and a cold chapter object; Pages, definitions, dream files and spill files masked at write
- [ ] Workerd test: the reviewer stub receives only the current Turn, redacted, within the budget
