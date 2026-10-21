---
title: "Mr. Robot v1.18 — Persona and memory from first principles, file history, Robot definitions and the Marketplace, Home becomes Space"
status: ready-for-agent
story-prefix: rm
parent: mr-robot-v1.17.md
---

# Mr. Robot v1.18 — Persona, memory, definitions, Marketplace

## Problem Statement

The first-principles audit of 2026-10-20 and 2026-10-21 reached persona, memory and templates, with four research files behind it: how Muse keeps persona and memory (docs/research/muse-memory-and-persona.md), what users say about Muse and Grok Bot (docs/research/muse-vs-grok-bot-community.md), what a Grok Bot template is (docs/research/grok-bot-templates.md) and whether it can be downloaded (docs/research/grok-bot-templates-in-the-wild.md). The owner also turned the product toward organisations: Mr. Robot is to be a startup for companies as much as a tool for a household, and people in a company do not design Robots; they install ones someone designed. Findings:

1. **Five persona files answer two questions.** SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md and MEMORY.md came from the Muse layout. Users of Muse praise the readable files, and users of Grok Bot praise a single description that travels with a template. Both point at the same thing: *who I am* is one portable artefact; *what I learned about working here* is another, local one. IDENTITY.md duplicates set_identity's fields; TOOLS.md is a notebook of local tool quirks (device names, host aliases), which belongs with the working notes.
2. **Memory is prose and nothing tends it.** MEMORY.md is free prose with no fixed shape; the prompt asks the Robot to reconcile old entries, nothing else does. Muse consolidates daily notes into MEMORY.md in the background ("newer claims supersede older ones"); Grok Bot clamps and dedupes one-line facts. Mr. Robot has one bounded "write what matters" step before idle compaction and no consolidation.
3. **Edits can vanish.** The most repeated complaint about Muse is that a persona or memory edit disappears; the most repeated worry is a silent dossier. Mr. Robot keeps one version of every file; the owner cannot see who changed SOUL.md or bring an edit back.
4. **A Robot cannot be handed to someone else.** A Robot is a Durable Object with files, grants, Tasks and skills; nothing turns it into a thing another Member, or another deployment, can add. Grok Bot's templates are lossy summaries (instructions empty in 90 of 90, routines without schedules), but their marketplace is the way a company's people get a working Bot without designing one.
5. **The word Home.** It names the group of people who share a deployment. It fits a household and nothing else; Team is reserved for a later concept (one organisation, many teams). The word positions the product, so it changes now, while it is 400 occurrences and not 4,000.

## Solution

**Two persona files.** SOUL.md (who the Robot is, how it talks, what it never does: the portable description) and AGENTS.md (how it works here: conventions, lessons, and a section of local tool notes). IDENTITY.md and TOOLS.md go; a migration folds their content into set_identity's fields and into AGENTS.md. The setup interview writes SOUL.md and AGENTS.md; the prompt, docs, templates and the Files view follow.

**MEMORY.md with Muse's shape.** Three fixed sections, Facts, Preferences, Commitments, with the rule in the template: promote what lasts here, leave the raw detail in daily notes. Free prose, written with the file tools as today; no fact tool. Daily notes stay as they are.

**Memory sweep at compaction.** The bounded step before an idle compaction becomes the memory sweep: read the daily notes since the last sweep and MEMORY.md, move what lasts into the right section, correct what is superseded where it stands, invent nothing, then end; the same model on the warm cache, so it costs little. It runs before every idle compaction and nowhere else. A nightly "dreaming" pass on a small model is a separate plugin for later and is recorded as postponed.

**File history.** Every write to a persona file, a memory file or a Member file keeps the previous version with its author (the Robot, the owner, Mr. Robot, the sweep) and time. The Files view shows a file's history and restores a version; a restore is itself a version. History is bounded (the last 50 versions of a file, 90 days) and lives in the Workspace under a hidden prefix.

