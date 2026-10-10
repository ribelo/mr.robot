# 10: Workspace hygiene: templates, screenshots, Start over, orphans

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-vhlb, sk-m7t1, sk-8won, sk-gf2e, sk-44d5

**What to build:** New Robots have no memory/bank/; a Robot removes its untouched memory/bank templates at the next Turn start. Screenshots are stored under a per-Robot system prefix outside the Workspace, never listed in Files, swept after 7 days, still shown in the chat. "Clear history" clears only the Conversation; "Start over" clears it and resets the whole Workspace to templates except docs/, keeping Grants, Routines, Connections and settings. The Reset everything dialog lists what stays. A one-time Home migration destroys the files of Robots soft-deleted before v1.3 (destroy deletes by the id it is called with, not the DO's config).

**Blocked by:** 02 (Start over must spare docs/)

**Status:** done

- [x] Template and migration for memory/bank; screenshots outside the Workspace with a 7-day sweep (fake-time test)
- [x] Clear history and Start over in the list menu and Advanced settings with typed-name confirmation; Reset everything dialog text
- [x] Orphan migration tested against a registry row with status deleted and an empty DO
