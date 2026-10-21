---
title: "Mr. Robot v1.21 — Robots on Hosts: Workspace, DSH instructions and skills, LSP, the Code view, the service Host (revision 2)"
status: ready-for-agent
story-prefix: cw
parent: mr-robot-v1.20.md
---

# Mr. Robot v1.21 — Robots on Hosts (revision 2)

Revision 2 of 2026-10-21 replaces revision 1 after the review in docs/review/v1.21-spec-review.md (76 findings). Every story of revision 1 is retired; the stories below carry new ids.

## Problem Statement

The owner works in two worlds: DeepSeek Harness on his desktop (the full power of his machine, his skills, AGENTS.md per repository, LSP, a trajectory that shows every call and every diff) and Mr. Robot (identity, memory, Tasks, Grants, one endless Conversation, costs, Channels, Hosts). Nothing crosses between them. On 2026-10-21 he asked to end that: Robots that develop software on his machine, under Mr. Robot, so that there is one place to talk, one memory, one Task list, one set of skills, and one Mission Control that does not care whether a Robot works in the cloud, on his laptop or on a VPS.

The first-principles review settled the shape: **the brain stays in Cloudflare, the tools go where the work is.** The agent loop always runs in the Robot's Durable Object; a Host is a place for tools, as v1.16 made it. The agent first proposed running the loop on the Host and withdrew it; the owner's argument settled it: a model call is slow and remote either way, and a tool round trip over the Host link is a second cost in the place that matters least. What is missing is not a second runtime but what DSH has and a Robot on a Host does not: a working directory and the instruction chain, skills from the machine, LSP, a view that shows every call and diff, and a Host without a screen. One word stood in the way (Workspace named the R2 files), and the review of revision 1 showed that "mount DSH unchanged" was false for every DSH package that binds to an Agent, that worktrees do not isolate a shared root by themselves, that lsp-stdio neither discovers servers nor stops them, that the Conversation's clipped rows cannot render a diff, and that the prompt had five words of room left.

## Solution

**Words.** Files is the Robot's R2 files (place name 'files'); Workspace is a Host and a root directory where a Robot works (place name 'workspace', paths relative to the Robot's current directory there); Project is reserved. The Box is not a Workspace.

**Workspace.** A validated Robot setting (Host, root, the repository root DSH would find) chosen with a directory picker; on stays mandatory and gains 'workspace'; working_directory moves the Robot within the repository, kept per Robot by the platform; Subagents inherit it with their own directory; several Robots may share a root, protected by content-hash writes; the Fleet shows it.

**DSH where it is a service, ours where DSH binds to an Agent.** The Host app mounts DSH's providers (fs, sandbox-local with a policy built from the grant, jobs-local, skill-filesystem, the worktree runtime, lsp-stdio) and no DSH Agent. The instruction chain is computed with DSH's file logic and the app's own carrier (touches from our RPCs, the per-Robot directory), delivered as its own platform message beside the memory baseline with DSH's budget and refresh rules, confined to the repository. Skills from the Host join one catalog with the code's precedence. The protocol carries a version.

**Host groundwork.** The OS user's login environment captured at start and allow-listed for a coding Robot's needs; git credentials are the OS user's; a Workspace session per Robot with a lifecycle; file tools hardened (hash, line endings, idempotent writes, stated limits); honest service-mode limits (no user systemd manager, graceful stop).

**Worktrees** created by the Host app under the repository, write roots set to the worktree and .git; **LSP** from a Host config with a shipped default set, started per Workspace on first query and stopped with the session or after idling, Workspace-only.

**The Code view.** Work details per Robot with a Member default and the level Code; full tool content read from the chapter log for the visible page; one renderer set for Conversation and Trajectory; a Workspace panel; the prompt's runtime section free of anything that changes on a cd.

**The service Host.** One codebase, two entries; Nix module and units; a display check that asks for a display.

**Roles and acceptance.** Mr. Robot keeps no Workspace; a platform Coding Robot definition; the Add form asks for the Workspace before the interview; the coding skill and a prompt bound raised to 3,000 words; acceptance is one ticket the owner names, implemented by a Coding Robot on his machine.

## User Stories

