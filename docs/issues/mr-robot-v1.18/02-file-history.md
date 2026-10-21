# 02: File history for persona, memory and Member files

**What to build:** Every write to the tracked set keeps the previous version with author and time under a hidden Workspace prefix; the file API lists history, reads a version and restores it (a new version); history is trimmed to 50 per file and 90 days; change notes name the author; the Files view gets a History drawer (rm-d68k, rm-7jo4, rm-xusr, rm-cvl8).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd test: versions kept with author on Robot, owner, Mr. Robot writes; list, read, restore as a new version; trim at 50 and 90 days; change notes with the author (rm-d68k, rm-7jo4, rm-xusr, rm-cvl8)
- [x] Component test: the History drawer with restore (rm-7jo4)

## Closing note

apps/worker/test/file-history.test.ts (a Robot file written by the platform, the owner, the Robot; list, read, restore as a new version with the note to the Robot; a delete keeps the last version; 50 kept; 90 days; Member files written by the owner and Mr. Robot, restored, the note to the Robot) and apps/web/test/file-history.test.tsx (the History drawer: authors, Show, Restore into the editor; no History for other files).

Decisions:
- The history is kept in R2 under history/ (history/robots/<id>/, history/members/<id>/, history/home/), beside the Workspaces and outside them, not "in the Workspace under a hidden prefix": the Robot's file tools then cannot list, change or delete its own history, and no listing needs a filter. One module, workspace/file-history.ts, serves the three.
- The Workspace's one write path does it: Workspace.write and remove take who writes (the Robot unless named) and, for a tracked path, copy the version they replace into history first. Each object carries its author in R2 metadata, so a kept version says who wrote it and when, and when it was replaced. Member files keep the author in a new member_file column, HOME.md in a setting. A file written before history existed reads "unknown (before file history)".
- The tracked set for a Robot is SOUL.md, AGENTS.md, MEMORY.md, memory/*.md, and until ticket 01 IDENTITY.md and TOOLS.md. For a Member, the three Member files. For the Home, HOME.md. A delete keeps the last version, so a deleted memory file can come back.
- Trim after each kept version: at most 50, none older than 90 days by the time it was replaced.
- API: GET file/history, GET file/version, POST file/restore for a Robot (restore is the owner's); GET /api/me/files/:name/history, /versions/:version, POST /restore; the same for HOME.md under /api/admin/home-memory. The PWA has the History drawer in the Files view; the Member and Home files have the API only.
- The change notes name who: the existing note "changed: X by Y" now names a restore as "your owner (restored an earlier version)", and Mr. Robot's writes of Member files by his name.
- Not covered: a file the Box writes through ws put goes in by a presigned link and keeps no version.
