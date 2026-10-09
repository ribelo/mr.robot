---
title: "Mr. Robot v1.8 — tool surface consistency"
status: done
story-prefix: ts
parent: mr-robot-v1.5.md
---

# Mr. Robot v1.8 — tool surface consistency

## Problem Statement

Mr. Robot tested his own tools and reported what surprises a program written in code mode. Connector tools (Google, Discord) return success with text beginning "Failed: …", so try/catch never sees the failure. Results come in three shapes: plain JSON, text with a "[google · account]" header and JSON inside, raw text. `delete_file` reports a deletion that did not happen. `web_search` (the generic DSH tool) answers mostly to the first word of the query and its description does not say Exa exists. `schedule_create` accepts `after_seconds: 5`. Exa tools reach the code-mode SDK as `unknown` parameters. `exa_agent_list_events` sends `id: undefined` to Exa. The prompt tells Mr. Robot to use a tool he does not have. Descriptions say "reminder" where the product says Routine. `drive_import` sounds like creation but overwrites. `browser_wait` does not say what it searches. `robot_directory` returns prose instead of an empty list.

## Solution

One contract for every tool a Robot sees: a failure throws (the SDK rejects with a ToolCallError); a success returns JSON with the connector account as a field; parameters are typed and described in the SDK; inputs are validated before any network call; wording follows the glossary. The generic web search is removed. The prompt matches the tools each Robot kind has.

## User Stories

1. As a Robot, I want every connector tool to throw on failure (404, 401, rate limit, invalid input), so that try/catch in my program sees it ^ts-jbep
2. As a Robot, I want every tool result to be JSON (connector results with an `account` field instead of a text header), so that one parsing rule works everywhere ^ts-uy4d
3. As a Robot, I want `delete_file` to throw when the file does not exist, so that a deletion report is true ^ts-6z2k
4. As a Robot, I want `calendar_events` to refuse a range whose start is after its end, so that an empty result means empty ^ts-3d3n
5. As a Robot, I want the generic `web_search` gone and `web_fetch`'s description to point to web_search_exa for search, so that I do not get first-word results ^ts-6b3k
6. As a Robot, I want `schedule_create` to refuse `after_seconds` under 60 as it does `every_seconds`, so that the two selectors behave alike ^ts-lnox
7. As a Robot, I want `robot_directory` to return an empty list with a `hint` field when I have no recipients, so that the result type is stable ^ts-nivs
8. As a Robot, I want `discord_accounts` to list the services the bot grants (channels, messages, dms), so that it is not an empty list beside a working tool ^ts-z0ip
9. As a Robot, I want every Exa tool's parameters typed and described in the code-mode SDK declarations, so that I do not guess fields from API errors ^ts-pg3q
10. As a Robot, I want `exa_agent_list_events` and every other tool to validate required parameters before calling a service, so that the error names my mistake ^ts-yf1d
11. As a Robot, I want the schedule tools' descriptions and errors to say Routine, not reminder, so that the prompt and the tools agree ^ts-x0kl
12. As a Robot, I want `drive_import` renamed to `drive_replace` (overwrites an existing file; `drive_upload` creates), so that the name tells the effect ^ts-hhdz
13. As Mr. Robot, I want the platform prompt to name `memory_write_shared` for the owner's files and never a tool I lack, so that the rules are followable ^ts-uldn
14. As a Robot, I want `browser_wait` to say it matches visible text (and to also match the title) with a default timeout stated, so that a 30-second wait is not a surprise ^ts-zd12
15. As a Robot, I want `web_fetch` to keep returning the status code on a 404 and say so in its description, so that the behaviour is intended, not accidental ^ts-h8oy
16. As a developer, I want a contract test that every mounted tool has a description, described parameters, and throws rather than returns on a simulated failure, so that the contract stays kept ^ts-2zf7

## Implementation Decisions
- Connector runner: a failed connector call rejects with an Error whose message is the current "Failed: …" text (same wording, including the reconnect hint); a success returns { account, ...result } as JSON. The trajectory record keeps the account and action.
- `tool()` helper renders every result as JSON; the few text-returning tools (grep, glob, robot_directory) return structured arrays. Where a tool today returns a string message, it returns { status, message }.
- Validation in the tool layer, before any network: required parameters present and non-empty; numeric floors (after_seconds ≥ 60, routine interval ≥ 5 minutes where that spec applies); calendar range order.
- The DSH web plugin is mounted with fetch only; search is not registered. If the plugin cannot be split, the `web_search` tool is filtered from the tool list at composition.
- Exa tools: JSON Schema with descriptions on every property; the SDK declaration generator must emit the typed shape for schema-only tools (find why it emits `unknown` for them and fix the generator or the schema).
- Platform prompt branches on Robot kind for the shared-file rule.
- The rename `drive_import` → `drive_replace` updates the Google connector skill text.

## Testing Decisions
- Workerd tests through the Robot DO with a fake turn: a connector fixture returning 404 makes the tool call reject; a success returns JSON with account (ts-jbep, ts-uy4d). delete_file on a missing path throws (ts-6z2k); calendar range (ts-3d3n); after_seconds floor (ts-lnox); robot_directory empty (ts-nivs); discord_accounts services (ts-z0ip); exa_agent_list_events without id (ts-yf1d).
- A contract test iterating the mounted tool list of a fully granted Robot: description present, every parameter described, web_search absent, drive_replace present (ts-6b3k, ts-pg3q, ts-hhdz, ts-2zf7).
- Prompt test: Mr. Robot's prompt names memory_write_shared, an ordinary Robot's names propose_member_file_edit (ts-uldn).
- Descriptions are checked by reading them in the contract test (ts-x0kl, ts-zd12, ts-h8oy).
- Prior art: connector fixture tests from v1.5 in apps/worker/test.

## Out of Scope
New tools; changing what any tool does beyond failure, shape, validation and naming; the UI.

## Further Notes
- Source: Mr. Robot's own tool report of 2026-10-09 (read-only tools, files, schedule, browser), reproduced in the v1.8 tickets directory as README context.
