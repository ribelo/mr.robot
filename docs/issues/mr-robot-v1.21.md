---
title: "Mr. Robot v1.21 — Robots on Hosts: Workspace, DSH instructions and skills, LSP, the Code view, the service Host"
status: ready-for-agent
story-prefix: cw
parent: mr-robot-v1.20.md
---

# Mr. Robot v1.21 — Robots on Hosts

## Problem Statement

The owner works in two worlds: DeepSeek Harness on his desktop (the full power of his machine, his skills, AGENTS.md per repository, LSP, a trajectory that shows every call and every diff) and Mr. Robot (identity, memory, Tasks, Grants, one endless Conversation, costs, Channels, Hosts). Nothing crosses between them. On 2026-10-21 he asked to end that: Robots that develop software on his machine, under Mr. Robot, so that there is one place to talk, one memory, one Task list, one set of skills, and one Mission Control that does not care whether a Robot works in the cloud, on his laptop or on a VPS.

The first-principles review settled the shape: **the brain stays in Cloudflare, the tools go where the work is.** The agent loop always runs in the Robot's Durable Object; a Host is a place for tools, as v1.16 made it. Performance was weighed and set aside: a model call is slow and remote either way, and a tool round trip over the Host link is a second cost in the place that matters least. What is missing is not a second runtime but five things DSH has and a Robot on a Host does not:

1. **A working directory.** DSH knows the repository it is in and reads the chain of AGENTS.md files; a Robot has no notion of where on a Host it works.
2. **Instructions and skills from the machine.** The user-global AGENTS.md, the project chain, `.agents/skills` in the home and in the repository.
3. **LSP.**
4. **The view.** The owner does not want reports; he wants to see every call and every diff in the chat, as DSH shows them. This is not comfort; without it he cannot work.
5. **A Host without a screen.** The Host app is Electron with a tray; a VPS needs the same thing as a service.

And one word stands in the way: Workspace already names the Robot's files in R2, and the owner wants the word to mean what it means in DSH.

## Solution

**Words.** The Robot's files in R2 become **Files** (the view, the tool group, `on: 'files'`). **Workspace** becomes a place and a directory where a Robot works: a Host and a root path, or the Box and /workspace. **Project** is reserved for a later concept of people, Robots and a goal (Wiser's Team will come as its own layer when it comes).

