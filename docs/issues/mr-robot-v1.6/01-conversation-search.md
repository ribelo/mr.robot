# 01: Conversation search for every Robot

**Parent:** mr-robot-v1.6 (../mr-robot-v1.6.md) — stories cd-ggem

**What to build:** A Robot searches its own endless Conversation by text and gets matching chat items newest first, paged, with id, sender, time and a snippet. The same program later serves Mr. Robot's view of other Robots.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Tool conversation_search(query, page) exists for every Robot and returns { items: [{ id, sender, at, snippet }], nextPage }
- [ ] Search runs in the Robot Durable Object SQLite: FTS5 when workerd offers it, otherwise LIKE behind the same interface; the index is maintained on append and backfilled on first use
- [ ] Workerd test: seed a long log, find an early and a late phrase, page through results
