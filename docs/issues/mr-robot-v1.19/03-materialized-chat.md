# 03: Materialized chat items and the endless scroll

**What to build:** A chat_item table written per event by the fold; conversationPage becomes a cursor query across chapters; the PWA scrolls back without end; a bounded backfill of existing Robots over several Turns; search and the Fleet's activity read bounded rows (ec-2sra, ec-n0uh, ec-yxru, ec-enqy, ec-es5g).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Workerd test: items materialized per event; pages by cursor across chapters; the backfill; search across chapters; Fleet activity from the live tail
- [ ] Component test: the chat scrolls back across chapters
- [ ] The scale test's chat and search budgets pass
