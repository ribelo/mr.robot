---
title: "Mr. Robot v1.20 — Memory that works at night: the snapshot before compaction, warming then closing, search instead of injection, people pages, dreaming"
status: ready-for-agent
story-prefix: dm
parent: mr-robot-v1.19.md
---

# Mr. Robot v1.20 — Memory that works at night

## Problem Statement

The owner and the agent took dreaming, compaction and memory as one subject on 2026-10-21, after the persona and memory decisions of v1.18 and the chapter model of v1.19, with the Muse research (docs/research/muse-memory-and-persona.md) as the reference for what a tended memory looks like. What stands after v1.18 and v1.19:

1. **A compaction in a Turn loses what was not written.** The sweep runs only before an idle compaction. When the budget runs out mid-Turn, the checkpoint summarises the context and whatever the Robot had not yet written to its files survives only in that summary. Cheap models do not write as they go, whatever the prompt says.
2. **A warming Robot never closes its chapter.** Mr. Robot warms the cache at 54, 108 and 162 minutes and has no idle compaction, so his chapter grows until the budget and his memory is never swept.
3. **Daily notes ride in the context.** Today's and yesterday's notes are injected into the baseline. Muse never injects notes; it searches them. The owner wants search, not injection.
4. **No page for a person.** A Robot that deals with people has nowhere to keep what it knows about one of them, and two Robots of one Member meeting the same customer know nothing of each other's dealings. The owner sees people pages as the feature an organisation will value most.
5. **Nothing reflects.** Muse dreams nightly: what worked, what ruptured, how to act for this user, skills from recurring work. Mr. Robot has no step that looks back.

Rules the owner set: everything is a plugin, so each mechanism can grow without tangling the others; the snapshot before every compaction is worth trying but must be documented precisely so its behaviour is never lost; the dream runs at 03:00 in the owner's time zone, because an organisation spans zones; one suggestion in the morning is the point ("Robots work while you sleep"); no memory moves between Robots.

## Solution

**The snapshot.** One bounded step before every compaction, in a Turn or idle: the Robot writes to its daily note and MEMORY.md what is in flight and what it learned. A plugin with one contract, skipped when nothing happened, versioned by author, visible in the Trajectory, costed under the source memory.

**Warming, then closing.** A Robot with cache warming warms at 54, 108 and 162 minutes; at the next idle moment it sweeps and compacts instead of warming again, so an idle chapter closes within four hours. A chapter still open at the dream hour is closed first. Mr. Robot follows the rule.

**Search instead of injection.** Daily notes leave the baseline. A tool memory_search over the Robot's memory files, people pages, dreams and persona, backed by a full-text index in the Robot's Durable Object that every write to an indexed file updates, returns ranked snippets with path, line range and date. The prompt tells the Robot to search before answering about the past.

**People pages.** memory/people/<slug>.md at the Member scope, written directly by every Robot of the Member (the one exception to proposing Member files; the file history names the author), with a template and an INDEX.md the platform keeps. The memory skill says when a person gets a page and what never goes on one.

**Dreaming.** Once a day at 03:00 in the owner's time zone, on a model set per Robot with a Space default, a Turn with its own cause and chapter and no tool that touches the world: it reads the day's evidence, writes a dated dream, rewrites the "How to act for <owner>" section of AGENTS.md (at most 30 lines), proposes a skill or a Member-file edit when the evidence calls for it, and asks at most one question with options for the morning when PROACTIVE_PREFERENCES.md allows. Mr. Robot's dream also reads his Robots' notes and tends the Member files and the people pages; no memory moves between Robots.

## User Stories

### The snapshot before compaction
1. As a Robot, I want one bounded memory step, the snapshot, before every compaction, in a Turn or idle, in which I write to my daily note and MEMORY.md what is in flight and what I learned, so that nothing a checkpoint summarises away is lost to my files ^dm-kg1p
2. As an operator, I want the snapshot to be a plugin with one documented contract: when it fires, what it tells the Robot, its step limit, what it skips, how it is recorded, so that it can be changed without touching compaction ^dm-77dg
3. As an owner, I want the snapshot skipped when nothing happened since the last snapshot or sweep (no new events in the chapter), so that it never runs for nothing ^dm-tjlb
4. As an owner, I want the snapshot's writes versioned by author snapshot and a Trajectory entry naming the files it changed, so that I see what it did ^dm-r6km
5. As an owner, I want the snapshot's model usage recorded under the source memory, beside sweep and dream, so that the cost of tending memory is one line ^dm-pifl

