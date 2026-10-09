# Group chats between Robots — grilling prep (2026-10-10)

Prepared for the morning discussion. Outside-in review first, then the question tree.

## 1. The problem behind the request

Stated request: "group chats, especially group chats in the Home between the Mr. Robots of two users".

What the owner probably wants (hypotheses to confirm):
- H1 Household coordination: two people's chiefs settle shared matters (groceries, calendar clashes, bills, trips) without the humans relaying.
- H2 A place where humans and several Robots talk together, like a Discord channel, so one question reaches "the house".
- H3 Specialists working jointly on one task with shared visible context (Grok Bot's 2–6 Bot group chats).
- H4 Shared household memory kept consistent by the Robots themselves.

What the current solution set does:
- Robot message (1:1, durable outbox, recipient Grants). Mr. Robot's recipients are only Robots of kind "robot" the owner reaches — two Mr. Robots cannot message each other today (home.ts reachable/recipients filter).
- Sharing = home makes a Robot visible and reachable to every Member; Mr. Robot is private.
- HOME.md shared memory: Mr. Robot writes it directly, other Robots propose; every Robot gets a change note.
- Discord channel per Robot: already a multi-party room (humans + one Robot); a Robot answers only where asked.

Gap in one sentence: there is no conversation with more than one Robot in it, and the two chiefs of a Home have no door to each other.

## 2. Classification of candidate solutions

| Candidate | Treats | Verdict (recommendation) |
|---|---|---|
| A. Let Mr. Robots message each other (lift the kind filter, recipient Grant across Members with both owners' consent) | H1 | Cheap, on target for H1; no new object. Keep as step one regardless. |
| B. A "Room": a Conversation object owned by the Home with N Robots and M Members; each message wakes the mentioned Robots (or all); each Robot keeps its own memory, the Room keeps the shared transcript | H2, H3 | New domain object (DO + UI); hours to days. Real group chat. Highest value, highest cost. |
| C. Discord channel as the room: several Robots mapped to one Discord channel; mention routing (@name) decides who answers; the transcript lives in Discord | H2 | Cheapest group chat; depends on Discord; no PWA room; approvals cannot live there. Good pilot to learn whether rooms are used at all. |
| D. Shared memory only (HOME.md + change notes) | H4 | Already exists; does not solve a dialogue. Keep. |
| E. Chief-to-chief protocol: "household agenda" Routine where both Mr. Robots exchange messages on a schedule | H1 | Emergent from A + Routines; no code. |

Partial/unnecessary: building B before anyone has used C is speculative. Grok excludes approvals, secrets, logins and drafts from group chats — a hint that rooms are for talk and handoffs, not for Asks.

## 3. Outside view
- Slack/Discord solved multi-agent rooms with mentions and threads; bots stay silent unless addressed. Rooms without addressing rules become noise.
- Multi-agent frameworks (AutoGen group chat, CrewAI) use a speaker-selection rule (round robin, manager picks, LLM picks). A Home room needs one: "mentioned Robots answer; a Robot may @mention another; depth limit".
- Cost: every Robot in a room pays tokens for every message it reads. Grok caps 6 Bots.
- Privacy: a room mixes two Members' Robots; a Robot carries its owner's USER.md and logins. What may it reveal? Today Member files are per owner; a room needs a rule (default: nothing from USER.md leaves the owner's Robots unless the owner says so in PROACTIVE_PREFERENCES/HOME.md).
- Leaving it alone costs: humans relay between chiefs; shared matters live in HOME.md edits only.
- Can the problem be removed at the source? If the household has one Mr. Robot shared by both Members (sharing = home, both as owners), there is no chief-to-chief problem — but then there is no private chief. Worth asking.

## 4. Question tree (rounds)

Round 1 — frame
1. Which hypothesis is the real one: H1 chiefs settle household matters; H2 a house room for humans+Robots; H3 specialists co-working; H4 memory? (multi) Recommended: H1 now, H2 as pilot via Discord, H3 later.
2. One shared Mr. Robot for the household vs one private chief per Member that talk to each other? Recommended: private chiefs + chief-to-chief messaging (A).
3. Who may start a conversation between two Members' Robots: either owner unilaterally, or both owners must grant (mutual recipient Grant)? Recommended: mutual — each owner grants their chief the other chief as recipient.
4. What may a Robot disclose in cross-Member talk: nothing from USER.md/logins unless HOME.md or a Grant says so? Recommended: yes, default closed; the Robot's platform prompt states it.
5. Should the pilot room be a Discord channel with several Robots and mention routing (C), before any in-app Room (B)? Recommended: yes.

Round 2 — if A (chief-to-chief)
6. Is a cross-Member Robot message shown to both owners (each in their chief's Conversation) — yes by construction; should the other owner also be notified? Recommended: no notification, visible in the Conversation.
7. Depth/loop limit for Robot↔Robot exchanges (today a chain is bound): how many hops before a human must speak? Recommended: 6 messages per thread then "needs you".
8. May a chief delegate the other Member's Robots (recipients across Members) or only talk to the other chief? Recommended: only the other chief; it delegates its own staff.

Round 3 — if C (Discord room pilot)
9. Addressing rule in a shared channel: only mentioned Robots answer; unmentioned stay silent; a Robot may mention another (one hop). Recommended as stated.
10. Which Robots may be mapped to one channel: any of the Home, by their owners. Recommended: yes.
11. Asks never go to Discord rooms (as today). Confirm.

Round 4 — if B (in-app Room) is wanted now or later
12. Room = Home-owned object with members (Members and Robots), transcript, mention routing; each Robot's memory stays its own; Room messages are Wake-ups of kind "room". Max Robots per Room (6?).
13. Is a Room a Channel of each Robot (same Conversation, labelled) or a separate transcript the Robot reads on wake? Recommended: separate transcript; the Robot's Conversation shows "said in Room X" items.
14. Who may create a Room, add Robots not their own? Recommended: any Member; adding another Member's Robot needs that owner's approval (an Ask).
15. Cost control: Room messages count against each participating Robot's spend limit; a Robot leaves a Room when blocked.

## 5. Facts still to check before deciding B
- How the Robot message chain bound is implemented (programs.ts) and whether it generalises to N participants.
- Whether DSH's session log can hold a second transcript per Robot or a Room needs its own DO.
- Discord: can one bot route one channel to several Robots (today: one channel per Robot in the Home index).
