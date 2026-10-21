# 07: Import a Grok Bot template as a brief

**What to build:** Add from a Grok Bot marketplace address: fetch with a browser User-Agent, extract the 18-key object from the RSC payload, refuse on any missing key, map to a definition in a brief state with the label and the source URL, stored for the importing Member until the admin publishes it (rm-pdgk, rm-ewhv, rm-zutf).

**Blocked by:** 05

**Status:** done

- [x] Workerd test against a saved page fixture: the object found; the mapping of description, memories, skills, routines and integrations; the label; a broken fixture refused (rm-pdgk, rm-ewhv, rm-zutf)

## Closing note

apps/worker/test/grok-import.test.ts against test/fixtures/grok-overheard.html (the page's shape from docs/research/grok-bot-templates-in-the-wild.md §3 with the research's verbatim template object in two Next.js flight pushes): the browser User-Agent; the object found; the mapping of description, memories, skills, routines and integrations; the label and the source; the brief for the importer only; refused when a key is missing, when there is no flight data, and when the address is not a marketplace page.

Decisions:
- POST /api/definitions/import {url} takes only https://x.ai/bot/marketplace/bots/<slug>; the definition is grok-<slug>, source 'import', unpublished, owned by the importing Member; importing it again replaces it. The Marketplace page has the address field.
- Extraction: every self.__next_f.push([1, "…"]) string is JSON-unescaped and joined, each {"id":"<slug>" is brace-matched outside strings, and the object must have all 18 keys and the known field shapes (an Effect schema); a missing key is named in the refusal, nothing is guessed.
- Mapping: README.md is the title, the summary, the label "Imported summary; Grok Bot keeps the recipe closed." with the source and the creator, and an interview list (what to watch, when each routine runs); SOUL.md is a marked first draft from the description; MEMORY.md's Facts are the memories; each skill is a SKILL.md stub with the one sentence, marked as a stub; each routine is an unscheduled paused Task (the template has no schedule); integrations map by name to google (Gmail, Google Calendar, Drive and the like), slack and discord at ask, the rest are notes in grants.yaml ("X: no Connector in Mr. Robot (…)"). Tool groups files, web and tasks at allow.
- The fixture is .html read as raw text; a test d.ts declares the module.
