# 01: Two persona files and the memory shape

**What to build:** SOUL.md and AGENTS.md (with a tool-notes section) replace the five-file persona; IDENTITY.md folds into the identity fields and SOUL.md, TOOLS.md into AGENTS.md, both after a kept version; MEMORY.md gets the Facts / Preferences / Commitments headings with a migration; templates, setup interview, prompt memory section, Files view order and the memory platform skill follow (rm-2asl, rm-x8nc, rm-jnth, rm-w88a, rm-d5c5, rm-8le0, rm-ocg4, rm-zoee).

**Blocked by:** 02

**Status:** done

- [x] Workerd test: the persona set and baseline order; both migrations keep a version and lose no text; the MEMORY.md migration (rm-2asl, rm-x8nc, rm-d5c5, rm-8le0)
- [x] Workerd test: the prompt memory section and the memory skill in the index (rm-ocg4, rm-zoee)
- [x] Component test: the Files view order (rm-w88a)
- [x] Templates and the setup prompt name only the new files (rm-jnth)

## Closing note

apps/worker/test/persona.test.ts (the set and the baseline order; the fold of IDENTITY.md and TOOLS.md and the MEMORY.md shape, each with a kept version and no text lost, once only; the prompt's memory lines and the skill memory in the catalog) and apps/web/test/files-order.test.tsx (the Files view order). files-view.test.ts and workspace.test.ts now expect three persona files.

Decisions:
- The fold runs once per Robot in the Workspace tidy pass at the start of a Turn (a kv flag), like the earlier one-time Workspace upgrades. It writes as "the platform", so each old file's last version is in its history (ticket 02) and the owner can read or restore it.
- IDENTITY.md: Name, Title or Role, and Description lines fill only identity fields that are empty (a set name always wins); every other line the Robot wrote (Character, Vibe, Emoji, free text) goes to a new "## Identity notes" section of SOUL.md. Lines equal to the old template, and placeholders such as "_(what you will be called)_", are dropped as empty.
- TOOLS.md: the lines the Robot wrote go to a "## Tool notes" section of AGENTS.md; the new AGENTS.md template has that section empty.
- MEMORY.md: a file without the three headings gets them, its text under Facts (the sweep of ticket 03 sorts it later); a file with some gets the missing ones at the end.
- The baseline order is AGENTS.md, MEMORY.md, SOUL.md after the shared files: SOUL.md is the most specific and is cut last.
- The prompt names the three files in one line, to stay inside the prompt's 2 900-word budget. What goes where and the sweep are in a new platform skill, memory, shown to every Robot (the platform-skill tests now list it).
- The product docs' persona lists were updated now so that they do not name files that are gone; ticket 08 rewrites them.
- The Fleet test from v1.19 was made deterministic (it now waits for the Box Job to spawn before it releases it); it had timed out once under load.
