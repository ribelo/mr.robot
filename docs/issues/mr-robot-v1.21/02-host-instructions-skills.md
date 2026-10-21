# 02: The Host reads instructions and skills the DSH way

**What to build:** The Host app mounts DSH's working-directory, agent-instructions and skill-filesystem; new RPCs WorkspaceOpen, WorkspaceState, WorkingDirectory, SkillLoad; the Robot's baseline gains the Workspace block and change notices; the skill catalog merges Host, Space library and platform skills with DSH's precedence; hashes so unchanged files are not resent (cw-714r, cw-3zaq, cw-v351, cw-xrh7, cw-jfnk, cw-wc2m).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test with the Host stub over a temp tree: the chain, overlays, duplicates, budget, notices after a deeper edit, changed and removed files; the merged catalog and a loaded Host skill; working_directory
- [ ] By hand: the owner's real tree on NixOS
