---
title: "Mr. Robot v1.3 — everything is a plugin, memory, a conversation that reads well, takeover that works, deletion and polish"
status: ready-for-agent
story-prefix: pl
parent: mr-robot-v1.2.md
---

# Mr. Robot v1.3

## Problem Statement

The owner chose DeepSeek Harness because everything is a plugin; in Mr. Robot only the DSH core is, while every capability we added is a hand-wired tool list. Memory exists as files but nobody decided what is shared and what is private, how it enters the context without breaking the prompt cache, or how robots learn that a file changed. The conversation shows whole messages at once, without Markdown, and the only way to see the robot's work is a debug trajectory. Takeover opens slowly, types through a side field instead of the keyboard, and leaves the robot waiting when the window is closed. The desktop app shows a Web Push error. Robots and histories cannot be deleted and there is no reset. Pages lack empty, loading and error states, and the UI is visibly uneven.

## Solution

Refactor the capabilities into Cordis plugins mounted by grant. Add a memory plugin with member, robot and Home scopes, injected as a baseline message with change notes and post-compaction refresh, plus Anthropic cache warming. Render Markdown, stream, and add a per-user Work details level whose Detailed mode reuses the DSH conversation's tool cards. Fix takeover input, close semantics, cookie messaging and speed. Native notifications and unread badges. Delete, clear and reset with typed confirmation. Search, file preview and download, a host action log. Then states and a polish pass over every page.

## User Stories

### Everything is a plugin

1. As an operator, I want every Mr. Robot capability (browser, workspace files, logins, host, Exa, routines, robot messaging, notifications, grant proposals, memory, takeover) to be a Cordis plugin with its own config schema, so that the robot is a composition, as DeepSeek Harness is ^pl-vfxd
2. As an operator, I want a robot's grants to decide which plugins mount in its composition, so that an ungranted capability is absent, not filtered ^pl-rsoy
3. As an operator, I want plugins that touch only TypeScript and the network to be loadable in the desktop DeepSeek Harness, so that the two harnesses share code ^pl-d1oz
4. As a person, I want nothing to change in how robots behave after the refactor, so that the rework is invisible ^pl-kdmm

### Memory as a plugin

5. As a robot, I want my persona and memory files to enter my context as one durable baseline message at the start, not in the system prompt, so that the prompt cache survives file edits ^pl-w3n0
6. As a robot, I want a note at my next turn naming which memory or persona file changed and by whom (owner, Mr. Robot, another robot), so that I act on the change without a rebuilt prompt ^pl-9n7w
7. As a robot, I want the full, fresh set of memory files injected after compaction, so that a compacted context starts from current files ^pl-552r
8. As a person, I want member-scope memory (USER.md, PROACTIVE_PREFERENCES.md, world.md: address, company, accounts, how invoices are issued) read by every robot of mine, written by Mr. Robot, proposed by others, so that what is about me is in one place ^pl-o3ck
9. As a person, I want robot-scope memory (MEMORY.md, experience.md, opinions.md, daily notes, AGENTS.md, TOOLS.md) per robot, so that a robot's own know-how stays its own ^pl-fkg7
10. As a Home member, I want a small Home-scope memory (shared household facts) written by the admin or Mr. Robot, so that the electricity provider is written once ^pl-yqno
11. As an operator, I want a byte budget for the injected memory with the most specific files kept and the broadest truncated first, so that memory cannot crowd out the task ^pl-jsdm
12. As a Home admin, I want Anthropic prompt caching kept warm for one hour, so that a robot that wakes within the hour does not pay for a cold prompt ^pl-s2d5

### Conversation

