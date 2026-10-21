# 11: Glossary and docs

**What to build:** Files, Workspace, Code view, Service Host, Coding Robot defined, Project reserved; the hosts and memory-and-files docs and the new workspaces doc as modules under the cap, with a test that each names the limits the stories state (cw-791g, cw-iunm).

**Blocked by:** 02, 04, 05, 06, 07, 08, 09, 10

**Status:** done

- [x] GLOSSARY.md updated with the five words and the reservation
- [x] docs test: the three docs exist under the cap and contain the stated limits (frame limit, idle stop, worktree rules, credentials)

## Closing note

Tests: apps/worker/test/docs.test.ts lists workspaces.md among the docs, so it is read, globbed, grepped, refused for writes and held under the 900-word cap with the others. A new test reads the three docs as a Robot does and checks the limits each must state:
- workspaces.md: 1 MiB per write and copy for bigger files, the 30-minute idle stop of language servers, the worktree rules (committed content only, no untracked or ignored files, no fetch, no installed dependencies, not the main working tree, none for a Subagent), the 65,536-byte chain budget, no link followed out of the repository, git as the OS user with no platform credential, and that a platform skill wins its name.
- hosts.md: git credentials, what a service Host lacks (no browser facet, no user systemd manager, jobs end with a restart) and the pointer to workspaces.md.
- memory-and-files.md: on "files" and the pointer to workspaces.md.

Word counts: workspaces.md 804, hosts.md 892, memory-and-files.md 892 (cap 900). The prompt's docs index gained one line, so two index summaries were shortened; the bound of ticket 10 holds at 2,982 words.

Decisions:
- GLOSSARY.md: Files and Workspace (ticket 02), with the worktree, the instructions and the Host's skills added to Workspace. Service Host, Code view, Coding Robot and Project (reserved) are new. Host, Write roots and Work details follow v1.21: a Host may hold Workspaces, a Workspace adds write roots, and Work details is per Robot with Code.
- workspaces.md (src/docs/workspaces.ts, a TS module like the others) is the one doc about a repository on a Host: choosing it, on "workspace" and working_directory, the static prompt line, instructions and skills, the file limits, worktrees, lsp, the Code view and the panel, git and credentials. hosts.md and memory-and-files.md point to it rather than repeat it. mr-robot.md lists it.
- README: the service Host's deploy line (the flake's nixosModules.host, pairing as the service user, the other units in infra/host/).
- Accepted limits from the review are written in the docs, as revision 2 says: language servers run as the OS user without the sandbox (#15); a shared Host's global instructions and home skills reach every Robot with a Workspace there (#72); on macOS and Windows a Workspace in workspace-write mode fails closed (found in ticket 01).
