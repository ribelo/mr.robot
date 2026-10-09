# Mr. Robot v1.8 — tickets

Spec: ../mr-robot-v1.8.md. 01, 02 and 03 start at once; 04 after all three.

| # | Ticket | Blocked by | Status |
|---|---|---|---|
| 01 | [Connector failures throw; JSON results with account](01-connector-failures-throw-json.md) | — | ready-for-agent |
| 02 | [Input validation before any call](02-input-validation.md) | — | ready-for-agent |
| 03 | [Remove web_search; glossary wording in descriptions and prompt](03-remove-web-search-wording.md) | — | ready-for-agent |
| 04 | [Typed Exa SDK parameters and the tool contract test](04-typed-exa-params-contract-test.md) | 01, 02, 03 | ready-for-agent |


## Source: Mr. Robot's tool report (2026-10-09, translated)

Tested read-only tools, files, schedule and browser. Skipped everything with effects outside the Robot (mail send/draft, calendar writes, Docs/Sheets writes, Drive move/share, Discord writes, notify_owner, robot_send, host_*, memory_write_shared, exa_agent_create_run, gmail_mark_read/archive/label/unsubscribe; login_fill and secret_get only on a missing entry).

Works predictably: file tools (clear errors such as "occurs 2 times; add context or replace all", replace_all, paths outside the Workspace refused); Google, Discord and browser return sensible data; browser reports a stale element index; schedule create/list/update/delete work, two timings at once give a readable error; Exa tools work well.

Surprises: Google and Discord tools return success with text starting "Failed: the service answered 404…" (gmail_thread, sheets_read, docs_read, discord_read_messages, drive_search, contacts_get) so try/catch misses them; delete_file on a missing file returns { deleted } as if it deleted; calendar_events with from after to returns empty without error; web_search answers mostly to the first word of the query, titles empty, no summary, description does not mention web_search_exa; schedule_create has no floor for after_seconds (5 s created a real reminder) while every_seconds has 60 s; robot_directory without recipients returns prose, not an empty list; result formats differ (Google/Discord: text header plus JSON; files/web/schedule: JSON; grep/glob: text; exa_agent_*: raw JSON); discord_accounts shows services: [] while reading and writing work; web_fetch on 404 returns success with statusCode 404.

Descriptions: no parameter descriptions for web_search_exa, crawling_exa, get_code_context_exa, exa_agent_list_runs, exa_agent_list_events (unknown in the SDK; fields guessed from API errors); exa_agent_list_events without id sends id: undefined and gets a 404; "Routines" in the prompt versus "reminders" and schedule_* in the tools; drive_import sounds like creation but overwrites (drive_upload creates); the prompt tells Mr. Robot to use propose_member_file_edit, which he does not have (he has memory_write_shared); browser_wait defaults to 30 s and does not say it searches page text, not the title.