13. As a person, I want robot messages rendered as Markdown (headings, lists, code, links, tables), so that answers read as intended ^pl-6bop
14. As a person, I want the robot's text and thinking to stream in as it is produced, so that I do not wait for the whole message ^pl-jzr7
15. As a person, I want a per-user 'Work details' setting with Compact, Standard, Detailed and Verbose, so that I choose how much of the robot's work I see ^pl-6eir
16. As a person, I want Compact (the default) to show one line of current activity and no tool cards, so that the simple view stays simple ^pl-s0hp
17. As a person, I want Detailed and Verbose to render tool cards as the DeepSeek Harness conversation does (same icons, grouping, expand behaviour, thinking shown), so that the advanced view is the one I know ^pl-etps
18. As a person, I want the trajectory to stay where it is as a debugging view, so that the main view is not cluttered ^pl-0a2o

### Takeover

19. As a person, I want keystrokes captured while the takeover screen has focus and sent to the page, so that I type as in a browser ^pl-485j
20. As a person on a phone, I want a keyboard button that opens an input for the page, so that typing works without a physical keyboard ^pl-vwq6
21. As a person, I want closing the takeover window to hand the browser back (resume the task, or close the browser if there is none), so that a robot is never left waiting ^pl-glfh
22. As a person, I want the takeover window to say that the robot's profile keeps cookies and logins between sessions, so that I know a login is not lost ^pl-ju1l
23. As a person, I want the takeover window to show its page within two seconds on a warm backend and to say what it is waiting for when colder, so that I stop staring at a blank screen ^pl-5agt
24. As an operator, I want the slow takeover open diagnosed with timings per stage (backend start, Chrome, screencast, first frame) and the dominant cause fixed, so that the fix rests on measurement ^pl-n2vs

### Notifications and unread

25. As a person, I want the desktop app to show native notifications delivered over the host channel, so that 'registration failed' from Web Push never appears there ^pl-b5vp
26. As a person, I want unread badges on robots in the list and on the tray icon, so that I see what waits for me ^pl-mhyg
27. As a person, I want a robot marked read when I open its conversation, so that badges mean something ^pl-p4eg

### Deletion and reset

28. As a person, I want to delete a robot (not Mr. Robot) from its menu after typing its name, so that a robot I no longer need is gone for good ^pl-3uoy
29. As a person, I want to clear a robot's history (session log and archive, keeping configuration, routines and memory) after typing its name, with an option to clear memory too, so that a robot starts fresh ^pl-05eu
30. As a person, I want to clear Mr. Robot the same way, since it cannot be deleted, so that my chief of staff can start over ^pl-y228
31. As a person, I want a 'reset everything' in settings that deletes robots, memory, histories, caches and usage, keeping logins, providers, hosts, members and global skills, so that it is as if I signed in for the first time without re-entering credentials ^pl-062x
32. As a person, I want every destructive action to require typing the name and to have no undo, so that there is no trash to manage ^pl-kehf

### Search, files, host log

33. As a person, I want to search within a conversation, so that I find what a robot said last week ^pl-8594
34. As a person, I want to filter the robot list by name, so that I find a robot among many ^pl-4nfk
35. As a person, I want to preview and download attachments and robot files, so that a produced document reaches me ^pl-ojbr
36. As a person, I want a log of host actions (which robot ran what, when, with exit status) on the 'This computer' page, so that I see what was done on my machine ^pl-vcy7

### States and polish

37. As a person, I want every page to have an empty state, a loading state and a readable error state, so that nothing is blank or raw ^pl-fxge
38. As a person, I want every page gone through for spacing, alignment, typography, widths and small screens, with the Grok Bot screens as the model for simple views and DeepSeek Harness for tool cards, so that the app looks finished ^pl-qdle

## Implementation Decisions

### Plugins
- Each capability becomes a Cordis plugin in this repository with a Schemastery config: browser (backends behind it), workspace files, logins, host, Exa, routines (the ported schedule), robot messaging, notifications, grant proposals, memory, takeover. The robot composition is built from its grants: an ungranted plugin is not mounted. Shared conventions follow DSH package READMEs. Plugins free of Workers-specific bindings expose a build usable by the desktop harness.
- Behaviour is unchanged; the Robot DO tests from v1–v1.2 must pass untouched except for composition wiring.

