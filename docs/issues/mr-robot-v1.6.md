---
title: "Mr. Robot v1.6 — chief deputy: Mr. Robot sees and runs the owner's Robots"
status: ready-for-agent
story-prefix: cd
parent: mr-robot-v1.5.md
---

# Mr. Robot v1.6 — chief deputy

## Problem Statement

Mr. Robot can create Robots and send them work, but he is blind to them. He cannot read their Conversations, Workspaces, Persona files or notes; he cannot see their Grants, Routines, settings or model; he cannot create a Routine for another Robot; `robot_configure` changes only a name and a description. He must know library skill names by heart to propose them. A Robot cannot search its own endless Conversation. An Ask carries one decision, so a Robot that drafted 36 messages must ask 36 times. Nothing outside the app or Discord can wake a Robot. Routines have no limits and no run history.

The owner wants a chief of staff: a Robot that supervises the others the way the owner does from the app, with the owner's eyes and the owner's non-dangerous hands.

## Solution

Mr. Robot becomes the owner's **deputy**: one capability that gives him the owner's view of every Robot the owner can reach and the owner's non-grant controls over them. He reads Conversations (with search and paging), Trajectory excerpts on request, Workspace files, Grants, Routines, settings and model; he writes Workspace and Persona files (the Robot is told), creates and edits Routines, changes settings, model, Discord channel and identity. Grants and spend limits stay proposals the owner answers, as before.

Around it: full-text search of its own Conversation for every Robot; a `skill_library` tool that lists the Home library; a `review` Ask with a list of items the owner approves one by one or all at once; a webhook Channel that wakes a Robot from outside; limits and run history for Routines; a postponed design for a robot e-mail address.

## User Stories

### Deputy: seeing

1. As Mr. Robot, I want to list every Robot my owner can reach with id, name, description, kind, status, fleet state, model and last activity, so that I know who does what and who is stuck ^cd-ibix
2. As Mr. Robot, I want to read another Robot's Conversation as the owner sees it (chat level), newest first with paging, so that I can review its work without being told ^cd-gjhb
3. As Mr. Robot, I want to search another Robot's Conversation by text, so that I find the message I need in a long history ^cd-jltk
4. As Mr. Robot, I want to read an excerpt of another Robot's Trajectory around one message (tool calls, results, code) with a hard size limit, so that I can diagnose a failure without flooding my context ^cd-9te1
5. As Mr. Robot, I want to list and read another Robot's Workspace files (Persona files, memory, daily notes, skills, artefacts), so that I can check its identity and memory ^cd-r9g5
6. As Mr. Robot, I want to see another Robot's Grants (tools, skills, logins, recipients, hosts, connections) and its open proposals, so that I can tell what it may do before I propose more ^cd-jc8f
7. As Mr. Robot, I want to see another Robot's Routines with schedule, paused state and last runs, so that I can tell what runs when ^cd-0rqn
8. As Mr. Robot, I want to see another Robot's settings (model, thinking, code mode, context budget, Discord channel, browser backend, notifications, spend limit), so that I can explain and fix its behaviour ^cd-ojeh

### Deputy: changing

9. As Mr. Robot, I want to write and delete another Robot's Workspace files, Persona files included, with that Robot told what changed and by whom at its next step, so that I can correct an identity or a note directly ^cd-30lq
10. As Mr. Robot, I want to create, edit, pause, resume and delete Routines for another Robot, shown in its Conversation as "Routine created by Mr. Robot", so that I can schedule work for my staff ^cd-n9pi
11. As Mr. Robot, I want to change another Robot's settings: model and thinking, code mode, context budget, compaction instruction, Discord channel and proactive flag, browser backend, notification channels, wake-on-screen, so that configuration is not the owner's chore ^cd-hpkr
12. As Mr. Robot, I want to change another Robot's identity (name, title, description, avatar colour), so that `robot_configure` covers the whole identity ^cd-28og
13. As Mr. Robot, I want Grants and spend limits to remain proposals the owner answers, so that supervision never becomes self-granted power ^cd-zm8u
14. As a person, I want every change Mr. Robot makes to another Robot shown in that Robot's Conversation as a labelled system line, so that I can see what my chief did ^cd-2zx9
15. As a person, I want the deputy capability bound to the Robots I can reach and to be exclusive to Mr. Robot, so that no ordinary Robot gains it ^cd-2u0h