**Robot definitions in the library.** A Robot definition is a directory robots/<slug>/ in the Space's library repository (the one the skill library syncs from): SOUL.md, AGENTS.md, MEMORY.md with facts and rules and no owner data, skills/, tasks.yaml (recurring and scheduled Tasks with their rules and instructions), grants.yaml (what the Robot needs: tool groups, connectors by kind, logins by purpose, Host facets), README.md (title, one paragraph, what the interview will ask). The platform writes tasks.yaml and grants.yaml and reads them; people read and diff them and never write them. Export: "Save as definition" on a Robot copies the files mechanically, then gives the Robot one bounded step to remove what is about its owner and write README.md, then commits to the library. Import: a new Robot in setup with the definition's files; the interview asks only what belongs to this person; setup_complete proposes the Grants grants.yaml names; Tasks are created paused and the Robot asks once whether to enable them. Snapshot, not link; Git is the versioning and the transport between deployments.

**The Marketplace.** A page in Mr. Robot listing the Space's definitions (title, paragraph, what it needs, who made it, when changed) with Add. Publishing is the Space admin's: export from a Robot, or a definition committed to the library repository. Add from a Grok Bot marketplace address is the same path with a lossy importer: the page's embedded object becomes a definition in a "brief" state (description to README and SOUL.md's first draft, memories to MEMORY.md Facts, skills to one-line SKILL.md stubs, routines to Tasks without a Timing, integrations to grants.yaml with a note when no Connector exists), labelled "imported summary; Grok Bot keeps the recipe closed", for the person's own use.

**Home becomes Space.** The group of people sharing a deployment is a Space: Space admin, SPACE.md, "shared with the Space", the Space's library and Marketplace. Code, protocol, UI, docs and glossary follow; the word is the owner's to change before the rename lands.

## User Stories

### Persona
1. As a Robot, I want my persona to be SOUL.md (who I am, how I talk, what I never do) and AGENTS.md (how I work here, with a section for local tool notes), so that who I am and what I learned are two files ^rm-2asl
2. As an owner, I want IDENTITY.md and TOOLS.md gone, with a migration that folds an existing IDENTITY.md into the Robot's identity fields and SOUL.md and an existing TOOLS.md into AGENTS.md's tool notes, so that nothing a Robot wrote is lost ^rm-x8nc
3. As a Robot, I want the setup interview to write SOUL.md and AGENTS.md and the templates, prompt and docs to name only these, so that a new Robot starts with the new shape ^rm-jnth
4. As an owner, I want the Files view to show SOUL.md and AGENTS.md first, so that the persona is where I look ^rm-w88a

### Memory
5. As a Robot, I want MEMORY.md with three fixed sections, Facts, Preferences and Commitments, and the rule to promote what lasts and leave detail in daily notes, so that my memory has a shape ^rm-d5c5
6. As an owner, I want an existing MEMORY.md migrated under a Facts heading with its text intact, so that the shape arrives without loss ^rm-8le0
7. As a Robot, I want the memory section of the platform prompt to name the three sections and the daily notes and to say that the sweep tidies what I wrote, so that I write to the right place ^rm-ocg4

### Memory sweep
8. As a Robot, I want one bounded step before every idle compaction, the memory sweep, in which I read the daily notes since the last sweep and MEMORY.md, move what lasts into its section, correct what is superseded where it stands and invent nothing, so that my memory stays current without the owner's help ^rm-glmd
9. As an owner, I want the sweep to run on the Robot's own model on the warm cache, bounded by a step limit, never during a Turn, and to replace the "write what matters" step rather than add to it, so that it costs little and never interrupts ^rm-5org
10. As an owner, I want the sweep's writes recorded as versions by the sweep and a Trajectory entry naming what it changed, so that I can see and undo what it did ^rm-hhxa
11. As an owner, I want the sweep skipped when no daily note changed since the last one, so that it never runs for nothing ^rm-l4t8

