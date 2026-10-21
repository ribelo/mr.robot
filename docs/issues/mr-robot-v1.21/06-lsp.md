# 06: LSP on the Host

**What to build:** lsp.yaml with a shipped default set filtered by the captured PATH; a provider per Workspace session with the root as the LSP root; disposed on close and after thirty idle minutes; the lsp tool on 'workspace' only; locations rendered (cw-lx4f, cw-fb1q, cw-yeq1, cw-xxqw).

**Blocked by:** 04

**Status:** done (one check by hand)

- [x] Host Node tests: the filter by PATH; start on first query; dispose on close and idle
- [x] Workerd test through the stub: the four operations on 'workspace' only; a call with another on refused
- [ ] By hand: LSP on this repository (see below): verified only through the stub; real-machine use will tell.

## Closing note

Tests:
- apps/host/test/lsp.test.ts:
  - Without lsp.yaml the default set is used; with it, its servers. Only the servers whose command is on the PATH are mounted, as an absolute path and with that PATH in their environment.
  - On a machine with typescript-language-server (this one), the real server runs. Before the first query no servers run. findReferences answers with the declaration and the canonical workspace URI. WorkspaceClose stops them. A hover starts them again, and they stop after the idle time (1.5 s in the test).
- apps/worker/test/host-lsp.test.ts (workerd, fake app):
  - The four operations go to the app zero-based and come back one-based, with paths from the repository root.
  - A call with on "Desk" is refused with the reason, and nothing is sent.
  - A Robot without a Workspace has no lsp tool.

Decisions:
- DSH's lsp seam (@deepseek-ai/dsh-lsp) and stdio provider (dsh-lsp-stdio) run in a DSH context of their own per Workspace session (subprocess-local, fs-local, lsp, lsp-stdio), created on the session's first query. Disposing that context is DSH's graceful shutdown of its servers. The session's onClose disposes it (Workspace changed, Robot deleted, unpaired, quit; ticket 01). A sweep stops a session's servers LSP_IDLE_MS (30 min) after its last query.
- Configuration: lsp.yaml in the app's config directory (beside host.json) holds DSH's `servers` record, read again whenever a session's servers start. Without the file the default set is used: typescript-language-server, pyright-langserver, rust-analyzer, gopls, ocamllsp, nil, with their extensions. The app does not write the file. A server whose command is not on the login PATH is left out before DSH sees the record, so one missing server does not stop the others (DSH refuses the whole record when one command does not resolve).
- The LSP root is the Workspace's worktree when it has one, else its root. A query of a file in the worktree must be inside the root DSH canonicalizes, and a repository-wide root would make one server index every Robot's checkout.
- The lsp tool is mounted with the Workspace's files facet. `on` is required and must be "workspace"; any other place is refused. It waits for an Ask when the facet is at ask, and its grant item is that facet. A first query can take a while (the server starts), so the call waits up to 120 s.
- Results (cw-xxqw): the tool answers `{ kind: 'locations', locations: [{ path, line, character, endLine, endCharacter }] }` (paths from the repository root, one-based) or `{ kind: 'hover', contents }`. The Conversation and Trajectory renderers for them are ticket 07.
- Servers run unconfined, as DSH runs them. docs/hosts.md is at its word cap; ticket 11 says this in the workspaces doc.
- New dependencies of the app: dsh-lsp, dsh-lsp-stdio and yaml. package.nix has the new pnpmDeps hash, checked with `nix-build --check`, and the package builds.

By hand (the owner, NixOS): with this repository as a Robot's Workspace, ask it to call lsp goToDefinition on a symbol in apps/worker/src. The first answer takes a few seconds while typescript-language-server indexes, and later ones are quick. After 30 minutes without a query, `pgrep -f typescript-language-server` finds no server of the app.

Review findings: #13 (no discovery, one bad entry disables all) fixed by the config, the default set and the PATH filter. #14 (no stop) fixed by session disposal and the idle sweep. #15 accepted: servers run unconfined, to be said in the docs. #16: the root is the Workspace's (worktree or root), never the current directory. #17: the lsp tool is a proxy with its own schema (`on`), as the spec now says. #64: start and stop are tested on the app, where they happen.