### Every Robot

16. As a Robot, I want to search my own Conversation by text (full-text, newest first, paged), so that I can find what was said months ago ^cd-ggem
17. As a Robot, I want a `skill_library` tool that lists every skill in the Home library with name, description and whether I hold it, so that I can propose exactly what I need ^cd-wfn2
18. As Mr. Robot, I want `skill_library` to also show which Robots hold each skill, so that I can see who knows what ^cd-56kk

### Review Ask

19. As a Robot, I want to propose a review: a titled list of items (each with id, title, body, optional action label) that my owner can approve all, approve some or reject, so that 36 drafts are one Ask ^cd-dt2x
20. As a person, I want the review Ask in place of the composer with per-item checkboxes, "Approve all", "Approve selected" and "Reject", so that a batch decision takes one minute ^cd-ueft
21. As a Robot, I want the answer delivered as a Wake-up listing approved and rejected item ids, so that I act on exactly what was decided ^cd-7gwt

### Webhook Channel

22. As a person, I want a webhook address and a secret key per Robot, shown in its settings with regenerate, so that outside systems can wake it ^cd-pqt8
23. As a Robot, I want a webhook request to become a Wake-up carrying the request body (JSON or text, bounded size) and headers of interest, so that I can act on events from anywhere ^cd-q7mc
24. As a person, I want a request with a wrong key or an oversized body rejected without waking the Robot, so that the webhook cannot be abused ^cd-s07d

### Routine limits and history

25. As a person, I want each Routine to keep its last 20 runs (started, finished, outcome, first line of the reply) visible in the panel and to Mr. Robot, so that I know whether it works ^cd-3t0p
26. As a person, I want at most 50 Routines per Robot and intervals of at least 5 minutes, refused with a clear message, so that a runaway Robot cannot flood itself ^cd-d14a

## Implementation Decisions

### Deputy capability
- One new tool group, `deputy`, mounted only for a Robot of kind mr-robot, in the same place the `robots` group is mounted. Tools: `robot_list`, `robot_conversation` (page, search), `robot_trajectory` (around one item id, byte-capped), `robot_files` (list, read), `robot_file_write`, `robot_file_delete`, `robot_grants`, `robot_routines`, `robot_routine_set` (create or edit), `robot_routine_pause`, `robot_routine_delete`, `robot_settings`, `robot_settings_set`. `robot_configure` grows to the whole identity and stays. `robot_propose_grants` stays the only way to Grants.
- Every deputy call checks that the owner reaches the target Robot (the same Home access check `robot_propose_grants` uses) and never targets Mr. Robot himself through this group.
- Reads reuse the Robot Durable Object methods the edge API already serves to the PWA (conversation view, panel, files, settings). Writes reuse the owner-side methods (settings patch, routine programs, workspace writes). No second code path for the same data.
- A write by Mr. Robot goes through the existing "memory changed" note for files, and adds a system line to the target Robot's Conversation ("Mr. Robot changed model to …", "Mr. Robot created routine …"). The actor is recorded with the change.
- Settings a deputy may not change: grants, spendLimitUsd, sharing. The patch schema the deputy accepts excludes them by construction.

### Conversation search
- Full-text search over the session log's rendered chat items, in the Robot's Durable Object SQLite. FTS5 if the runtime offers it (verify in workerd; fall back to LIKE over the item text with the same interface). The index is maintained as items are appended; a one-time backfill runs at first use.
- Tool `conversation_search` for every Robot (query, page), newest first, returning item id, sender, time and a snippet. The deputy's `robot_conversation` with a query uses the same program on the target Robot.