**Workspace.** A Robot setting (place, root), set by the owner or by Mr. Robot through the deputy tools; the default on and cwd of every place tool; working_directory and create_worktree (DSH's worktree runtime, mounted on the Host) move the Robot inside it; several Robots may share a root; a Robot with a Workspace on a Host requires that Host online by default; Mission Control shows the place.

**DSH's instructions and skills, read by the Host app.** The Host app mounts DSH's agent-instructions, working-directory and skill-filesystem packages unchanged; what they compute for the Robot's Workspace (the instruction chain, its change notices, the skill catalog from ~/.agents/skills and the repository) travels over the Host protocol and enters the Robot's context as a Workspace baseline beside its memory, with DSH's budget and precedence. One skill catalog: Host skills, the Space library, the platform skills.

**LSP.** DSH's lsp package on the Host, exposed as the lsp tool under the Host's files facet; language servers discovered per project, started on first use, stopped with the Turn or after idling.

**The Code view.** Work details becomes a Robot setting with a Member default and a new level, Code: every tool call rendered in the Conversation between the Robot's messages with DSH's renderers (diff, fragment, command and output, lists, locations); a Robot with a Workspace defaults to it; a Workspace panel shows the repository's files, git status and the last commits; the Trajectory uses the same renderers.

**The service Host.** One codebase, two entries: mr-robot-host --service runs the Node bundle without Electron and without a display, paired from a terminal; the desktop entry adds the tray, the window, the Host browser, the sign-in windows and notifications. A Nix module and systemd and launchd units make an always-on Host one line.

**Roles and the first Robot.** Mr. Robot keeps no Workspace and no lsp; he gives coding Robots Tasks, reads them and configures them. A Coding Robot definition ships in the Marketplace. Acceptance: a Coding Robot on the owner's computer implements one ticket from the queue, end to end, and the owner judges whether that is working with DSH.

## User Stories

### Words
1. As an owner, I want the Robot's files in R2 called Files everywhere (the Files view, the files group, on: 'files'), so that the word Workspace is free for where a Robot works ^cw-pxoq
2. As an owner, I want Workspace to mean a place and a directory where a Robot works (a Host and a path, or the Box and /workspace), set per Robot by me or by Mr. Robot, so that the word means what it means in DeepSeek Harness ^cw-0fto
3. As an owner, I want Project reserved and unused, so that a future concept of people, Robots and a goal has its word ^cw-lg6l

### Workspace
4. As an owner, I want a Robot's Workspace setting (place, root directory) with no Workspace as the default, so that a Robot without one works as today ^cw-fzoh
5. As a Robot, I want my Workspace to be the default on and cwd of run, the file tools, copy and the job tools, so that I work where I was put without naming it every call ^cw-flwb
6. As a Robot, I want working_directory to read and change my current directory within my Workspace's Host, recorded like DSH records it, so that I move between folders the way DSH does ^cw-wc2m
7. As a Robot, I want create_worktree from DSH's worktree runtime on my Workspace's Host, creating a checkout and a branch and moving my current directory there, so that several Robots work on one repository without touching each other's files ^cw-tmkf
8. As an owner, I want several Robots to share one Workspace root, so that ten Robots in one repository is a matter of ten settings ^cw-s3hu
9. As an owner, I want a Robot with a Workspace on a Host to require that Host online by default (the v1.16 setting on), so that it never runs without its code ^cw-27ct
10. As an owner, I want Mission Control's Fleet to show each Robot's place (cloud, or the Host and Workspace root), so that one page shows where everything runs ^cw-vbza

### Instructions and skills from the Host
11. As a Robot, I want the instruction chain DSH reads, read the same way on my Workspace's Host by the Host app (the harness-home AGENTS.md, ~/.agents/AGENTS.md, then every AGENTS.md or CLAUDE.md from the repository root to my current directory, with the .local.md overlays, duplicates collapsed, a byte budget), delivered into my context as a Workspace baseline beside my memory, so that I work under the same rules DSH works under ^cw-714r
12. As a Robot, I want a read, write or edit that reaches a deeper directory to bring the newly applicable instruction file in the next step, a changed file to replace its content and a removed one to leave a notice, exactly as DSH does, so that the chain follows me ^cw-3zaq
13. As a Robot, I want skills discovered on my Workspace's Host from ~/.agents/skills and <repository>/.agents/skills, merged with the Space library and the platform skills into one skill catalog with DSH's precedence, so that my owner's skills are mine ^cw-v351
14. As an operator, I want the Host app to mount DSH's agent-instructions, working-directory and skill-filesystem packages unchanged and to serve their results over the Host protocol, so that the behaviour is DSH's and the only new code is the carrier ^cw-xrh7
15. As an owner, I want the instruction and skill files cached by content hash on the Host and sent only when they change, so that a Turn start costs one round trip ^cw-jfnk

### LSP
16. As a Robot, I want an lsp tool on my Workspace's Host (goToDefinition, findReferences, goToImplementation, hover) from DSH's lsp package, under the Host's files facet, so that I navigate code the way DSH does ^cw-xc5u
17. As an owner, I want the Host app to run language servers the way DSH Desktop does, discovered per project, started on first use and stopped with the Robot's Turn or after idling, so that nothing runs for nothing ^cw-xzmf

### The Code view
18. As an owner, I want Work details to be a Robot setting with a Member default, with a new level Code that shows every tool call in the Conversation between the Robot's messages, so that a coding Robot's chat reads like a DSH session ^cw-l4ro
19. As an owner, I want DSH's renderers in the Conversation: a diff for edit and write, the fragment for read, the command and its output for run and jobs, lists for glob and grep, locations for lsp, so that I see the code, not a report ^cw-hnqh
20. As an owner, I want a Robot with a Workspace to default to Code, so that the view follows the work ^cw-yqi5
21. As an owner, I want a Workspace panel for such a Robot: the repository's files under the root (read on demand from the Host), git status and the last commits, the current directory and the worktree if any, so that I see the state of the repository without a terminal ^cw-yrc8
22. As an owner, I want the Trajectory to render tool results with the same renderers, so that both views agree ^cw-el1d

### The service Host
23. As a person, I want the Host app to start as a service with no window and no display (mr-robot-host --service), paired from a terminal with a printed link or code, so that a VPS or a box in the corner serves Robots ^cw-8b27
24. As a person, I want one application, one codebase: the service entry runs the Node bundle without Electron; the desktop entry adds the tray, the window with the app, the Host browser, the sign-in windows and notifications, so that nothing exists twice ^cw-x1x8
25. As a person, I want a Nix module and a systemd unit (and launchd on macOS) for the service, so that an always-on Host is one line of configuration ^cw-shtf
26. As an owner, I want a Host without a display to report no browser facet and no sign-in windows, as today, so that a service Host offers files, shell, lsp and Workspaces ^cw-k0vx

### The chief, the definition, the prompt, the skill
27. As an owner, I want Mr. Robot to have no Workspace and no lsp by default, to give coding Robots Tasks, read their Conversations and change their Workspace through the deputy tools, and to keep his Host grants for what a chief does there, so that the chief stays a chief ^cw-edcw
28. As an owner, I want a Coding Robot definition shipped in the Marketplace (SOUL.md for an engineer, AGENTS.md with the working rules the owner uses, grants: files, shell and lsp on a Host, no Box, no browser; Code view), so that the first coding Robot is one Add and a Workspace ^cw-515a
29. As an owner, I want the platform prompt's Workspace line to tell the Robot its Host, root, current directory, shell and worktree, so that it knows where it is ^cw-lvty
30. As a Robot, I want a platform skill coding (how to work in a Workspace: instructions first, tests the repository's way, commit as the repository asks, report with say at the end, ask for decisions, never clone elsewhere), so that practice is written once ^cw-7q57

### Acceptance
31. As an owner, I want the acceptance of this spec to be a Coding Robot with a Workspace on my computer implementing one ticket from the queue end to end (spec to commit to report), judged by me, so that the claim is tested on itself ^cw-bmhi

### Glossary and docs
32. As an owner, I want the glossary to define Files, Workspace, Code view, Service Host and Coding Robot and to reserve Project, so that the words are one ^cw-fku9
33. As a Robot, I want docs/hosts.md, docs/memory-and-files.md and a new docs/workspaces.md updated, so that what I read is what the platform does ^cw-qvge

## Implementation Decisions

- **Rename.** Files replaces Workspace for the R2 files in protocol, routes, UI strings, docs, glossary, the files tool group's description and `on: 'files'` (with `'workspace'` accepted for one release and mapped). The R2 prefix and the Files view code keep their internal names where renaming buys nothing.
- **Workspace setting.** `workspace: { on: 'box' | <host>, root: string } | null` on the Robot config, edited in Robot settings and by the deputy settings tool; the current directory is a per-Robot value the Host app keeps through DSH's working-directory service (the Robot DO stores the last known one for the prompt and the panel). Place tools default `on` and cwd from it when the call omits them; a call may still name any granted place. requiresHosts defaults to true when the Workspace is on a Host.
- **Host composition.** The Host app's DSH composition (bash/pwsh, sandbox-local, jobs-local from v1.16) grows by working-directory, agent-instructions (default candidates and overlays, maxBytes from the Robot's context budget), skill-filesystem (home and repository roots), the experimental worktree runtime and tool-worktree, and the lsp package. A Workspace session on the Host is keyed by Robot id and carries that Robot's current directory. New RPCs: WorkspaceOpen (root) → the instruction baseline and the skill catalog with hashes; WorkspaceState → current directory, chain changes since the last call, catalog changes; WorkingDirectory (cd); CreateWorktree; Lsp (operation, file, line, character); SkillLoad (name). The Robot DO asks WorkspaceState at the start of each step that follows a file tool call in a deeper directory (DSH's rule) and at Turn start; the memory plugin's baseline gains a Workspace block built from the chain; a notice message carries chain changes, as the memory change notes do.
- **Skills.** The Robot's skill tool resolves names across three providers in DSH's precedence order: the Host catalog (repository over home), then the Space library, then platform skills; a loaded Host skill's body comes over SkillLoad.
- **LSP.** `lsp({ on?, operation, file_path, line, character })`, positions one-based like DSH; the Host app discovers servers as DSH Desktop does (its configuration format is reused), starts on first use, stops on Turn end or after ten idle minutes; results render as locations.
- **Code view.** Work details levels: Compact, Standard, Detailed, Verbose, Code; stored per Robot with the Member's default; the Conversation renders tool events at Code with components ported from DSH's trajectory presentation (edit/write diff, read fragment, run and job output with exit code, glob/grep lists, lsp locations, copy summaries), the same components the Trajectory uses from now on. The Workspace panel: a file tree under the root (listed with glob on demand, paged), git status and git log -n 20 (run through the Host, read-only commands the panel issues itself), the current directory and worktree.
- **Service Host.** The Host package builds two bundles from one source: host-service.cjs (Node entry: config, pairing from the terminal, the link, handlers, the DSH composition; no Electron import) and the Electron main that imports the same modules and adds tray, window, Host browser, sign-in windows, notifications. `mr-robot-host pair <server>` prints the pairing link and waits; `mr-robot-host --service` runs; the heartbeat reports graphical: false and no Chrome; the Nix module and the units ship in infra/host/.
- **Chief and definition.** Mr. Robot's defaults: no Workspace, lsp absent; deputy tools gain Workspace and Work details fields. The Coding Robot definition lives in the Space library's robots/coding-robot/ shipped with the Worker as a platform definition (read-only like platform skills) and listed first in the Marketplace.
- **Prompt and skill.** The runtime section gains the Workspace line; a platform skill coding; the Hosts skill updated.
- **Glossary** per cw-fku9.