### File history
12. As an owner, I want every write to a persona file, a memory file or a Member file to keep the previous version with its author and time, so that an edit is a revision, not a hope ^rm-d68k
13. As an owner, I want the Files view to show a file's history and let me open a version and restore it, a restore being a new version, so that a lost edit comes back ^rm-7jo4
14. As an owner, I want history bounded to the last 50 versions of a file and 90 days, kept under a hidden prefix of the Workspace, so that it never crowds the files ^rm-xusr
15. As a Robot, I want a change note to name who changed a file, including the sweep and a restore, so that I know what happened to my files ^rm-cvl8

### Robot definitions
16. As a Space admin, I want a Robot definition to be a directory robots/<slug>/ in the library repository with SOUL.md, AGENTS.md, MEMORY.md, skills/, tasks.yaml, grants.yaml and README.md, so that a Robot is a thing in Git ^rm-hjpa
17. As an owner, I want "Save as definition" on a Robot to copy its files mechanically, give it one bounded step to remove what is about me and write README.md, and commit to the library, so that a working Robot becomes a definition ^rm-gv6s
18. As an operator, I want tasks.yaml and grants.yaml written by the platform in a strict YAML 1.2 form and parsed with a schema that refuses unknown fields, so that people read them and never write them ^rm-tszp
19. As a Member, I want to add a definition and get a new Robot in setup with its files, an interview that asks only what belongs to me, Grants proposed from grants.yaml at setup_complete, and Tasks created paused with one question whether to enable them, so that a designed Robot becomes mine in one conversation ^rm-xgau
20. As a Space admin, I want definitions synced from the library repository like skills, so that Git is the versioning and the transport ^rm-vob8
21. As an owner, I want a definition to be a snapshot, with no link back to the Robot it came from, so that nothing changes under me ^rm-gxp7
22. As a Member, I want a definition's grants.yaml to name connectors by kind and logins by purpose, never a Connection or an entry of someone else, so that nothing private travels ^rm-77oh

### The Marketplace
23. As a Member, I want a Marketplace page listing the Space's definitions with title, paragraph, what each needs, who made it and when it changed, with Add, so that I install a Robot someone designed ^rm-vhrq
24. As a Space admin, I want publishing to be mine: Save as definition from a Robot, or a directory committed to the library, so that the catalogue is curated ^rm-mv69
25. As a Member, I want Add from a Grok Bot marketplace address to fetch the page, read its embedded object and build a definition in a brief state, so that 90 public briefs are a start ^rm-pdgk
26. As a Member, I want the imported definition labelled "imported summary; Grok Bot keeps the recipe closed" and mapped as the spec says (description to README and SOUL.md draft, memories to Facts, skills to one-line stubs, routines to Tasks without a Timing, integrations to grants.yaml with a note when no Connector exists), so that nothing pretends to be what it is not ^rm-ewhv
27. As a Space admin, I want the importer to refuse a page it cannot parse with a plain message, and never to guess a field, so that an import is either faithful or absent ^rm-zutf
28. As a Member, I want the Marketplace to show which of a definition's needs I already have (a Connection of that kind, a Host), so that I know what Add will ask for ^rm-10ai

### Home becomes Space
29. As an owner, I want the group of people sharing a deployment called Space everywhere: Space admin, SPACE.md, "shared with the Space", the Space's library and Marketplace, in the app, the API, the docs, the prompt and the glossary, so that the word fits a household and a company ^rm-en62
30. As an operator, I want the code's Home names (the Durable Object class, modules, protocol types) renamed with the word, with a migration for stored names such as HOME.md, so that the code says what the product says ^rm-lseo
31. As an owner, I want old Conversations and files to render after the rename, so that history survives ^rm-sina