### Words
1. As an owner, I want the Robot's files in R2 called Files everywhere a person or a Robot reads (the Files view, the files group, docs, prompt), and on: 'files' as the place name with 'workspace' accepted for one release and mapped, so that the word Workspace is free ^cw-shlm
2. As an owner, I want Workspace to mean a Host and a root directory on it where a Robot works, so that the word means what it means in DeepSeek Harness; the Box is not a Workspace (its /workspace is scratch) ^cw-dgj0
3. As an owner, I want Project reserved and unused, so that a future concept of people, Robots and a goal has its word ^cw-z641

### Workspace
4. As an owner, I want a Robot's Workspace setting (Host, root) with none as the default, set in Robot settings with a directory picker that lists the Host's directories, validated (the Robot holds the files facet on that Host, the path exists and is a directory) and stored with the repository root DSH would find (the nearest .git ancestor, which may be above the root), so that a Workspace is a checked fact ^cw-gx04
5. As a Robot, I want on: 'workspace' as a place name that means my Workspace's Host with paths relative to my current directory there, beside 'files', 'box' and a Host name, so that on stays mandatory as v1.16 decided and my Workspace is one word away ^cw-6xs7
6. As a Robot, I want a tool working_directory that reads my current directory in my Workspace and changes it within the repository, kept per Robot by the platform and restored on the next Turn, so that I move between folders and never land in the Host app's directory ^cw-llvx
7. As an owner, I want Mr. Robot to set or change a Robot's Workspace through the deputy settings tool, so that the chief places his staff ^cw-g89b
8. As an owner, I want several Robots to share one root, with each Robot's edits protected by a content check (a write names the content hash it read; a changed file refuses the write and the Robot reads again), so that two Robots on one file never clobber each other silently ^cw-jko0
9. As an owner, I want Mission Control's Fleet to show each Robot's Workspace (Host and root) or nothing, so that one page shows where everything runs ^cw-hiwf
10. As an owner, I want a Subagent to inherit its Robot's Workspace with its own current directory, and no worktree creation, so that children work where the Robot works without moving it ^cw-4nkx
11. As an owner, I want the Workspace's Host counted by requiresHosts as today (Task Wake-ups wait; my messages always wake the Robot, whose Workspace calls then fail with the Host named), so that nothing claims more than the setting does ^cw-ffs7

### Instructions and skills from the Host
12. As a Robot, I want the instruction chain DSH reads delivered into my context when I have a Workspace: the Host user's global chain (the harness home AGENTS.md, then ~/.agents/AGENTS.md), then every AGENTS.md or CLAUDE.md from the repository root down to my current directory with the .local.md overlays, duplicates collapsed, broad to specific, under a 65,536-byte budget, so that I work under the rules DSH works under ^cw-ec6f
13. As an operator, I want the chain computed by the Host app with DSH's own file logic where it is a pure function and with the app's own carrier where DSH binds to an Agent (touches from our Read, Write and Edit RPCs; the current directory from our per-Robot state), so that the behaviour is DSH's and no DSH Agent runs on the Host ^cw-o2qo
14. As a Robot, I want the chain delivered as its own platform message beside the memory baseline (its own budget, its own change notices), refreshed when my current directory changes and when a read, write or edit of mine touches a deeper directory, with a changed file replacing its content and a removed one leaving a notice, so that the chain follows me as it does in DSH ^cw-hm3d
15. As an owner, I want the chain confined to the repository root (no file followed outside it through a symlink) and limited to the instruction file names, so that a cloned repository cannot put off-tree content into a Robot's context ^cw-jc3f
16. As a Robot, I want skills discovered on my Workspace's Host from the Host user's ~/.agents/skills and the repository's .agents/skills through DSH's skill-filesystem provider, merged with my local skills, the Space library and the platform skills into one catalog with the code's precedence (platform over library over local; Host home skills rank with the library, Host repository skills with local; the winner of a name notes the skill it shadows), so that my owner's skills are mine ^cw-s2rt
17. As an owner, I want a Host shared with the Space to serve its OS user's global chain and home skills to every Robot on it, said so in docs/hosts.md, so that nobody expects per-Member chains on one machine ^cw-zwhg
18. As an operator, I want instruction and skill files sent with content hashes so that unchanged files are not resent, so that a Turn start costs little ^cw-rkud
19. As an owner, I want the Host protocol to carry a version in the heartbeat and the Worker to refuse Workspace calls on an older app with one plain sentence naming the update, so that a stale Host fails clearly ^cw-jn59

