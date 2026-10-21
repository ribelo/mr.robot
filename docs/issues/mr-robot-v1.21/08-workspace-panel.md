# 08: The Workspace panel and the static prompt line

**What to build:** The panel with files on demand, git status and log through the Host with repository configuration disabled, the current directory and the worktree; the prompt's Workspace line static; the directory out of the runtime section (cw-1wrt, cw-xbx3).

**Blocked by:** 04, 05, 07

**Status:** done

- [x] Component test: the panel
- [x] Workerd test: the prompt line and that a cd changes no prompt section
- [x] Host Node test: git commands with configuration disabled

## Closing note

Tests:
- apps/host/test/workspace-panel.test.ts runs real git on a repository whose config names a core.fsmonitor and a core.pager script that would leave a marker file.
  - GitState reads the branch, the changes and the commit, and the marker is never made. With the safety arguments removed, the test fails: git runs the monitor.
  - WorkspaceFiles lists directories first and leaves out .git. It refuses `..`.
- apps/worker/test/workspace-prompt.test.ts:
  - The runtime section holds "- Workspace: /home/anna/repo on Desk (repository /home/anna/repo, bash); use on "workspace", and working_directory for where you are in it."
  - After a working_directory cd, the prompt preview and the system prompt sent to the model are byte for byte the same, and neither holds the current directory.
  - The panel routes give the current directory, a listing and the git state through the fake app. A Robot without a Workspace gets 409 "This Robot has no Workspace."
- apps/web/test/workspace-panel.test.tsx: the panel shows the Host, the worktree and the current directory. It lists files only when asked, walks into a folder and reads git (branch, changes, commits).

Decisions:
- Two read RPCs (protocol 2): WorkspaceFiles (one directory of the checkout the Robot works in, its worktree, else the root; never outside it; .git left out; at most 500 entries) and GitState (branch, `status --porcelain=v1`, the last 20 commits). git runs in the app, unsandboxed but read-only, with `-c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.external= -c core.pager=cat --no-optional-locks --no-pager`, GIT_OPTIONAL_LOCKS=0 and GIT_CONFIG_NOSYSTEM=1, so no program named by the repository runs and no index lock is taken while a Robot works. It uses the login environment of ticket 01.
- Routes (the owner's): GET /api/robots/:id/workspace (the setting and the current directory, from the platform without a Host call), /workspace/files?path= and /workspace/git (through the Host). A refusal is a 409 with its sentence.
- The PWA: WorkspacePanel in the Robot's panel for the owner of a Robot with a Workspace. It shows the Host, root, repository (when it differs), worktree and current directory, with Files and Git status buttons that read on demand.
- The prompt: PromptInput gains `workspace` (Host name, root, repository, the Host's shell), and the runtime section gets one static Workspace line. The current directory and the worktree are not in any section; working_directory and the panel give them. This is also the line ticket 10's Robot in setup will see.

Review findings: #39, #40 (the directory out of the prompt; the cache holds across a cd) confirmed by the byte-for-byte test. #41 (git in a repository runs the repository's programs) fixed with the disabled configuration. The "repository configuration disabled" of the spec cannot mean all of .git/config: git needs it to read the repository. What runs programs (fsmonitor, hooks, pager, external diff) is turned off.
