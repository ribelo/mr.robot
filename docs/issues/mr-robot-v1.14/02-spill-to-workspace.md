# 02: Oversized tool results spill to the Workspace

**What to build:** A tool result over the inline budget reaches the Robot as head and tail plus the path of the complete result under spill/ in its Workspace, readable with read (line range) and grep; nothing a tool returned is lost (ao-hf02, ao-5lzl, ao-ry61, ao-antj). A WorkspaceSpillStore over R2 backs DSH's spill policy; the inline budget follows the context budget (budget / 16, floor 2 000, cap 12 500); spill files older than 30 days are tidied on the workspace tidy pass; the Files view lists spill/ last.

**Blocked by:** 01

**Status:** done

- [x] Workerd test: a scripted tool returning more than the budget yields head, tail, the Workspace path, and the file is readable with read and grep (ao-hf02, ao-5lzl)
- [x] Workerd test: a Robot with a small context budget spills sooner than one with a large budget (ao-antj)
- [x] Workerd test: a spill file older than 30 days is removed by the tidy pass; a younger one stays (ao-ry61)
- [x] Component test: Files view sorts spill/ after every other folder (ao-ry61)

**Closing note:** WorkspaceSpillStore (apps/worker/src/workspace/spill.ts) is mounted with DSH's spill policy in every Robot composition. The file is `spill/<session>/<call id>-<tool>.txt`; the model sees it as `/workspace/spill/...`. A Robot without the files grant has no read or grep, so its retrieval hint says that the owner can open the file in Files. DSH's policy never spills a `read` result, so reading a spill file cannot spill again. The tidy pass runs at the start of a Turn and lists spill/ at most once a day.
