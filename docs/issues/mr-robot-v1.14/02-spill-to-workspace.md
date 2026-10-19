# 02: Oversized tool results spill to the Workspace

**What to build:** A tool result over the inline budget reaches the Robot as head and tail plus the path of the complete result under spill/ in its Workspace, readable with read (line range) and grep; nothing a tool returned is lost (ao-hf02, ao-5lzl, ao-ry61, ao-antj). A WorkspaceSpillStore over R2 backs DSH's spill policy; the inline budget follows the context budget (budget / 16, floor 2 000, cap 12 500); spill files older than 30 days are tidied on the workspace tidy pass; the Files view lists spill/ last.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test: a scripted tool returning more than the budget yields head, tail, the Workspace path, and the file is readable with read and grep (ao-hf02, ao-5lzl)
- [ ] Workerd test: a Robot with a small context budget spills sooner than one with a large budget (ao-antj)
- [ ] Workerd test: a spill file older than 30 days is removed by the tidy pass; a younger one stays (ao-ry61)
- [ ] Component test: Files view sorts spill/ after every other folder (ao-ry61)
