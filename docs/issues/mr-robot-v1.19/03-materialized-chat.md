# 03: Materialized chat items and the endless scroll

**What to build:** A chat_item table written per event by the fold; conversationPage becomes a cursor query across chapters; the PWA scrolls back without end; a bounded backfill of existing Robots over several Turns; search and the Fleet's activity read bounded rows (ec-2sra, ec-n0uh, ec-yxru, ec-enqy, ec-es5g).

**Blocked by:** 02

**Status:** done

- [x] Workerd test: items materialized per event; pages by cursor across chapters; the backfill; search across chapters; Fleet activity from the live tail
- [x] Component test: the chat scrolls back across chapters
- [x] The scale test's chat and search budgets pass

## Closing note

apps/worker/test/chat-items.test.ts (stored chat equals the folded log at Compact and above; pages by cursor across a chapter boundary; open Asks on every page; a Robot from before v1.19 folded over several Turns, reading the same meanwhile), box.test.ts (the Fleet's running tool) and apps/web/test/chat-pages.test.tsx (scrolling back loads the page before by its cursor and keeps the view; the search reads back to the start). Scale test: chat open 115 session rows (was 146 081), the next page by cursor 71, another Robot's page 2 57; all its budgets now pass.

Decisions:
- One fold for everything (projection.ts): foldEvent folds one event into rows through a small row interface (the chat_item table or an array), with its memory between events (open tool calls, the owner's last message for reactions, the last row of each work-details level for activity merging) stored per chapter in chat_fold. projectChat (a Subagent's chat) and the legacy fold are the same fold over an array, so a chapter folded later comes out the same as one stored live.
- Rows carry a level (both, Compact only, Standard and above): Compact's activity lines and the detailed ones are separate rows, so each level reads exactly what the old projection showed for it.
- What changes after it is written is stored as a reference and read when shown: an Ask (by id; an Ask a later one superseded is not shown), a Thread card, a delegation (an archived one is not shown), Page titles. Masking is at read time as before.
- Notices, Asks and delegations become rows when they happen (side rows), in a chapter whose chat is current. One consequence: an Ask now shows just before the activity line of its step instead of just after it.
- The chat is current per chapter: new chapters start current; chapters from before v1.19 are folded by a backfill at the end of each Turn, newest chapter first, 4 000 events per Turn, with their old notice rows, delegations and Asks placed as the old view placed them. Until a chapter is folded it is folded in memory when shown. A sentinel row says when nothing is left, so a finished backfill costs one row per Turn. Notices that old migrations write go to the chat when it is stored.
- GET conversation is a page: the newest 50 items, or the ones older than the before cursor (chapter ordinal and row position), with the cursor of the page before and every open Ask (asks), so an Ask far back still takes the Composer's place. The deputy's numbered pages walk the same cursor. The RPC conversation and conversationView stay whole for tests.
- The PWA keeps the pages it has: a fresh newest page replaces what is kept from its first item on; an older page goes before the first item; ChatScroll loads the page before 400 px from the top and keeps the view still. The in-chat search reads older pages when the reader goes past the oldest loaded match, so it still reaches the whole Conversation. More than 50 new items between two refreshes while older pages are open can leave a gap until the chat is opened again; I accepted that.
- Search: a sentinel marks that every chapter is indexed, so a search after the first reads a few rows instead of every chapter's state.
- The Fleet's running tool and a Subagent's are read from the last 200 events of their log.