## Testing Decisions

A good test drives the system the way a person or a Robot does: through the edge API in workerd with the scripted model and the Host stub (which now speaks the Workspace RPCs over a temporary directory with real AGENTS.md files and a fake skills tree), or through a rendered PWA component with a stubbed API; the Host app itself is checked by hand on the owner's NixOS and on a display-less VM.

- **Workerd through the API with the scripted model** (prior art: v1.16 Host and places tests, v1.15 skills tests, v1.3 memory tests): the rename with the one-release alias (cw-pxoq); the Workspace setting as default on and cwd, a call naming another place, working_directory, create_worktree through the stub, shared roots, requiresHosts default, the Fleet's place (cw-fzoh, cw-flwb, cw-wc2m, cw-tmkf, cw-s3hu, cw-27ct, cw-vbza); the instruction chain in the baseline from a stub tree with home, root, nested and .local files, duplicates collapsed, the budget, the notice after a deeper edit, a changed and a removed file (cw-714r, cw-3zaq, cw-jfnk); the merged skill catalog and precedence, a Host skill loaded (cw-v351); the lsp tool through the stub (cw-xc5u); Work details per Robot with the Member default, Code as the Workspace default (cw-l4ro, cw-yqi5); Mr. Robot's defaults and deputy fields, the shipped definition in the Marketplace (cw-edcw, cw-515a); the Workspace line in the prompt and the coding skill in the index (cw-lvty, cw-7q57).
- **Component tests** (prior art: v1.3 work details, v1.17 Pages): the Code view renderers for each tool kind, the Workspace panel, the Work details setting (cw-hnqh, cw-yrc8, cw-el1d).
- **By hand**: the Host app on the owner's NixOS: instructions and skills read from his real tree, LSP on this repository, worktrees; the service entry on a display-less VM paired from the terminal, with the Nix module (cw-xrh7, cw-xzmf, cw-8b27, cw-x1x8, cw-shtf, cw-k0vx).
- **Acceptance**: a Coding Robot with a Workspace on the owner's computer implements one ticket from the queue end to end; the owner's judgement is the result (cw-bmhi).

