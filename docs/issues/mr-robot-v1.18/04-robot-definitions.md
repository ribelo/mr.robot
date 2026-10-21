# 04: Robot definitions: export, YAML forms, library sync

**What to build:** A definition directory robots/<slug>/ in the library repository; Save as definition copies the Robot's files, runs one bounded owner-scrub step that writes README.md, and commits through the library sync; tasks.yaml and grants.yaml are produced by the platform in YAML 1.2 and parsed by schemas that refuse unknown keys; grants name connector kinds and login purposes only; definitions sync like skills; a definition is a snapshot (rm-hjpa, rm-gv6s, rm-tszp, rm-vob8, rm-gxp7, rm-77oh).

**Blocked by:** 01

**Status:** done

- [x] Workerd test: export through the library stub with the scrub step; YAML round-trip; unknown keys refused; 'no' stays a string; grants carry kinds and purposes only; sync lists definitions (rm-hjpa, rm-gv6s, rm-tszp, rm-vob8, rm-gxp7, rm-77oh)

## Closing note

apps/worker/test/definitions.test.ts: the forms round-trip, "no" and "off" stay strings, unknown keys and enabled: true are refused; Save as definition with the scrub step through the scripted model; grants.yaml with connector kinds and login purposes only (no Connection id or label); tasks.yaml paused; the staging copies removed and the Robot's files untouched; a later edit does not reach the definition; the downloaded tar.gz committed to the repository syncs back as source git and replaces the saved row; a Member's saved definition stays his until published; the sync refuses a broken form and removes a definition gone from the repository.

Decisions (the first two agreed with the planning session):
- There is no Git write path in the code: the library sync only downloads the repository's tarball. Save as definition stores the definition in the Space's library like an approved Robot skill: R2 under definitions/<slug>/ and a library row (definitions/library.ts) with source 'robot'. The sync reads robots/<slug>/ directories (any with a README.md or SOUL.md) into the same library as source 'git'.
- Git stays the transport through "Download definition": GET /api/definitions/<slug>/archive returns the directory as a gzipped tar with the paths robots/<slug>/..., the files the repository would hold. The admin commits it by hand; the next sync reads it as source 'git'. The two rows reconcile by slug: the repository's wins and the saved one is replaced. A saved definition may not take a slug the repository holds, or another Member's. The Marketplace and admin buttons for it come with ticket 06.
- The forms: YAML 1.2 core schema through the yaml package (a new dependency of the Worker, as the spec names it), strict and with unique keys, decoded by Effect schemas with excess properties refused. Every file begins with "Written by Mr. Robot … do not edit it by hand". tasks.yaml holds the Robot's open recurring and scheduled Tasks, a scheduled moment as ISO text, enabled always false (the schema accepts nothing else). grants.yaml holds tool groups with levels, connectors by kind with write, logins by the registrable domains of their websites ("a login without a website" when there is none), Host facets; denied items are left out. An unscheduled timing is allowed in the form for the Grok importer's routines (ticket 07).
- The scrub is one bounded step (6 model steps at most) of the Robot on its own model: the files are staged under definition-draft/<slug>/ in its Workspace, it edits only those copies and writes README.md (title, one paragraph, "The interview will ask:"). Without a README.md the platform writes one from the identity. A working Robot answers 409.
- A definition saved by the admin is published at once; a Member's stays his own (ticket 06 adds publish and remove).
