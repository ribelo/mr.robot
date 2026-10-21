# 08: Glossary and docs

**What to build:** The glossary defines Definition, Marketplace, File history, Memory sweep and Space and drops IDENTITY.md, TOOLS.md and Home; docs/memory-and-files.md, docs/robots.md and docs/mr-robot.md rewritten; docs/definitions.md added (rm-weck, rm-31kc).

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 09

**Status:** done

- [x] GLOSSARY.md and the named docs updated; a grep for IDENTITY.md, TOOLS.md and the old group word returns nothing but history (rm-weck, rm-31kc)

## Closing note

GLOSSARY.md defines Space (once Home), Definition, Marketplace, File history and Memory sweep, gives Persona files the two-file shape, and says Space everywhere; README.md says Space. The product docs the Robots read: memory-and-files (the three sections, the memory sweep, file history), robots (the persona list, a pointer for a Robot added from a definition), mr-robot (Space, from ticket 09), and the new docs/definitions.md (what a definition holds, Save as definition, the library repository with Download definition and the hand commit, the Marketplace and setup from a definition, Grok Bot briefs). docs.test.ts lists the new doc; the prompt's 2 900-word budget and the docs' 900-word limit hold, so the index lines are short.

A grep for IDENTITY.md, TOOLS.md and Home outside docs/issues and docs/research finds only history: the one-time migrations (persona-fold.ts, the fold in robot.ts, the history set that keeps their old versions, the History drawer's list) and the one-release aliases of ticket 09.

The requires-hosts test failed once under the full suite's load and passed six times alone and in the next full run; it was not touched.
