# 05: Add a definition: setup from a definition

**What to build:** Adding a definition creates a Robot in setup with its files; the interview asks only what belongs to the person; setup_complete proposes grants.yaml's Grants; Tasks are created paused and the Robot asks once whether to enable them (rm-xgau).

**Blocked by:** 04

**Status:** done

- [x] Workerd test: a definition becomes a setup Robot; the proposal matches grants.yaml; Tasks paused; one question after approval (rm-xgau)

## Closing note

definitions.test.ts, "Add a definition": a definition synced from the repository becomes Ben's Robot in setup, named after it, with SOUL.md, MEMORY.md and the skills in its Workspace (README.md and the two forms stay with the definition); the first request carries the definition's interview; setup_complete proposes grants.yaml's Grants met from Ben's Connection, ignoring what the model named, and reports the needs nothing meets; approval creates the Tasks paused and the approval's Wake-up asks once; the next Wake-up does not.

Decisions:
- POST /api/definitions/<slug>/add makes the Robot (the Space's createRobot with the definition); the Robot keeps the definition's title, README and both forms in its store, and its files are written into the Workspace as the platform before the templates fill what is missing.
- The setup prompt of an installed Robot says it is installed, quotes the README, asks only what belongs to the person and lets setup_complete propose the Grants; the identity name is the definition's title.
- setup_complete, for an installed Robot, proposes grants.yaml met from what the owner has: tool groups as they are; a connector by his Connection of that kind (the default one first, then his own); a login by his entries whose site has that registrable domain; a Host facet on each of his Hosts. What nothing meets is returned to the model as notMet, so it can tell the owner. The model's own Grant arguments are not used.
- Tasks: recurring Tasks are created and paused; a scheduled one cannot be paused, so it is created unscheduled with its planned moment in its instructions. The note listing them is added to the approval's Wake-up, once.
- Also: the first conversation-search test got the 90 s timeout its siblings have; it timed out once under the full suite's load.
