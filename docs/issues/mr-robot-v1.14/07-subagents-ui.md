# 07: Subagents in the PWA and Mission Control

**What to build:** The Robot header shows "N Subagents" with a dropdown (label, model, status, since); each opens the Subagent's own Chat and Trajectory with a Stop button and no composer (ao-ce55). The Robot's Chat shows one card per delegation (label, model, status, result line); the Trajectory shows the delegation as one entry that opens the child's Trajectory (ao-15ui, ao-i3q9). Mission Control's Fleet row reads "working · N Subagents" and expands to one line per Subagent with label, since when, running tool and Interrupt (ao-j8t9).

**Blocked by:** 06

**Status:** done

- [x] Component test: header control lists children and opens #/robots/:id/subagents/:child (ao-ce55)
- [x] Component test: the child view has Stop and no composer; Stop calls the interrupt API (ao-ce55)
- [x] Component test: the delegation card in Chat and the delegation entry in the Trajectory (ao-15ui, ao-i3q9)
- [x] Component test: the Fleet row shows the count and expands; Interrupt on a line calls the child interrupt API (ao-j8t9)

**Closing note:** The route is `#/r/:id/subagents/:child` (and `/trajectory`), after the app's other Robot pages (`#/r/...`), not `#/robots/...`. The delegation cards come from the Robot's Subagent rows, so a delegation made inside a code-mode program has its card too. The Fleet row's lines open over the table, so the windowed rows keep one height. The Trajectory lists the delegations (and the Auto review decisions) above DSH's log view; each entry opens the Subagent's own Trajectory.