### Warming, then closing
6. As an owner, I want a Robot with cache warming to warm at 54, 108 and 162 minutes and then, at the next idle moment, run the sweep and an idle compaction instead of warming again, so that an idle chapter closes within four hours ^dm-2ilu
7. As an owner, I want a chapter still open at the Robot's dream hour closed first (sweep, then compaction), so that the night starts from a closed day ^dm-76yv
8. As an owner, I want Mr. Robot to follow the same rule, so that the chief's chapters close like everyone's ^dm-zyxz

### Search instead of injection
9. As a Robot, I want my daily notes out of the baseline message, so that my context carries only what stands: persona, MEMORY.md and the Member and Space files ^dm-cl1p
10. As a Robot, I want a tool memory_search that searches my memory files (MEMORY.md, memory/**, dreams/**, AGENTS.md, SOUL.md and the Member files I read), ranked, returning path, line range, a snippet and the note's date, so that I find what I wrote without reading everything ^dm-hmet
11. As an operator, I want the memory index kept in the Robot's Durable Object (SQLite full-text) and updated on every write to an indexed file, including the owner's edits and restores, so that search is never stale ^dm-yn3q
12. As a Robot, I want the platform prompt to tell me to search my memory before answering about the past, people or preferences, and that the daily note of today is read with read when I need the thread of the day, so that the rule replaces the injection ^dm-vh11
13. As an owner, I want memory_search available to Subagents read-only, so that a child finds what its Robot knows ^dm-g4in
14. As an operator, I want vector search out of scope for now and the index's limits recorded (full-text only, English and Polish stemming not attempted), so that the decision is known ^dm-zpoo

### People pages
15. As a Robot, I want a page per person under memory/people/<slug>.md at the Member scope, with a template (name, role, how we know them, facts with dates, history, how to talk to them), so that a person my owner deals with has one place ^dm-wtn9
16. As an owner, I want every Robot of mine allowed to write under memory/people/ directly, with the author in the file history, as the one exception to the rule that Member files are proposed, so that a customer met by one Robot is known to another ^dm-s0gy
17. As a Robot, I want memory/people/INDEX.md kept by the platform (one line per page: name, role, last touched), so that I see who exists without listing files ^dm-p7l1
18. As a Robot, I want the memory skill to say when to open a page (a person who recurs, or whom the owner names), to update rather than duplicate, and what never goes on a page (credentials, judgements the owner did not make), so that pages stay useful and decent ^dm-mfwj
19. As an owner, I want people pages indexed by memory_search and shown in the Files view under Member files, so that they are found and seen ^dm-ii3r
20. As a Space admin, I want pages at the Space scope out of scope for now, so that nothing crosses Members without a decision ^dm-pygh

### Dreaming
21. As an owner, I want a dream once a day at 03:00 in my time zone, for each Robot with dreaming on, skipped when no daily note changed and no Attempt closed since the last dream, so that the night is used and never wasted ^dm-hx44
22. As an owner, I want the dream to run on a model chosen in the Robot's settings with a Space default, so that reflection is cheap and the cold cache costs nothing ^dm-ox7j
23. As a Robot, I want the dream to read SOUL.md, AGENTS.md, MEMORY.md, the notes since the last dream, the chat items of the chapters closed since, the Attempts that failed or were skipped, the Asks the owner dismissed or rejected, and PROACTIVE_PREFERENCES.md, so that I reflect on evidence ^dm-pzxk
24. As a Robot, I want the dream to write dreams/YYYY-MM-DD.md (what worked, what broke, what I would do differently), so that the night leaves a trace the owner can read ^dm-alok
25. As a Robot, I want the dream to rewrite the section "## How to act for <owner>" in AGENTS.md, at most 30 lines, so that what I learned about this person stands in my context ^dm-4ybd
26. As an owner, I want the dream to change nothing outside the Robot's own files directly: a skill from a recurring workflow through propose_skill, a Member file through propose_member_file_edit even for Mr. Robot, so that nothing about me changes in the night without my yes ^dm-s11z
27. As an owner, I want at most one suggestion per night, as an ask with options I see in the morning, only when PROACTIVE_PREFERENCES.md allows suggestions, so that I come to work with one good question ^dm-vjnv
28. As an owner, I want the dream to have no say, no Connectors, no browser, no Box, no Host and no robot_send, so that a dream can only think, write and propose ^dm-0ylj
29. As an operator, I want the dream to be a Turn with its own cause and chapter, bounded by a step limit, shown in the Trajectory, with its usage under the source memory, so that it is a visible, bounded thing ^dm-7s7w
30. As an owner, I want dreaming on by default for every Robot with a per-Robot switch and a Space default, so that every Robot improves unless I say not ^dm-buya

### Mr. Robot as steward
31. As an owner, I want Mr. Robot's dream to also read the daily notes of my other Robots (through the deputy reads he has) and to propose the edits to my Member files that follow from them, so that one Robot tends what is about me ^dm-pt5b
32. As an owner, I want no memory moved between Robots by a dream, so that what a Robot knows about its job stays its own and what is about me goes through Member files ^dm-w15l
33. As an owner, I want Mr. Robot's dream to tidy memory/people/ (merge duplicates, refresh INDEX.md), so that pages stay one per person ^dm-kkgy

### Glossary and docs
34. As an owner, I want the glossary to define Snapshot, Sweep, Dream, Memory search and People page and to say that daily notes are not in the context, so that the words are one ^dm-1l9i
35. As a Robot, I want docs/memory-and-files.md rewritten around the three steps and the search, a new docs/dreaming.md, and the memory skill updated, so that what I read is what the platform does ^dm-kwx7

## Implementation Decisions

- **Ticket 00 first: the duty seam and the bounded-step helper**, with the moves the plugin audit lists; the three steps are built on them.
- **Three steps, three plugins, one contract shape.** Snapshot, sweep and dream are each a Robot plugin in the DSH sense (apps/worker/src/plugins/), each with: a trigger, a fixed instruction, a step limit, a skip rule, a tool allow-list, a usage source and a Trajectory record. They share one helper that runs "one bounded platform step on this agent with these tools and this instruction" so that none of them reimplements the loop. The idle plugins of v1.14 are refactored onto the same helper, not duplicated.
- **Snapshot contract.** Trigger: the compaction engine's decision that a compaction is due (the Robot's compaction subclass asks the plugin before summarising); in a Turn this happens at the budget, idle it happens as the sweep's first half. Instruction: "Compaction is about to replace your context with a summary. Write to your daily note what is in flight (what you are doing, what remains, what you decided) and to MEMORY.md what lasts. Do not reply to the owner. Then end." Step limit: 3 model steps. Tools: the file tools on the Workspace only. Skip: no event in the chapter since the last snapshot or sweep. Record: a session record plugin:mr-robot/snapshot with the paths written; file versions by author snapshot; usage source memory. The sweep (v1.18) keeps its own instruction and runs after the snapshot when both are due, in one step sequence, so an idle compaction sees: snapshot, sweep, compaction.
- **Warming then closing.** The idle plan becomes: warm at 54, 108, 162; at 216 run sweep (with its snapshot) and compact; a Wake-up before 216 cancels the plan as today. At the dream hour, if the live chapter has events since the last compaction, the same sequence runs first. Mr. Robot's default idleCompaction flag is removed; the warming schedule implies the close.
- **Search.** A memory_index table (FTS5 in the Robot's SQLite) with one row per paragraph of an indexed file: path, line range, text, the note's date from the file name when there is one, scope. Indexed set: MEMORY.md, AGENTS.md, SOUL.md, memory/**, dreams/**, and the Member files the Robot reads (USER.md, PROACTIVE_PREFERENCES.md, memory/world.md, memory/people/**), SPACE.md. The Workspace write path (Robot, owner, sweep, snapshot, dream, restore) reindexes the file; the first Turn after the upgrade indexes everything bounded per Turn. Tool memory_search({ query, limit? }) → ranked matches with path, lines, snippet, date; Subagents get it read-only. Vector search: out of scope; recorded.
- **Baseline.** The memory plugin stops adding daily notes; the prompt memory section gains the search rule and "read today's note with read when you need the thread of the day".
- **People pages.** Template under memory/people/_template.md shipped with the Workspace; pages are Member-scope files with a write exception for the Member's Robots enforced in the Workspace permission check (path prefix memory/people/); INDEX.md regenerated by the platform on every page write (name from the H1, role from the first "Role:" line, last touched); indexed by memory_search; shown in the Files view under Member files.
- **Dream contract.** Trigger: a DO alarm at 03:00 in the owner's time zone (the Member's zone; the Robot's zone when it differs), per Robot with dreaming on; skip when no daily note changed and no Attempt closed and no Ask was answered since the last dream. Model: Robot setting dreamModel with a Space default, else the Robot's model. The dream is a Turn with cause dream, its own chapter, step limit 12. Tools: file tools on the Workspace, memory_search, conversation_search, task_list, propose_skill, propose_member_file_edit, ask (one call allowed, enforced). Instruction (fixed, in the plugin): the inputs to read, the three outputs, the rules (write only your own files; propose the rest; at most one suggestion, only if PROACTIVE_PREFERENCES.md allows; do not greet; do not say). Inputs the plugin supplies in the Wake-up text: the list of chapters closed since the last dream, the Attempts failed or skipped, the Asks dismissed or rejected, with ids. Record: usage source memory; the Trajectory shows the dream like any Turn. Mr. Robot's dream gets his deputy reads for his Robots' notes and the people tidy instruction. The morning ask carries dismiss_on_move_on.
- **Settings.** dreaming: boolean (default true), dreamModel: route | null, both on the Robot and as Space defaults; the Robot settings page and the deputy settings tool edit them.
- **Glossary** per dm-1l9i.

## Plugin audit (2026-10-21, added at the owner's request)

"Everything is a plugin" is true of **capabilities** and false of **behaviour over time**. The capability plugins (apps/worker/src/plugins/, one per tool group or connector, each with tools, prompt rules and DSH seams) are the plugin layer the v1.3 ticket built, and the compaction engine, spill store and policy are DSH plugins mounted in compose. Everything that happens *between* Turns or *around* a call is hardwired into the Robot Durable Object class (robot.ts, 4,139 lines, 187 methods):

| Mechanism | Where it lives today | Shape it should have |
|---|---|---|
| Idle plan, cache warming, idle compaction and its memory step | robot.ts (planIdle, runIdle, warmCache, idleCompact) + robot/idle.ts | a plugin registering a duty on the alarm seam |
| Box idle stop | robot.ts (idleBox) | a duty of the places plugin |
| The say safety net and its ten-minute steer | robot.ts (quietSteer, the turn-end fallback) + agent/say.ts | the say plugin, on the agent's turn-stopping event and a duty |
| Auto review | robot.ts (reviewCall) + agent/auto-review.ts, wired into the ask gate host | a plugin providing the gate's review hook |
| The external fence | per tool in agent/web.ts, agent/exa.ts and the connectors | one decorator in the gated tool runtime, driven by the tool's external flag |
| Screenshot sweep, screen watch, outbox delivery, chain resume, sign-in capture expiry | robot.ts, each a line in runAlarm | duties of the plugin that owns the thing (browser, messaging, providers, connections) |
| Tasks firing, parked release, draining Wake-ups, Subagent resume | robot.ts runAlarm | **stay in the core**: they are the Robot's loop, not a behaviour mounted on it |

The alarm handler (runAlarm) is a fixed list of twelve calls in a fixed order; every mechanism of v1.14 to v1.17 added one line there and a few hundred lines to the class. v1.20 would add three more (the snapshot, the dream, the dream-hour close). The fix is one seam and one helper, built before the three steps:

- **The duty seam.** A service the Robot DO provides to its composition: register a named duty with nextAt(now), run(now) and an order. The alarm computes the earliest nextAt over the registered duties and the core's own moments (Tasks, parked Wake-ups, the Box), runs the due duties in declared order after the core's work, and re-arms. A duty never touches the Turn loop; it asks the core whether the Robot is idle and asks for a bounded step.
- **The bounded-step helper.** platformStep(agent, instruction, tool allow-list, step limit, usage source): one place that runs a platform-initiated step, records it in the Trajectory and books its usage. The snapshot, the sweep, the idle memory step and the dream are four callers of one function.
- **The moves that come with it** (mechanical, each behind its existing tests): idle warming and compaction to an Idle plugin on the duty seam; the Box idle stop to the places plugin; the safety net and its steer to the say plugin; Auto review to a plugin that supplies the review hook; the fence to the tool runtime decorator; screenshot sweep, screen watch, outbox delivery, chain resume and capture expiry to their owners' plugins as duties. The core keeps Tasks, parked Wake-ups, draining and Subagent resume.

What this buys: v1.20's three steps are three small plugins on two shared pieces; robot.ts shrinks by the behaviours that are not the loop; a new behaviour (a routine on a Discord reaction, a weekly report) is one plugin and no line in the core.

## Testing Decisions

A good test drives the system the way a person or a Robot does: through the edge API in workerd with the scripted model, or through a rendered PWA component with a stubbed API. No unit test on plugin internals; no test touches the network.

- **Workerd through the API with the scripted model** (prior art: v1.14 idle and compaction tests, v1.18 sweep tests, v1.6 conversation-search tests): the snapshot runs before a mid-Turn compaction and before an idle one, with its instruction and tools only, skipped without events, versions by author snapshot, a Trajectory record, usage under memory (dm-kg1p, dm-77dg, dm-tjlb, dm-r6km, dm-pifl); warming thrice then sweep and compaction at 216, a Wake-up cancelling, the dream-hour close, Mr. Robot included (dm-2ilu, dm-76yv, dm-zyxz); the baseline without daily notes, memory_search ranking and fields over the indexed set, reindex on every writer including restore, the bounded initial index, the child's read-only tool (dm-cl1p, dm-hmet, dm-yn3q, dm-vh11, dm-g4in); a people page written by two Robots of one Member with authors in history, INDEX.md regenerated, found by search, refused for another Member's Robot (dm-wtn9, dm-s0gy, dm-p7l1, dm-ii3r); the dream at 03:00 in the owner's zone, skipped without evidence, on the configured model, its inputs in the Wake-up, the dated dream file, the AGENTS.md section rewritten within 30 lines, a proposal path, exactly one ask with dismiss_on_move_on, no world tool present, its chapter and usage (dm-hx44, dm-ox7j, dm-pzxk, dm-alok, dm-4ybd, dm-s11z, dm-vjnv, dm-0ylj, dm-7s7w, dm-buya); Mr. Robot's dream reading his Robots' notes and proposing a Member-file edit, no cross-Robot write, the people tidy (dm-pt5b, dm-w15l, dm-kkgy); the settings and the Space defaults (dm-buya).
- **Component tests**: the dreaming switch and model in Robot settings and Space defaults; people pages under Member files in the Files view (dm-buya, dm-ii3r).
- **Scale test** (from v1.19): extended with the memory index: search answers under its budget on a year of notes (dm-yn3q).

## Out of Scope

Vector or hybrid search; stemming; people pages at the Space scope; relationship pages for groups; moving memories between Robots; Muse's idea curation, studying and quiet-moment passes; a dream that acts on the world; more than one suggestion a night; the Grok Bot [note] tier; daily notes back in the context.

## Further Notes

Decisions from 2026-10-21, with what was weighed.

- **The snapshot is an experiment with a written contract.** The owner was unsure about a step before every compaction and agreed to try it on the condition that its behaviour is documented so precisely that it cannot be lost; the contract above is that document, and the plugin shape keeps it removable.
- **Warming then closing.** The owner's rule: compaction after the third warming. It removes the special case of a chief that never compacts and gives every Robot a chapter per few hours of idleness.
- **Search, not injection.** The owner chose Muse's way for daily notes; full-text first, vectors only if full-text proves insufficient.
- **People pages are the organisation's feature.** Written directly by every Robot of a Member because the value is one page per customer across Robots; the file history (v1.18) is what makes the exception safe.
- **Dreams stay inside the Robot.** The owner weighed letting Mr. Robot move memories between Robots and decided against it: Member files are the shared channel, and the chief tends them; a Robot's job knowledge stays its own.
- **The morning question** is the one user-facing output of the night, by the owner's choice: "a person comes to work and has a question from a Robot with recommendations."
- Seams: the edge API in workerd with the scripted model; component tests; the v1.19 scale test. No new seam.