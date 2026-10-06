# 07: Code mode executor, tool grants, advanced settings

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-ax7s, robot-f9ln, robot-0ms7, robot-cobv, robot-1rap

**What to build:** The robot works in code mode by default: it writes a program that calls its granted tools inside the executor chosen in ticket 02; the advanced settings page has a switch to direct tool calls. Every tool and skill is off until granted; the Cordis composition for a robot is built from its grants and settings at DO boot. A robot asks for more by a grant proposal the Member answers; the stored proposal is applied exactly. No shell, terminal or container tool exists.

**Blocked by:** 02 Code-mode isolate prototype and decision; 04 Robot creation interview, grant approval, Mr. Robot bootstrap

**Status:** done

- [x] With code mode on, one turn with three tool calls produces one executed program in the trajectory
- [x] A tool not granted is absent from the robot's catalog and from the executor's bindings
- [x] Grant proposal appears as a question; answering applies the exact stored set
- [x] Advanced settings changes (model, effort, budget, code mode, grants) take effect on the next turn

Verified live 2026-10-07: later Grant proposal and direct tool calls (verification.md 10, 46).