## Out of Scope

A second agent runtime on the Host (the loop stays in the Durable Object); offline work; image generation; Project and Team as concepts; a Workspace on the Box beyond /workspace; Windows LSP beyond what DSH supports there; an editor in the app (the Workspace panel reads, it does not edit; the Robot edits); sandbox modes beyond v1.16's; desktop control on a Host.

## Further Notes

Decisions from 2026-10-21, with what was weighed.

- **The brain in Cloudflare.** The agent proposed, then withdrew, running the loop on the Host; the owner's argument settled it: the model is remote anyway, tool latency is the smallest cost, and one loop keeps log, memory, Tasks and steer in one place.
- **No second class of Robot.** A coding Robot is a set of mounted plugins plus a Workspace and a view; say stays, because a coding Robot has a voice as DSH has its final message; the difference the owner wanted is the view, which is Work details, now per Robot.
- **Words.** The agent chose Files / Workspace / Project (reserved) when the owner deferred: Workspace in DSH's sense also covers the Box's /workspace, and Project must stay free for a SaaS-level concept.
- **Worktrees now**, because DSH ships the runtime and the tool experimentally and the Host app mounts DSH.
- **One application, two entries.** The owner preferred one app; the service entry is the same Node bundle without Electron so a VPS needs no display.
- **Acceptance is use.** The owner: "I have to start using it and find what hurts, not debate it."
- Seams: the Host protocol and its stub, the edge API in workerd, component tests, manual runs on two machines. No new seam.
