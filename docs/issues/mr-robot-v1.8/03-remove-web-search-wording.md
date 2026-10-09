# 03: Remove web_search; glossary wording in descriptions and prompt

**Parent:** mr-robot-v1.8 (../mr-robot-v1.8.md) — stories ts-6b3k, ts-x0kl, ts-hhdz, ts-uldn, ts-zd12

**What to build:** The generic DSH web_search is no longer offered (plugin mounted fetch-only, or filtered at composition); web_fetch's description points to web_search_exa. Schedule tool descriptions and errors say Routine. drive_import becomes drive_replace (the connector skill text follows). browser_wait says it matches visible text and the title, with the default timeout stated. The platform prompt names memory_write_shared for Mr. Robot and propose_member_file_edit for other Robots.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] web_search absent from a fully granted Robot's tool list; web_fetch description mentions web_search_exa
- [ ] No 'reminder' in schedule tool descriptions or errors
- [ ] drive_replace present, drive_import absent, skill text updated
- [ ] Prompt test for both Robot kinds
