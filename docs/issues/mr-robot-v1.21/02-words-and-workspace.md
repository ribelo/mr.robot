# 02: Words and the Workspace setting

**What to build:** 'files' as the place name with the one-release alias; the Workspace setting (Host, root, repository) with the picker RPCs and validation; on: 'workspace'; working_directory kept per Robot; the deputy edit; the Fleet column with its Space migration; Subagent directories; requiresHosts unchanged (cw-shlm, cw-dgj0, cw-z641, cw-gx04, cw-6xs7, cw-llvx, cw-g89b, cw-hiwf, cw-4nkx, cw-ffs7).

**Blocked by:** 01

**Status:** done

- [x] Workerd test: the alias and its notice; validation through the stub; 'workspace' resolution and the Host-by-name default unchanged; working_directory kept and restored; the deputy; the Fleet; Subagent directories
- [x] Component test: the picker and the Fleet column
- [x] Glossary entries for Files and Workspace written now, so later tickets use the words

## Closing note

Tests:
- apps/worker/test/host-workspace.test.ts (workerd, scripted model, fake Host):
  - on "files" writes the R2 files. A Robot without a Workspace that names "workspace" reaches the same files, and the result carries the notice.
  - The setting is refused without the files facet, for a missing path, a file, a directory outside a repository, and one reached through a link. A subdirectory of a repository is kept with the repository root above it.
  - on "workspace" reads and runs from the current directory, with access.cwd and access.workspace. on "Desk" still starts in ~/mr-robot/<robot>/ and still carries the Workspace's roots for the policy. The Fleet row has the Host and the root.
  - working_directory reads and moves the directory and refuses a directory outside the repository. The next Turn starts where the last one left. A new Workspace starts at its root. The old session and a deleted Robot's session get WorkspaceClose.
  - Mr. Robot sets a Workspace with robot_settings_set, and the Robot's Conversation names him.
  - A Subagent moves and reads in app/ while the Robot stays at the root.
  - With requiresHosts on and the Host offline, the owner's message wakes the Robot, and a Workspace call fails with the Host named.
- apps/web/test/workspace-picker.test.tsx: the picker offers the Hosts with the files facet, walks folders through the API and saves the choice. A save without a change sends no workspace. "No Workspace" sends null.
- apps/web/test/mission-control.test.tsx: the Fleet's Workspace column.
- apps/host/test/host-groundwork.test.ts: on the real disk, a relative path and a command start in access.cwd. WorkingDirectory resolves links, stays in the repository and fails with OUTSIDE_REPOSITORY, ENOTDIR or ENOENT.
- Existing tests now use on "files"; their expected texts follow the new words.

Decisions:
- "workspace" means the Workspace when the Robot has one and is not in setup. Otherwise it is the old name of "files", for one release, with a notice in the result (`notice` field, or a last line under a text result). This is the only reading under which both cw-shlm and cw-6xs7 hold. A Robot in setup always reaches only its Files, as before.
- Places: Place kinds are 'files', 'box' and 'host'. A host place has `workspace: { cwd }` when the call named the Workspace. Its result names the place "workspace". copy ends name their places as before. A Workspace end works like a Host end, from the current directory.
- Protocol: HostAccess gains `cwd`. With it a relative path, glob, grep and run start in the Robot's current directory on the app. A call with cwd needs protocol 2 (HostHub refuses it to an older app). New RPC WorkingDirectory (cd, access): the app resolves the path with its links and checks that it is a directory inside the repository. The Worker keeps the result.
- The setting is kv `workspace` in the Robot DO: { hostId, host (its name when saved), root, repository, worktree? }. The current directory is kv `workspace-cwd` (the root when absent). Robot.updateSettings checks a chosen Workspace before the program stores it: the Host is one the owner reaches, the files facet is usable, and Stat on the Host gives a directory, no link and a repository. The owner's page and the deputy go through the same path. The repository is required, as the spec's setting type says.
- Robot.hostAccess adds the Workspace (root, repository, worktree) to every call to the Workspace's Host, by name too, so the app's policy has its roots (ticket 01).
- Sessions: a changed or removed Workspace, and a deleted Robot, send WorkspaceClose to the old Host (best effort, without the grant check: the Robot may be gone).
- working_directory is mounted with the Workspace's files facet. It never waits for an Ask, since it changes nothing on the computer. Subagents keep their directory in memory by session, first the Robot's.
- Memory steps and the dream accept on "files", and "workspace" only from a Robot without a Workspace. A Robot with a Workspace cannot write in its repository from a snapshot, a sweep or a dream.
- Fleet: RobotSummary.workspace { hostId, host, root } or null. A column `workspace` in the Space's robot table (migration by ALTER, as for subagents). The Robot reports it with every registry report.
- The PWA: a Workspace section under Hosts in Robot settings (WorkspacePicker). It shows a Host select, a folder field, Browse, Up, a list of folders, "Use this folder" and "No Workspace", and the save sends the choice. The listing route is ticket 01's GET /api/robots/:id/hosts/:host/directories.
- Words: tool descriptions, the prompt's two mentions, the docs and the platform skills now say Files and on "files" for R2. The R2 paths still print as /workspace/<key> and are still accepted that way. Changing that path would touch every stored reference and test, and the spec does not ask for it. GLOSSARY.md has Files and Workspace, and Place, Box, Spill, ws, Page, Local skill, Files view and the others follow the word. Project is left for ticket 11. memory-and-files.md and grants.md were shortened to stay under 900 words.

Review findings:
- Fixed as revision 2 decided: #23 (on stays mandatory), #24 (the v1.16 default directory stands for a Host by name), #26 (copy ends name their places), #27 and #28 (`files` and `workspace` are two place names), #33 (the Fleet migration and the report), #52 (picker RPCs and validation), #53 (Subagents' own directory; no worktree for them comes in ticket 05).
- Confirmed and accepted: #29. A relative path on the Workspace that names a Member file or a product doc (USER.md, docs/hosts.md) is still refused, as on any Host, with a message that sends it to on "files". A repository file with such a name is reached with an absolute path. #35: requiresHosts is unchanged, as the spec says, and the test shows the message waking the Robot.
- Notes #69, #73 and #74 are resolved by the words. A Workspace is a Host plus a root, the Fleet shows a Workspace or nothing (no "Cloud"), and the Box is not a Workspace.
