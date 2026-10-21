# 09: Home becomes Space

**What to build:** The group of people sharing a deployment is renamed everywhere: app, API, Durable Object class (with a class migration), modules, protocol, docs, prompt, glossary; HOME.md becomes SPACE.md with a Workspace migration; old Conversations render. The word is the owner's to confirm before this ticket starts (rm-en62, rm-lseo, rm-sina).

**Blocked by:** None (starts after the owner confirms the word)

**Status:** done

- [x] Workerd test: old logs render; HOME.md migrated; strings and routes carry the word (rm-en62, rm-lseo, rm-sina)
- [x] Alchemy plan test: the class rename migration (rm-lseo)
- [x] Component test: the word in sidebar, settings and admin (rm-en62)

## Closing note

The owner confirmed the word Space (through the planning session). Two commits: the names, words and routes, then the stored and wire values (asked for by the planning session).

Tests: apps/worker/test/space-rename.test.ts (HOME.md's stored text read as SPACE.md by every Robot under the new name; the routes; the system prompt says Space and never Home; the object named home moved to space at the first touch with its values renamed and the old object stopped; a Robot's stored sharing and spend limit migrated; a client's 'home' taken for one release); session-log-upgrade.test.ts (an old Conversation renders, unchanged); infra/stack.test.ts (the binding SPACE is the namespace with logical id 'Home' and className 'Space': Alchemy reconciles DO classes by logical id, so the deploy uploads a renamed_classes migration Home → Space and keeps the storage); the PWA's admin, settings and Mission Control tests now assert "Space settings", "Space default", "Whole Space" (admin-home-settings.test.tsx is admin-space-settings.test.tsx).

What was renamed:
- Code: the Durable Object class Space (binding SPACE; wrangler.dev.jsonc has a v2 renamed_classes migration), src/home → src/space (space.ts), every type, function and variable (SpaceSpendLimit, SpacePlatform, SpaceSettings…, wholeSpace, SPACE_ID, SPACE_NAME with MR_ROBOT_SPACE, MR_ROBOT_HOME still read when it is not set), the protocol field Me.space.
- Words: the UI, the platform prompt, the product docs and platform skills, errors and comments.
- Routes: /api/space-memory, /api/admin/space-memory (and its history), scope=space for Mission Control and the Task list.
- The file: HOME.md is SPACE.md; the Space's setting keys home-md and home-md-author move to space-md and space-md-author on first touch; a member-file proposal made before names HOME.md and is still applied to SPACE.md.

Stored values migrated (written only as 'space' from now on):
- Space Durable Object: the object name is now 'space'. On its first touch the Space object takes every table's rows from the object named 'home' (exportForMove), then renames the values; the old object marks itself moved, deletes its alarm and does nothing more; its rows stay for one release. Tables renamed on every start (idempotent): robot.sharing, host.sharing, skill.visibility, skill.source.
- Robot Durable Object: store migration 28: the config's sharing and spendLimit.kind, and an open skill proposal's payload visibility.
- Member Durable Object: host.sharing.
- Member profile: Mission Control's switch stored as mission.wholeHome is read as wholeSpace.

One-release aliases, to remove after the next release: decodeBody maps a body's 'home' to 'space' for the keys sharing, visibility and scope and for spendLimit.kind (edge/http.ts, withSpaceValues); scope=home is still a whole-Space list (edge/api.ts, wholeSpaceAsked); the member profile's wholeHome (member.ts, profile); the move from the object 'home' (space.ts, LEGACY_SPACE_ID, exportForMove, moveFromHome) and HOME.md's setting keys (renameHomeMemory); the HOME.md name in member-file proposals (programs.ts).

Also: the Box spend-limit test now waits for the blocked state, which reaches the registry a moment after the stop under the suite's load.
