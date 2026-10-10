---
title: "Mr. Robot v1.9 — chief threads: the Mr. Robots of a Home talk to each other"
status: ready-for-agent
story-prefix: ch
parent: mr-robot-v1.6.md
---

# Mr. Robot v1.9 — chief threads

## Problem Statement

Two Members of one Home each have a Mr. Robot. Each chief knows its owner's Robots, memory, calendar and preferences, but the two chiefs have no door to each other: Mr. Robot's recipients are only Robots of kind "robot" and Mr. Robot is private. Shared matters of the household (a dinner, a trip, a calendar clash) are settled by the humans relaying between their chiefs, or not at all. The owner does not want one shared chief: each person keeps a private Mr. Robot, and the chiefs talk.

## Solution

A **Thread**: a conversation on one topic between the Mr. Robots of two Members of the same Home. A Thread starts as an invitation and opens only when both owners accept it, each with a **scope** that says what their chief may use and disclose in it. Inside an open Thread the chiefs exchange messages (shown in each chief's Conversation, labelled); after 20 messages a chief reports to its owner and asks whether to continue; either chief closes the Thread with a summary, and an idle Thread closes after 7 days. Nothing a Thread agrees on binds anyone: each chief puts the outcome to its owner as an Ask. Robots other than Mr. Robot never talk across Members. A Discord room with several Robots is a later, separate spec.

## User Stories

### Invitation

1. As Mr. Robot, I want to list the other chiefs of my Home (owner name, chief name, availability), so that I know whom I can invite ^ch-c2xa
2. As Mr. Robot, I want to open a Thread with another chief by naming a topic and the scope I propose for my own owner, so that a household matter can be settled chief to chief ^ch-l4jg
3. As a person, I want my chief's outgoing invitation shown to me as an Ask with the topic and an editable scope ("in this Thread you may use: …"), so that nothing about me leaves before I say what may ^ch-vrl7
4. As a person, I want an incoming invitation shown to me as an Ask ("<owner>'s Mr. Robot wants to talk about <topic>") with an editable scope, so that I accept or decline each topic ^ch-hikl
5. As a person, I want a Thread to open only when both owners have accepted, and to be told when it does, so that consent is symmetrical ^ch-fri7
6. As a person, I want a declined invitation to end the Thread and to tell the other chief it was declined without a reason, so that privacy is kept ^ch-0cn1

### Talking

7. As Mr. Robot, I want to send messages in an open Thread and to receive the other chief's messages as Wake-ups, so that the conversation moves without the humans ^ch-jnet
8. As Mr. Robot, I want the Thread's topic and my owner's scope in front of me at every step, so that I use and disclose only what was allowed ^ch-6ymu
9. As a person, I want the Thread shown in my chief's Conversation as labelled messages plus a Thread card (topic, other chief, state, message count), so that I can follow what my chief says and hears ^ch-iy16
10. As a person, I want my chief to stop after 20 messages in a Thread, report to me and ask whether to continue, so that two chiefs cannot run away ^ch-408z
11. As a person, I want the Thread's messages to count against my chief's spend limit like any Turn, so that a Thread cannot spend what I did not allow ^ch-k2tp

### Outcome and closing

12. As Mr. Robot, I want to put the outcome of a Thread to my owner as an Ask (a proposal, or a review of options), so that nothing is binding without both owners ^ch-6g7j
13. As Mr. Robot, I want to close a Thread with a summary that both chiefs receive, so that the topic has an end ^ch-rlnd
14. As a person, I want an idle Thread (7 days without a message) closed automatically with a note in both Conversations, so that Threads do not pile up ^ch-gckb
15. As a person, I want my open and closed Threads listed in my chief's panel, so that I can see what my chief is talking about ^ch-6fcp

### Boundaries

16. As a person, I want only Mr. Robots to talk across Members; my specialist Robots work for my chief as today, so that cross-Member talk has one accountable door ^ch-rqnf
17. As a person, I want my chief's platform rules to say that in a Thread it uses only the scope I gave and never USER.md, logins or other Robots' data beyond it, so that the default is closed ^ch-v1p8
18. As a Home admin, I want Threads visible in the admin view (participants, topic, state), so that I see what the household's chiefs do ^ch-5ngu

## Implementation Decisions

- **Thread** is a new domain object: id, Home, topic, two participants (member id, chief robot id, scope text, acceptance state), state (invited | open | closed | declined), opened/closed times, message count, close summary. The registry lives in the Home Durable Object; each chief keeps its own copy of the Thread state and messages in its store. No new Durable Object.
- **Messages** reuse the Robot message outbox (durable, idempotent, masked) with a new kind "thread" carrying the thread id; the chain limit does not apply inside a Thread — the Thread's own 20-message pause replaces it. A Thread message wakes the other chief with a Wake-up that carries the topic, the receiver's own scope and the message.
- **Invitations** are Asks: a new ProposalKind "thread" on both chiefs; the payload holds the topic and a scope text the owner edits before approving (the Ask form gets a text field). The Thread opens when the second approval lands; the Home flips the state and both chiefs are woken with "Thread opened". A decline closes it as declined; the other chief is told only that.
- **Pause at 20**: the sending chief's tool refuses the 21st message with "report to your owner first"; the chief's report is an ordinary message and a "continue" question Ask; approval resets the counter for another 20.
- **Closing**: a close tool with a summary; the Home marks closed and wakes the other chief with the summary. Idle close by the Home alarm after 7 days.
- **Tools** (Mr. Robot only, in the existing robots group): thread_chiefs, thread_open, thread_send, thread_close, thread_list. Outcomes use the existing propose tools (propose_grants is not relevant; propose_review or a plain question Ask).
- **Prompt**: the platform prompt for Mr. Robot gains the Thread rule (scope only; nothing from USER.md, logins or other Robots unless the scope names it).
- **UI**: Thread card and labelled messages in the Conversation (sender "Anna's Mr. Robot"), Threads list in the panel, invitation Ask with a scope field, admin view rows.
- **Discord room** (several Robots on one channel, mention routing) is out of this spec.

## Testing Decisions
- Workerd tests through the Robot DO and edge API with two Members, each with a Mr. Robot, and fake turns: invitation on both sides, scope stored exactly, open only after both approvals, decline hides the reason (ch-c2xa, ch-l4jg, ch-vrl7, ch-hikl, ch-fri7, ch-0cn1); messages both ways with topic and scope in the Wake-up, labelled items in both Conversations (ch-jnet, ch-6ymu, ch-iy16); the 21st message refused until the continue Ask is approved (ch-408z); usage counted (ch-k2tp); close with summary and idle close by alarm (ch-rlnd, ch-gckb); an ordinary Robot has no thread tools and a chief of another Home is not listed (ch-rqnf); prompt contains the rule (ch-v1p8); admin view lists Threads (ch-5ngu); panel list (ch-6fcp).
- Component tests: invitation Ask with scope field; Thread card (ch-vrl7, ch-hikl, ch-iy16).
- Prior art: apps/worker/test/messaging.test.ts, review.test.ts, deputy.test.ts; apps/web/test/chat-view.test.tsx.

## Out of Scope
Threads with more than two chiefs; Robots other than Mr. Robot across Members; a Discord room with several Robots; chiefs acting on outcomes without an Ask; cross-Home talk.

## Further Notes
- Decided with the owner on 2026-10-10: private chiefs (no shared household chief); invitation per topic, not a standing pairing; symmetrical consent with scope; outcomes are Asks; 20-message pause; Discord room later. Prep notes: docs/research/group-chats-grill-prep.md.
