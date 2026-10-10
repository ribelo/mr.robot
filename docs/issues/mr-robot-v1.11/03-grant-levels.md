# 03: Grant levels: allow, ask, deny

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-746n, sk-8e0f, sk-br7y, sk-8llz, sk-3sij, sk-xj5q, sk-iq3n

**What to build:** Every grant item (tool group, Connection, Connection write, Host facet, login, skill) has a level: allow, ask or deny. Advanced settings shows a three-state control per item and applies it to Mr. Robot too, who holds allow on everything reachable (new plugins included) unless the owner lowered an item. A Robot finishing setup gets allow on approved items, ask on files, web and exa, deny on the rest. Existing rows migrate to allow. Tools of deny items are not registered; ask items are registered and behave like allow until ticket 05. propose_grants, robot_grants and robot_propose_grants read and write levels.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Level column with migration; effectiveGrants returns levels; Mr. Robot's defaults and lowering work and his settings page shows the truth
- [x] Three-state control in Advanced settings; setup defaults; deputy and propose tools with levels
- [x] Tool-surface test extended: registration follows levels; workerd tests for Mr. Robot defaults, lowering, setup defaults, migration
