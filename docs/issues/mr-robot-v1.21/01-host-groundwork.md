# 01: Host groundwork: environment, policy from grants, protocol version, Workspace session

**What to build:** The Host app captures the OS user's login environment at start (scrubbed, allow-listed), builds the sandbox policy per call from the facet grant, carries protocolVersion in the heartbeat (the Worker refuses Workspace RPCs on an older app), and keeps a Workspace session per Robot with the lifecycle; Linux service processes without a user manager; Node tests for all of it (cw-jn59, cw-et7q, cw-dkkw, cw-o4fr, cw-omrg, cw-p4bm, cw-9026).

**Blocked by:** None (can start immediately; needs v1.20 merged)

**Status:** done

- [x] Host Node tests: environment capture and allow-list; policy from a grant; session lifecycle; version in the heartbeat
- [x] Workerd test: the Worker refuses a Workspace RPC on an older protocol version with the sentence
- [x] docs/hosts.md says what git credentials are and what a service Host lacks

## Closing note

Tests:
- apps/host/test/host-groundwork.test.ts: the environment of a command, through Run on the real shell. A profile variable arrives. GITHUB_TOKEN and DSH_* are removed. GIT_ACCESS_TOKEN is kept by the GIT_* allow-list. SSH_AUTH_SOCK comes from the config's `set`. A refresh reads the login environment again. A real login shell gives a PATH. The write roots built from a grant and a Workspace (root, subdirectory, worktree, roots that cover each other). In the real sandbox, a write in the Workspace succeeds and one outside is denied. With a worktree, the main working tree is denied, and the worktree and .git are writable, by a command too. The session lifecycle: no session without a Workspace; one opened on the first call; the same one kept; closed when the Workspace changes and on WorkspaceClose; all closed at once.
- apps/host/test/host-link.test.ts: the heartbeat over the real socket carries protocolVersion. Unpairing (close code 4001) closes an open session.
- apps/host/test/no-user-manager.test.ts: with no user systemd manager (an empty XDG_RUNTIME_DIR, no session bus), a confined command runs. It stays in the app's own control group (DSH's process-group fallback, not a transient scope), and a background job stops on JobKill.
- apps/worker/test/host-workspace.test.ts: the picker's listing on an app of protocol 1, and on an app from before v1.16, answers 409 with "<Host> runs an older Mr. Robot app than this server, so it cannot serve a Workspace: update the Mr. Robot app on <Host>." A current app lists the directories. A Robot without the files facet is refused.

Decisions:
- Protocol: HOST_PROTOCOL_VERSION = 2 in host-protocol. An app that sends none counts as 1. HostHub.send takes the protocol a call needs. A Workspace call (HostHub.workspaceRun, under the files facet) to an older app fails with a new tagged HostOutdated before anything is sent.
- The first Workspace RPCs are here, so that the refusal has a call to refuse: ListDirectory and Stat (the picker's, cw-gx04) and WorkspaceClose. The edge route is GET /api/robots/:id/hosts/:host/directories?path=. Ticket 02 builds the picker and the validation on them. Stat answers the kind, the first link on the way and the repository root (the nearest ancestor with a .git entry).
- HostAccess gains an optional `workspace` (root, repository, worktree). The Worker fills it from ticket 02 on, for every call to the Workspace's Host. The repository is required, as the spec's setting type has it, so a root outside a git repository will be refused by ticket 02's validation.
- Policy: the app already built a policy per call from the grant (v1.16, HostShell.place). What was missing were the Workspace's roots. access.ts writeRoots now adds the root and <repository>/.git, or with a worktree the worktree and <repository>/.git and not the main working tree. A Workspace root that lies in another root adds nothing; a grant root inside a Workspace root is covered by it. The other rules (no link on the way, none inside a temporary directory) apply to them as to every root. The Workspace's roots are never made by the app. The policy service DSH looks up (formerly a read-only stub) now refuses to resolve: every request here carries its grant's policy, and one without would be a bug.
- Environment: environment.ts. The login shell is asked once for `env -0` at start and again after a pairing (main.ts). The result is scrubbed with DSH's own SENSITIVE_ENV_PATTERN and DSH_ prefix (@deepseek-ai/dsh-subprocess, now a direct dependency of the app), without PWD, OLDPWD, SHLVL and _. Then the config's `environment.allow` keeps names the scrub drops (default SSH_AUTH_SOCK, GIT_*), and `environment.set` adds values (an agent's socket for a service Host). It replaces the PATH-only capture. On Windows commands get the app's own environment, as before. host.json gains the `environment` section, edited by hand.
- Sessions: workspace-session.ts, one per Robot directory name, held by HostShell, so they outlive a connection. A file or command call that carries a Workspace opens the session, and a different Workspace replaces it (the old one closes). WorkspaceClose closes it. Unpair and quit close all. Parts register with onClose (LSP in ticket 06).
- Service processes without a user manager: no code was needed. DSH's subprocess-local falls back to a process group by itself; the test proves it.
- docs/hosts.md: a section "Commands, git and credentials" (the login environment, the scrub and the allow-list, git as the OS user, no platform credential) and what a service Host lacks (an agent unless configured, the browser facet, a user manager, jobs across a restart). Other sentences were shortened to stay under 900 words (884).

Review findings:
- Confirmed and fixed: #18 (commands got only a PATH), #44 (no version or capability check), #57 (no session lifecycle), #46 for git credentials (the docs).
- Partly refuted: #19. The policy was already built per call from the grant; the stub existed only because DSH's bash-sandbox looks the service up. The fs provider it names belongs to ticket 04, where the chain needs it.
- Confirmed as a limit, verified by the test, said in the docs: #20 (no user manager: process groups) and #21 (jobs die with the app).
- New limit found here: on macOS and Windows the sandbox confines one folder, so a Workspace (an extra write root) in workspace-write mode fails closed there, as any extra root does. Full mode works. The owner's Host is NixOS, so this is accepted and will be said in the workspaces doc (ticket 11).
