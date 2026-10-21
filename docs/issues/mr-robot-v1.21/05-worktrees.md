# 05: Worktrees

**What to build:** CreateWorktree through DSH's worktree runtime run by the app under <repository>/.agents/worktrees/<robot slug>; the Robot's directory moves; write roots become the worktree and .git; Subagents cannot create one; the coding skill's worktree limits (cw-11je, cw-zuyu, cw-9dbl).

**Blocked by:** 04

**Status:** done (one check by hand)

- [x] Workerd test through the stub: the four fields and the directory move; the policy's write roots after creation; a Subagent refused
- [ ] By hand: two Robots on one repository in two worktrees (see below)

## Closing note

Tests:
- apps/host/test/worktrees.test.ts runs DSH's real worktree runtime on a git repository, through CreateWorktree:
  - The answer is path <repo>/.agents/worktrees/bot, branch bot, baseCommit HEAD and repositoryRoot.
  - The committed file is checked out; an untracked file is not.
  - With the worktree in the access, a write in the checkout succeeds, a write in the main working tree is denied (SANDBOX_DENIED), and a commit made from the worktree under workspace-write lands on branch bot.
  - A second worktree is refused with EEXIST.
- apps/worker/test/host-worktrees.test.ts (workerd, fake app):
  - create_worktree answers the four fields, and working_directory is the worktree.
  - The setting keeps the worktree. The next Turn's read starts there, and the call's access carries the worktree: the policy the app builds from it is ticket 01's writeRoots, run for real in the Host test above.
  - A second call is refused. A Subagent's call is refused with the reason.

Decisions:
- DSH's runtime is mounted on the app's DSH context with @deepseek-ai/dsh-fs-local (ctx.fs) and a working-directory service of the app's own. Its "agent" is the Robot's current directory and the policy of a platform act. The runtime binds to a DSH Agent only for those two things, so no Agent runs. The checkout is made unconfined, as the spec says (a platform act). git is the one on the login environment's PATH; Node is the app's own program (Electron as Node for DSH's runners).
- The policy service now answers a request that names its own policy (`session.platformPolicy`). Only the worktree runtime sends one; every other request still runs nothing without its grant's policy.
- Name: the branch and the checkout are named by the Robot's directory name on Hosts (for example `coder-1a2b3c4d`), which is unique and stable across renames. One worktree per Robot: the app refuses a second, and the Worker refuses before asking. Retained branches and checkouts are not removed (DSH's limit). A new Workspace setting drops the worktree.
- After creation, the Worker keeps `worktree` in the Workspace setting, moves the Robot's current directory there, and reports the registry row. Every later call to that Host carries the worktree, so the write roots are the worktree and <repository>/.git, not the main working tree (ticket 01).
- create_worktree is a place tool for the Robot with the Workspace's files facet. It waits for an Ask when that facet is at ask (it writes on the computer), and its grant item is that facet. It is refused to a Subagent, which works in its Robot's directory.
- cw-9dbl: the limits (committed content only, no untracked files, no submodules, no fetch, no installed dependencies, install them yourself) are in create_worktree's description now. Ticket 10 writes them into the coding skill.
- The Host's pnpm dependencies changed again, so package.nix has a new pnpmDeps hash. A fixed-output derivation whose path already exists is not rebuilt, so the hash was checked with `nix-build --check`. `nix-build apps/host/package.nix` builds.

By hand: two Robots with Workspaces on one repository on the owner's NixOS. Each calls create_worktree, and each commits in its own checkout. Then `git worktree list` shows both, and neither Robot can write in the other's checkout or in the main working tree.

Review findings: #10 fixed (the worktree and .git are the write roots, not the shared root). #11 stated in the tool and, later, the coding skill. #12, #65: the four fields and the directory move are tested. The move is the Worker's own directory state, since no DSH working-directory service runs.