### Host groundwork
20. As an operator, I want the Host app to run commands with the OS user's login environment captured once at start (PATH on NixOS included) and refreshed on pairing, scrubbed as DSH scrubs secrets, with an allow-list in the Host config for variables a coding Robot needs (SSH_AUTH_SOCK, GIT_*), so that git, nix and the user's tools work in a run ^cw-et7q
21. As an owner, I want git credentials to be the OS user's (SSH keys, the agent named in the Host config, credential helpers) and never the platform's, with the limits said in docs/hosts.md (a service Host has no agent unless configured), so that a Robot commits as me and nothing secret moves ^cw-dkkw
22. As an operator, I want the Host's sandbox policy built from the Robot's facet grant (mode and write roots) instead of the read-only stub, with the Workspace's worktree or root added as a write root, so that confinement matches the grant ^cw-o4fr
23. As an operator, I want a Linux service Host to run processes without a user systemd manager (DSH's fallback) and the service unit to stop gracefully with a timeout so that jobs are not killed by a restart without notice, so that the service is honest about what dies with it ^cw-omrg
24. As an operator, I want a Workspace session on the Host (per Robot) with a lifecycle: opened on first use, closed when the Robot's Workspace changes, the Robot is deleted, the Host is unpaired or the app quits, closing its language servers, so that nothing lives for nothing ^cw-p4bm
25. As an operator, I want the Host app's Node tests (link, files, jobs) extended for the environment capture, the policy from grants and the Workspace session lifecycle, so that the Host side is tested where it can be ^cw-9026

### File tools on a Host
26. As a Robot, I want read on a Host to report the file's size, line-ending style and content hash, with the window limits stated (2,000 lines, 50 KiB, 10 MB file), so that I know what I am editing ^cw-vwo1
27. As a Robot, I want edit on a Host to match and write in the file's own line-ending style, so that a CRLF file edits as a LF one does ^cw-71bx
28. As a Robot, I want a write cut off by a lost link to be safe to retry: each write carries an id, the Host answers with the resulting hash, and a repeated id answers the same, so that a retry never doubles ^cw-6b3r
29. As a Robot, I want files over the write frame limit moved with copy, and a write over it refused with that advice, so that limits are rules, not surprises ^cw-1ov7

### Worktrees
30. As a Robot, I want create_worktree in my Workspace, run by the Host app through DSH's worktree runtime under <repository>/.agents/worktrees/<robot slug>, from the current commit, moving my current directory there and returning path, branch, baseCommit and repositoryRoot, so that several Robots work on one repository in separate checkouts ^cw-11je
31. As an owner, I want a Robot with a worktree to have its worktree and the repository's .git as write roots and not the main working tree, so that checkouts are isolated and git still works, as for people ^cw-zuyu
32. As a Robot, I want the limits said in the coding skill: a worktree holds committed content only, no untracked files, no dependency install, no fetch; I install what the repository needs there myself, so that I am not surprised ^cw-9dbl

### LSP
33. As a Robot, I want a tool lsp (goToDefinition, findReferences, goToImplementation, hover) on my Workspace only, through DSH's lsp-stdio provider on the Host with the Workspace root as the LSP root, under the Host's files facet, so that I navigate code the way DSH does ^cw-lx4f
34. As an operator, I want language servers configured in the Host app's config (lsp.yaml: servers with command and extension mappings), shipped with a default set (typescript-language-server, pyright, rust-analyzer, gopls, ocamllsp, nil), each entry mounted only when its command is on the captured PATH, so that one missing server never disables the rest ^cw-fb1q
35. As an operator, I want servers started on the first query per Workspace and stopped when the Workspace session closes or after thirty minutes without a query (the app disposes and re-mounts the provider), so that nothing runs for nothing; servers run unconfined, as DSH says, and docs/hosts.md says so ^cw-yeq1
36. As a Robot, I want lsp results rendered as locations in the Conversation and the Trajectory, so that I and my owner read them the same way ^cw-xxqw

### The Code view
37. As an owner, I want Work details to be a Robot setting with the Member's default, with a new level Code, so that the view follows the Robot ^cw-jy38
38. As an owner, I want the Conversation at Code to show every tool call between the Robot's messages with full content read from the chapter log for the visible page (not the clipped chat rows), rendered by one component set shared with the Trajectory: a diff for edit and write, the fragment for read, the command and its output with the exit code for run and jobs, lists for glob and grep, locations for lsp, a summary for copy, so that I see the code, not a report ^cw-sc3z
39. As an owner, I want a Robot with a Workspace to default to Code, so that the view follows the work ^cw-1h3q
40. As an owner, I want a Workspace panel for such a Robot: the repository's files under the root listed on demand, git status and the last twenty commits read through the Host with repository configuration disabled (git -c core.fsmonitor=false --no-optional-locks), the current directory and the worktree, so that I see the repository's state without a terminal ^cw-1wrt
41. As an owner, I want the current directory and worktree kept out of the prompt's runtime section (the Workspace line names only the Host, the root, the repository and the shell), so that the prompt cache holds across a cd ^cw-xbx3

### The service Host
42. As a person, I want the Host app to start as a service with no window and no display (mr-robot-host --service), paired from a terminal (mr-robot-host pair <server> prints the link and waits), so that a VPS or a box in the corner serves Robots ^cw-bi6y
43. As a person, I want one codebase and two entries: the service bundle without Electron, the desktop bundle importing the same modules and adding the tray, the window, the Host browser, the sign-in windows and notifications, so that nothing exists twice ^cw-y7wy
44. As a person, I want a Nix module, a systemd unit and a launchd plist under infra/host/, so that an always-on Host is one line ^cw-dr33
45. As an owner, I want a service Host to report no graphical session and no browser facet on every platform (the check asks for a display, not the OS), so that a service Host offers files, shell, lsp and Workspaces ^cw-ixto

### The chief, the definition, the prompt, the skill, the acceptance
46. As an owner, I want Mr. Robot to have no Workspace by default, to give coding Robots Tasks, read their Conversations and set their Workspaces, and to keep his Host grants for what a chief does there, so that the chief stays a chief ^cw-evn7
47. As an owner, I want a Coding Robot definition shipped with the Worker as a platform definition in the library (read-only, listed first in the Marketplace): SOUL.md for an engineer, AGENTS.md with the working rules, grants.yaml naming the Host facets files and shell (lsp comes with files), no Box, no browser, Work details Code, so that the first coding Robot is one Add ^cw-wio5
48. As a Member, I want the Add form of a definition that needs a Host to ask for the Workspace (Host and root) before the interview, so that the Robot in setup knows its repository without reaching the Host ^cw-nm6y
49. As a Robot, I want the prompt's Workspace line and the platform skill coding (instructions first; tests the repository's way; commit as the repository asks; never read .env, keys or secrets unless asked; report with say at the end; ask for decisions; never clone elsewhere; a worktree's limits), and the source ladder's Host rule read in the light of a Workspace, so that practice is written once and the prompt stays under its bound (raised to 3,000 words with the measurement in the closing note) ^cw-etsj
50. As an owner, I want the acceptance of this spec to be a Coding Robot with a Workspace on my computer implementing one ticket I name when the time comes, given the spec's path in its Task, end to end (read, edit, run the tests, commit, report), judged by me and recorded with what hurt, so that the claim is tested on itself ^cw-6ucq

### Glossary and docs
51. As an owner, I want the glossary to define Files, Workspace (place name 'workspace'), Code view, Service Host and Coding Robot and to reserve Project, so that the words are one ^cw-791g
52. As a Robot, I want the product docs hosts, memory-and-files and a new workspaces doc (each under the 900-word cap, as TypeScript modules like the others) updated, so that what I read is what the platform does ^cw-iunm

## Implementation Decisions

- **Rename.** 'files' replaces 'workspace' as the place name for the R2 files in parseOn, WORKSPACE_PLACE, tool descriptions, docs, prompt and glossary; 'workspace' is accepted and mapped for one release where it arrives from an old client or a Robot's habit, with a notice in the result. The edge routes (/files) and FilesView already carry the word.
- **Workspace setting.** `workspace: { host: string; root: string; repository: string } | null` on the Robot config; the settings page gets a picker backed by a new RPC ListDirectory (bounded, directories only) and a Stat; validation on save (facet, existence, directory, repository root resolved by the Host); the deputy settings tool edits it. The Robot's current directory is a per-Robot value in the Robot DO (kv), sent with every Workspace RPC and restored at Turn start; Subagents carry their own in memory, seeded from the parent's. The place name 'workspace' resolves to the Workspace's Host with the current directory as cwd; a call naming the Host by name uses the v1.16 default directory (~/mr-robot/<robot>/) as before. copy ends name places as before. requiresHosts unchanged.
- **Host composition (no Agent).** The Host app's composition adds DSH's fs provider for the execution world, replaces the policy stub by a policy built per call from the facet grant (mode, roots, the worktree or root as a write root), adds skill-filesystem (home and repository roots), the worktree runtime, lsp-stdio, and an environment capture (login shell once at start, DSH's scrub, the config allow-list). A Workspace session per Robot (root, repository, current directory, touched directories, chain digests, skill catalog digest, the LSP provider instance) is opened on first use and closed on the lifecycle events above; closing disposes its LSP provider. The instruction chain uses the agent-instructions package's file discovery and rendering where they are exported pure functions and the app's own walk where they are not; touches come from the app's Read, Write and Edit handlers; refresh on cd. Symlinks resolving outside the repository are skipped; only the candidate names are read.
- **Protocol.** Heartbeat gains protocolVersion; new RPCs: ListDirectory, Stat, WorkspaceOpen (root, cwd) → chain baseline and skill catalog with digests; WorkspaceState (cwd) → chain changes and catalog changes since the given digests; WorkingDirectory (cd) → the new directory or an error; CreateWorktree (robot slug) → path, branch, baseCommit, repositoryRoot; Lsp (root, operation, file, line, character); SkillLoad (name); WorkspaceClose. Read gains size, lineEnding and hash; Write and Edit take expectedHash and an id, answer with the new hash, and answer a repeated id with the stored result. The Worker refuses Workspace RPCs when the Host's protocolVersion is older than its own.
- **Delivery to the Robot.** A platform message "Workspace instructions" with the chain (own 65,536-byte budget, broad-to-specific truncation as DSH), sent when the Workspace session opens in a chapter and on changes, placed after the memory baseline; a chapter seed carries the latest chain. The skill catalog of the Robot merges providers by rank: platform (-1), Host home (0, with the Space library), local (1, with the Host repository). skill loads a Host skill through SkillLoad.
- **Worktrees.** CreateWorktree runs the DSH worktree runtime in the app (unconfined, platform act) under <repository>/.agents/worktrees/<robot slug>, moves the Robot's current directory, records the worktree on the Workspace session; the policy then uses the worktree and <repository>/.git as write roots and not the main working tree. Subagents cannot create worktrees.
- **LSP.** lsp.yaml in the Host config directory with DSH's servers record; the app ships a default set and filters entries whose command is not on the captured PATH before mounting; a provider instance per Workspace session with the Workspace root as the LSP root; disposed on session close and after 30 minutes without a query; the lsp tool accepts on: 'workspace' only and renders locations.
- **Code view.** Work details levels gain 'code'; the setting moves to the Robot with the Member's value as default; at Code, the Conversation page requests the tool events of its visible items from the chapter log (bounded by the page) and renders them with components ported from DSH's trajectory presentation into one shared set the Trajectory also uses; the Workspace panel issues its git commands through the Host with repository configuration disabled and read-only flags. The prompt's runtime section gains one static Workspace line (Host, root, repository, shell); the current directory is available through working_directory and the panel.
- **Fleet.** RobotSummary gains workspace (host, root) or null with a Space migration; the Robot writes it on every setting change.
- **Service Host.** Two bundles from one source (host-service.cjs without Electron; the Electron main importing the same modules); pair from the terminal; the graphical check asks for a display (DISPLAY/WAYLAND_DISPLAY on Linux, a window server session on macOS, an interactive session on Windows); infra/host/ holds the Nix module, the systemd unit with TimeoutStopSec and a stop notice to the Worker, and the launchd plist; the app's Node tests cover the environment capture, the policy from grants and the session lifecycle.
- **Prompt and skill.** The bound rises to 3,000 words; the closing note records the measurement; the coding skill carries the practice; the hosts skill and the source ladder say that a Workspace is where a coding Robot's work is.
- **Definition and Add.** A platform definition source in the library (read-only, like platform skills) with robots/coding-robot; the Add form asks for the Workspace when grants.yaml names Host facets; the Robot in setup gets the Workspace line without reaching the Host.
- **Glossary** per cw-791g.

## Testing Decisions

A good test drives the system the way a person or a Robot does: through the edge API in workerd with the scripted model and the Host stub (which speaks the new RPCs over a temporary directory with real AGENTS.md files, a fake skills tree and a git repository), through the Host app's own Node tests, or through a rendered PWA component with a stubbed API; the Host app on real machines is checked by hand.

- **Workerd through the API with the scripted model** (prior art: v1.16 Host and places tests, v1.15 skills tests, v1.3 memory tests): the rename and the alias with its notice (cw-shlm); the Workspace setting validated through the stub, the picker RPCs, on: 'workspace' resolving to the Host and the current directory, the Host-by-name default directory unchanged, working_directory kept and restored, the deputy edit, shared-root hash conflicts, the Fleet, Subagent directories, requiresHosts unchanged (cw-gx04 to cw-ffs7); the chain from a stub tree with home, repository, nested and .local files, duplicates collapsed, the budget, the own platform message, refresh on cd and on a deeper edit, a changed and a removed file, symlinks outside skipped (cw-ec6f, cw-hm3d, cw-jc3f); the merged catalog and precedence, a Host skill loaded, digests suppressing resends (cw-s2rt, cw-rkud); the protocol version refusal (cw-jn59); file tools: read fields, CRLF edits, idempotent writes, the frame limit (cw-vwo1 to cw-1ov7); create_worktree through the stub with the four fields and the write roots (cw-11je, cw-zuyu); the lsp tool on 'workspace' only, its rendering (cw-lx4f, cw-xxqw); Work details per Robot, Code default, the page's tool events read from the log (cw-jy38, cw-sc3z, cw-1h3q); the prompt line static and the bound (cw-xbx3, cw-etsj); the chief's defaults, the platform definition, the Add form's Workspace (cw-evn7, cw-wio5, cw-nm6y).
- **Host app Node tests** (prior art: the app's link, files and jobs tests): environment capture and scrub with the allow-list, the policy from a grant with a worktree root, the Workspace session lifecycle closing LSP, lsp.yaml filtering by PATH, the chain walk with symlinks and overlays, git commands with configuration disabled (cw-et7q, cw-o4fr, cw-p4bm, cw-9026, cw-fb1q, cw-yeq1, cw-1wrt).
- **Component tests** (prior art: v1.3 work details, v1.17 Pages): each renderer, the Workspace panel, the Work details setting, the picker (cw-sc3z, cw-1wrt, cw-gx04).
- **By hand**: the Host app on the owner's NixOS (his real chain, skills, LSP on this repository, worktrees, git as him) and the service entry on a display-less VM through the Nix module (cw-o2qo, cw-dkkw, cw-bi6y, cw-y7wy, cw-dr33, cw-ixto).
- **Acceptance**: one ticket named by the owner, implemented by a Coding Robot; the owner's judgement and the list of what hurt (cw-6ucq).

## Out of Scope

A second agent runtime on the Host; offline work; image generation; Project and Team; a Workspace on the Box; a pty or a persistent shell on a Host; per-Member chains on a shared Host; sandboxed language servers; network confinement; an editor in the app; desktop control on a Host; watching instruction files (refresh stays touch-driven, as DSH).

## Further Notes

- **Revision 2** answers the review docs/review/v1.21-spec-review.md: the DSH packages that bind to an Agent are not mounted (finding 1); the chain is its own message with DSH's budget (6, 7); 'workspace' is a place name so on stays mandatory and v1.16's default directory stands (23, 24, 26, 27); worktrees get the write roots that isolate them (10); LSP gets a config, a default set and a lifecycle (13, 14, 16, 57); the Code view reads the log (31, 32); the prompt bound rises and the directory leaves the runtime section (39, 40); environment, credentials, hashes, idempotent writes, line endings and limits are stories (18, 46, 48, 49, 50, 51); the Add form carries the Workspace (36); the definition is a platform source (37); lsp sits under files (38); the protocol has a version (44); tickets are smaller and ordered (58 to 67). Findings left as notes are accepted limits and are said in the docs.
- **The brain in Cloudflare.** The agent's withdrawn proposal and the owner's reason are recorded in the Problem Statement so the next reader does not reopen it.
- **No second class of Robot.** A coding Robot is mounted plugins plus a Workspace and a view; say stays.
- **Words.** Files / Workspace / Project (reserved), the agent's choice when the owner deferred.
- **Acceptance is use.** The owner: "I have to start using it and find what hurts, not debate it."