### Docs and glossary
32. As an owner, I want the glossary to define Definition, Marketplace, File history, Memory sweep and Space, to drop IDENTITY.md, TOOLS.md and Home, and to keep every spec and doc to those words ^rm-weck
33. As a Robot, I want docs/memory-and-files.md, docs/robots.md and docs/mr-robot.md rewritten for the two persona files, the memory shape, the sweep and history, and a new docs/definitions.md, so that what I read is what the platform does ^rm-31kc
34. As a Robot, I want the writing-as-owner and asking skills unchanged and a platform skill memory added (what goes where, how to correct, what the sweep does), so that practice is written once ^rm-zoee

## Implementation Decisions

- **Persona.** PERSONA_FILES becomes ['SOUL.md', 'AGENTS.md', 'MEMORY.md']; the baseline order is AGENTS.md, MEMORY.md, SOUL.md (broad to specific, SOUL last so it is cut last). Migration on first Turn after the upgrade: IDENTITY.md's name/title/description lines are read into the identity fields when they are empty and its remaining text is appended to SOUL.md under "## Identity notes"; TOOLS.md's text is appended to AGENTS.md under "## Tool notes"; both files are deleted after a version is kept. Templates rewritten; set_identity unchanged.
- **MEMORY.md.** Template with the three headings and Muse's rule as a comment. Migration: an existing MEMORY.md without the headings gets "## Facts" prepended and the other two headings appended empty.
- **Sweep.** The idle-compaction memory step's instruction is replaced by the sweep instruction; the step is skipped when no file under memory/ changed since the recorded last sweep; writes go through the Workspace with author 'sweep'; the Trajectory records a sweep entry with the paths changed. Dreaming: postponed ticket.
- **File history.** The Workspace write path for the tracked set (SOUL.md, AGENTS.md, MEMORY.md, memory/*.md, USER.md, PROACTIVE_PREFERENCES.md, memory/world.md, SPACE.md) copies the previous object to .history/<path>/<timestamp>-<author>.md before overwriting; a trim keeps 50 per file and 90 days; the file API gains list-history, read-version and restore; the Files view gets a History drawer. Change notes carry the author.
- **Definitions.** Library sync (skills) extends to robots/; a definition's tasks.yaml and grants.yaml are produced by the platform from the Task and Grant rows (Tasks: recurring and scheduled only, with rule, time zone, instructions, enabled: false; Grants: tool groups, connector kinds, login purposes, Host facets, each with the requested level) and parsed with the `yaml` package in YAML 1.2 core schema (no 'no' is false) into Effect schemas that reject unknown keys. Export runs the Robot for one bounded step with the files staged in a temporary Workspace prefix, then commits through the existing library sync's write path. Import creates the Robot in setup with status 'setup' and a definition reference; setup_complete reads grants.yaml for its proposal; Tasks are created from tasks.yaml with enabled false and the Robot's first message after approval asks once.
- **Marketplace.** A page under the Space (admin: publish and remove; Members: list and Add); needs matched against the Member's Connections by connector kind and Hosts. The Grok importer: fetch with a browser User-Agent, find the RSC pushes, extract the object with the 18 known keys (id, name, creatorName, handle, description, summary, categories, installCount, color, shape, addHref, imageUrl, updatedAt, instructions, memories, skills, routines, integrations), refuse on any missing key; map as the stories say; the definition's README carries the label and the source URL; the definition is stored for the importing Member and not committed to the library unless the admin publishes it.
- **Rename.** Home → Space across the Durable Object class name (with a Wrangler/Alchemy class migration), modules under src/home → src/space, protocol types, routes, strings, docs, prompt and glossary; HOME.md → SPACE.md with a Workspace migration; the word is the owner's to change before ticket 09 starts.
- **Glossary** per rm-weck.

## Testing Decisions

A good test drives the system the way a person or a Robot does: through the edge API in workerd with the scripted model and the library stub, or through a rendered PWA component with a stubbed API. No unit test on plugin internals; no test touches the network (the Grok importer is tested against a saved page fixture).

- **Workerd through the API with the scripted model** (prior art: v1.3 memory tests, v1.14 idle tests, v1.15 skills tests): the persona set and baseline order, the IDENTITY.md and TOOLS.md migrations with versions kept (rm-2asl, rm-x8nc, rm-jnth); the MEMORY.md template and migration (rm-d5c5, rm-8le0); the sweep runs before idle compaction with its instruction, skips without changed notes, writes with author sweep and a Trajectory entry (rm-glmd, rm-5org, rm-hhxa, rm-l4t8); history kept on each write with author, listed, a version read and restored as a new version, trimmed at 50 and 90 days, change notes naming the author (rm-d68k, rm-7jo4, rm-xusr, rm-cvl8); a definition exported with the owner-scrub step and committed through the library stub; tasks.yaml and grants.yaml round-trip, unknown keys refused, 'no' stays a string (rm-hjpa, rm-gv6s, rm-tszp, rm-gxp7, rm-77oh); import creates a setup Robot, the interview proposes grants.yaml's grants, Tasks arrive paused and the Robot asks once (rm-xgau, rm-vob8); the Marketplace list with needs matched (rm-vhrq, rm-mv69, rm-10ai); the Grok importer against a fixture page: the object found, the mapping, the label, a broken fixture refused (rm-pdgk, rm-ewhv, rm-zutf); the rename: old logs render, HOME.md migrated (rm-en62, rm-lseo, rm-sina); the memory skill in the index (rm-zoee).
- **Component tests** (prior art: v1.15 to v1.17): the Files view order and History drawer with restore (rm-w88a, rm-7jo4); the Marketplace page with Add and needs (rm-vhrq, rm-10ai); the Space wording in the sidebar, settings and admin (rm-en62).
- **Alchemy plan test**: the Durable Object class rename migration (rm-lseo).

## Out of Scope

A fact tool (remember/forget) or Grok-style clamps; a search index or embeddings over memory; nightly dreaming on a small model (postponed plugin); a public marketplace across deployments or a share link for definitions; a definition that follows its source Robot; importing anything from Grok Bot beyond the public page object; Team as a concept; renaming Member or Robot; a notification contract on Tasks; history for files outside the tracked set.

## Further Notes

Decisions from the audit sessions of 2026-10-20 and 2026-10-21, with what was weighed.

- **Two persona files, not one and not five.** The agent first proposed one PERSONA.md; the community research showed that users value SOUL.md as a readable character *and* a description that travels; the owner noted TOOLS.md is a quirks notebook, not tool descriptions (DSH supplies those), so it merges into AGENTS.md; IDENTITY.md duplicates structured fields.
- **Prose memory, Muse's sections, no fact tool.** Grok's one-line facts serve textual dedupe and hard clamps, and no user praises Grok's memory; Muse's readable file is the praised one. The sweep takes the consolidation role Muse gives to background jobs, at the one moment Mr. Robot already has (before idle compaction), on the same model and warm cache. Dreaming on a small model would invalidate the cache and is its own plugin.
- **History answers both complaints about Muse**: vanished edits and a silent dossier.
- **Definitions in Git, Marketplace in the app.** For a household Git alone would do; for an organisation people install Robots they did not design, so the catalogue is a page and publishing is the admin's. The Grok importer was taken with a label, after the owner's caution: it yields a brief, never a working Robot, and the legal terms allow own use only.
- **YAML, written by machines.** The owner distrusts YAML when people write it ("NO becomes false"); the files are produced and parsed by the platform in YAML 1.2, so the readability in a diff is kept and the pitfalls are not.
- **Space.** The owner asked for a word that fits a household and a large company and is not Team; Space is the agent's proposal, to be confirmed or replaced before the rename ticket starts.
- Seams: the edge API in workerd with the scripted model and the library stub; component tests; a fixture for the Grok page. No new seam.