### Memory plugin
- Scopes: member (USER.md, PROACTIVE_PREFERENCES.md, memory/world.md), robot (MEMORY.md, memory/bank/experience.md, memory/bank/opinions.md, memory/YYYY-MM-DD.md, AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md), Home (HOME.md). Member and Home files are mounted into every robot of the member; Mr. Robot writes them, other robots propose edits (an ask); the admin edits Home files.
- Injection modelled on DSH agent-instructions: one durable baseline message at the start of the context, not the system prompt; a byte budget with broadest files truncated first. Difference from DSH: changes come from R2 events (owner edit in the Files view, Mr. Robot, another robot), recorded per robot as pending notes and delivered as one "changed: X by Y" note with the next turn; the full file set is re-injected after compaction and on session seed (rewind).
- Cache warming: the cache-warming behaviour of the owner's claude-subscription plugin is ported as a provider-level setting (one hour) without UI.

### Conversation
- Markdown rendering with a safe subset; links open externally in the app.
- Streaming: the Robot DO forwards assistant text and thinking deltas over the live WebSocket; the chat renders them incrementally; the stored log is unchanged.
- Work details per Member (Compact default, Standard, Detailed, Verbose) in profile settings; Compact shows one activity line; Standard shows collapsed cards; Detailed and Verbose reuse the DSH conversation tool-card components (ported from the DSH client packages, restyled), including thinking. The trajectory stays as the debug view.

### Takeover
- Key capture on focus (keydown/keyup forwarded as CDP key events), a phone keyboard button, close = hand back, cookie note in the window, timing instrumentation per stage with the dominant cause fixed; target two seconds on a warm backend.

### Notifications and unread
- The host channel carries notifications to the desktop app, which shows native ones; Web Push is not attempted inside the app. Unread state per robot per Member; badges in the list and the tray.

### Deletion and reset
- Delete robot (not Mr. Robot), clear history (with optional memory), clear Mr. Robot, reset everything (keeps logins, providers, hosts, members, global skills). Typed-name confirmation, no undo, audit line in the admin.

### Search, files, host log
- Conversation search over the stored log (client-side on loaded pages, server-side for older); robot list filter; attachment and workspace file preview (text, images, PDF) and download; host action log kept in the Member DO and shown on This computer.

### States and polish
- Shared empty/loading/error components; a page-by-page pass against the Grok Bot screens (simple views) and the DSH conversation (tool cards); before/after screenshots recorded in the ticket.

## Testing Decisions
1. **Robot DO API** (stub LLM, stub browser): composition from grants (pl-vfxd, pl-rsoy, pl-d1oz, pl-kdmm), memory scopes, injection, change notes, post-compaction refresh, budget (pl-w3n0, pl-9n7w, pl-552r, pl-o3ck, pl-fkg7, pl-yqno, pl-jsdm), deletion and reset (pl-mhyg, pl-p4eg, pl-3uoy, pl-05eu, pl-y228), unread (pl-n2vs, pl-b5vp), host log (pl-4nfk).
2. **Live**: streaming and Markdown, Work details levels, takeover timings and close semantics, native notifications in the app, cache warming observed in provider usage (pl-6bop, pl-jzr7, pl-6eir, pl-s0hp, pl-etps, pl-0a2o, pl-485j, pl-vwq6, pl-glfh, pl-ju1l, pl-5agt, pl-s2d5).
3. **PWA components**: Markdown renderer, tool cards per level, search, file preview, state components (pl-062x, pl-kehf, pl-8594, pl-ojbr, pl-vcy7).

## Out of Scope
Keyboard shortcuts, time zone and language per user, app auto-update, and the postponed items of v1.1 and v1.2 stay postponed.

## Further Notes
- Trajectory remains a debug view; no top-bar toggle.
- Grok Bot's hidden-background-work model (robot speaks only via a send-to-user tool) was considered and rejected; Compact covers the need.
