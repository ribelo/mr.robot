# 02: File history for persona, memory and Member files

**What to build:** Every write to the tracked set keeps the previous version with author and time under a hidden Workspace prefix; the file API lists history, reads a version and restores it (a new version); history is trimmed to 50 per file and 90 days; change notes name the author; the Files view gets a History drawer (rm-d68k, rm-7jo4, rm-xusr, rm-cvl8).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test: versions kept with author on Robot, owner, Mr. Robot writes; list, read, restore as a new version; trim at 50 and 90 days; change notes with the author (rm-d68k, rm-7jo4, rm-xusr, rm-cvl8)
- [ ] Component test: the History drawer with restore (rm-7jo4)