### skill_library
- A tool in the skills group for every Robot: name, description, held (boolean). For Mr. Robot each row also lists holder Robot names (from the fleet). Connector skills appear with the connector that brings them.

### Review Ask
- New ProposalKind `review`: payload { title, items: [{ id, title, body, action? }] }. The owner's answer carries approved ids; the rest are rejected. Partial approval is a normal answer, not a new proposal. Tool `propose_review`. The AskBar renders checkboxes with Approve all / Approve selected / Reject; the Conversation shows the decided card with counts.
- The answer wakes the Robot with a structured payload (approved, rejected) rendered as text the model reads.

### Webhook Channel
- A Channel adapter `webhook` beside PWA and Discord. Edge route `POST /hooks/<robotId>/<key>`, exempt from the Access check (it has its own key), body ≤ 64 KB, JSON or text, content type preserved; the Wake-up text names the source and quotes the body. Key per Robot in its config, regenerated from settings (owner or deputy). Replies of a webhook-woken Turn stay in the app and go to opted-in Channels as today.
- Dedup by an optional `Idempotency-Key` header; otherwise every request wakes once.

### Routine limits and history
- Robot store keeps up to 20 run records per Routine (startedAt, finishedAt, outcome: ok | failed | skipped, firstLine). Creating a 51st Routine or an interval under 5 minutes fails with a message naming the limit. The panel's routine detail shows the runs; the deputy's `robot_routines` includes them.

### Robot e-mail (postponed)
- Address scheme `<robot>.<member>@<home domain>`; inbound by Cloudflare Email Routing to an Email Worker that parses the local part and wakes the Robot through a `mail` Channel; outbound through a transactional provider. Needs a domain on Cloudflare the owner has not bought. Recorded as a postponed ticket, not built.

## Testing Decisions
- Good tests exercise the Robot Durable Object through its public methods and the edge API in workerd with a fake model turn that calls the tools; they never assert on internal store layout.
- **Deputy**: a fixture Home with an owner, Mr. Robot and two Robots; Mr. Robot's turn calls each deputy tool; assert the view matches the PWA's and the write lands with the system line and the note (cd-ibix, cd-gjhb, cd-jltk, cd-9te1, cd-r9g5, cd-jc8f, cd-0rqn, cd-ojeh, cd-30lq, cd-n9pi, cd-hpkr, cd-28og, cd-2zx9); a Robot the owner cannot reach is refused, an ordinary Robot has no deputy tools, grants and spend limit are rejected by the patch (cd-zm8u, cd-2u0h).
- **Search**: seed a long log, search for a late and an early phrase, page (cd-ggem).
- **skill_library** for a Robot and for Mr. Robot (cd-wfn2, cd-56kk).
- **Review**: propose, answer with a subset, assert the wake-up payload; component test of the AskBar with checkboxes (cd-dt2x, cd-ueft, cd-7gwt).
- **Webhook**: edge request with a good key wakes once (idempotency), wrong key 401, oversized body 413 (cd-pqt8, cd-q7mc, cd-s07d).
- **Routines**: 50 limit and 5-minute floor refused; run records after alarm runs (cd-3t0p, cd-d14a).
- Prior art: apps/worker/test Robot DO tests with fake turns; apps/web/test component tests.

## Out of Scope
Group chats of Robots; Auto Review rules; Team Robots; robot templates; Secure Forms for arbitrary fields; voice; a Robot e-mail inbox (postponed ticket only); any change to how Grants are approved.

## Further Notes
- Fact base: Grok Bot capability inventory in docs/research/grok-bot-capabilities.md and use-case catalogue in docs/research/grok-bot-use-cases.md (webhook routines, routine limits and batch approval come from there).
- Discord DMs already reach Mr. Robot and any Robot with the Discord connection may DM the owner; nothing to add.
