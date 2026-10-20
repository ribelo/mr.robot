---
title: "Mr. Robot v1.16 — One body: one execution surface, Hosts through DSH, files without limit, the Box image, two browsers"
status: ready-for-agent
story-prefix: ob
parent: mr-robot-v1.15.md
---

# Mr. Robot v1.16 — One body

## Problem Statement

The owner reviewed Hosts and the Box against the Grok Bot leak from first principles on 2026-10-20 (the grill session continued from v1.15). Grok Bot gives an agent one computer of its own and treats the user's computer as a second, expensive surface for things that live only there. Mr. Robot has grown two bodies for a Robot (a Box for commands, a Container Chrome for browsing), three cloud browsers, and two families of tools that do the same thing in two places. The session found:

1. **Two tool families for one job.** box_run, box_read, box_write on the Box; host_run, host_read, host_write, host_copy on a Host; read, write, edit, glob, grep on the Workspace. The Robot learns three vocabularies for "run a command" and "read a file"; a program in code mode branches on the tool name instead of on the place.
2. **The Host runs commands the old way.** host_run spawns a login shell with a timeout and nothing else: no sandbox, no background job, no notice when a long command ends. The Box got jobs in v1.15; the Host did not. DSH already ships bash and pwsh tools, a per-platform sandbox (bwrap or Landlock on Linux, Seatbelt on macOS, a restricted token on Windows) and an in-process job registry, all of which run in a Node process, and the Host app is a Node process.
3. **No Windows.** The Host app builds for Linux and macOS. The owner's household has a Windows machine.
4. **A Robot that needs its Hosts runs without them.** A disk cleaner or a coding agent wakes on its schedule, finds its Host offline, and burns a Turn to report it.
5. **Files are capped.** host_copy moves at most 100 MB through the Member Durable Object; the owner wants to move 2 GB videos. The Box disk holds 4 GB and the box/ folder is copied in whole at boot, so a big file has no good place.
6. **Three cloud browsers for no measured gain.** The v1.1 four-site runs show Browser Rendering passing four of five sites, Container Chrome without VPN passing three, Container Chrome through Proton passing the same four at a higher price, and only the Host browser passing Allegro. The proxy variant was never measured. Two backends can be justified from first principles: one in the cloud without a container, one on a real computer.
7. **The Box is bare.** Python with Pandas, Node, Bun, git, curl and jq; no ripgrep, no ffmpeg, no way to reach the Workspace from a script. A Robot cannot know what its Box has without probing it.
8. **Hosts are named on every call.** The host parameter is required even when a Robot holds one Host.

## Solution

**One execution surface, every place explicit.** The tools are run, read, write, edit, glob, grep, delete_file and copy, each with a mandatory `on`: workspace (the Workspace in R2; files only), box (the Robot's Box) or the name of a Host. Nothing defaults: a call names its place, and copy names both ends. Jobs are one registry per Robot: job_list, job_output and job_kill work the same for a job on the Box and a job on a Host. The old box_* and host_* tools go. Grants are unchanged in shape: the files group covers the Workspace, the box grant covers the Box, a Host's files and shell facets cover that Host; a Host facet now also carries a mode and write roots.

**The Host executes through DSH.** The Host app mounts DSH's bash (or pwsh on Windows), sandbox-local and jobs-local. Each call carries the mode and the roots from the Robot's grant on that Host: read-only, workspace-write with the Robot's directory (~/mr-robot/<robot>/) and any roots the owner added, or full. A confined mode that the platform cannot enforce fails closed. A write the sandbox denies comes back as a denial; the Robot may retry the same call with escalate, which puts a one-call Ask to the owner for an unconfined run, as Auto review does. Reads stay as wide as the OS user; that is by design.

**Windows.** The Host app builds for Windows; its shell is pwsh; its sandbox is the DSH restricted-token runner; the Robot's directory is %USERPROFILE%\mr-robot\<robot>\. The runtime section tells the Robot the shell of each Host.

**A Robot that waits for its Hosts.** A Robot setting, off by default: "Do not run while any of my Hosts is offline", where its Hosts are those it holds any facet on. A recurring Task that finds a Host offline ends its Attempt as failed without a Turn and notifies once per outage; a scheduled Task waits for the Host and runs if it still fits before its deadline; the owner's messages always wake the Robot.

**Files without limit.** copy between any two places. Host to Workspace and Workspace to Host go straight between the Host app and R2 through presigned URLs the Worker mints for one key in the Robot's prefix (multipart for uploads); the Worker is never the pipe and the Box is never a stop. Box to Workspace and back go the same way through a small program ws in the Box image, so a script can fetch a file mid-run. Host to Host stages in the Workspace under tmp/ and cleans up. The layers are named in the docs and a platform skill: the Workspace keeps what must survive, box/ holds what the Box needs at every boot and is small, the rest of the Box disk is scratch, big files go to the Workspace directly and are fetched where they are needed.

**The Box image.** One image with what an agent reaches for before thinking: ripgrep, fd, jq, yq, sd, less, tree, file; tar, gzip, xz, zip, unzip, zstd, curl, wget; sqlite3; Python with requests, httpx, openpyxl, python-docx, pypdf, Pillow, beautifulsoup4, lxml, pyyaml, polars beside Pandas, and uv; ffmpeg, imagemagick, poppler-utils; git, build-essential with Python headers, Node, Bun, pnpm through corepack; locales pl_PL and en_US, tzdata, procps, iproute2; and ws. No browser, no pandoc, no tesseract, no LibreOffice, no Docker, no login-bound CLIs. The uv and Bun caches point into box/.cache/. The image writes a manifest of its tools and versions at build; the deploy generates docs/box.md's tool list from it, so the Robot reads what it has and never guesses. The instance stays standard-1.

**Two browsers.** Container Chrome in all three variants (plain, via VPN, via proxy) is removed with its image, wireproxy, the WireGuard and proxy credentials and the admin cards; the Home default returns to Browser Rendering; Robots on a removed backend move to the Home default. The browser backends are Browser Rendering and the Host browser. Chrome in the Box comes back only on evidence of a block that neither handles.

**Small things.** A tool-call Ask for a facet of a Host is shown as a native notification on that Host and opens the Ask in the app. Mr. Robot's files and shell facets on a new Host start at ask. The Hosts line in the prompt names each Host's shell and sandbox state. Two platform skills, box and hosts, carry the practice. Glossary and docs follow.

## User Stories

### One execution surface
1. As a Robot, I want one tool run with a mandatory on (box or a Host name), a command, an optional cwd, a time limit and run_in_background, so that running a command is one thing wherever it runs ^ob-5fjs
2. As a Robot, I want read, write, edit, glob, grep and delete_file to take a mandatory on (workspace, box or a Host name), so that a file tool is one thing wherever the file is ^ob-ff4g
3. As a Robot, I want a tool copy with from and to, each naming its on and path, so that a file moves between any two places in one call with no default end ^ob-9afl
4. As a Robot, I want job_list, job_output and job_kill to work on every job of mine, Box or Host, with the place shown in the list, so that jobs are one registry ^ob-rc3b
5. As an owner, I want the old box_run, box_read, box_write, host_read, host_write, host_run and host_copy gone, and a call to a place the Robot has no grant on refused with the grant named, so that one vocabulary remains and the grants still gate it ^ob-dyg4
6. As a Robot, I want a call that names a Host I hold no facet on, or a Host that does not exist, refused with a clear message, so that I never guess at places ^ob-qnf7
7. As an owner, I want Member files, the product docs and the platform skills reachable only with on workspace, and the Box and Host refusing those paths, so that the owned files stay where they are ^ob-pfcu

### The Host executes through DSH
8. As an operator, I want the Host app to run commands through DSH's bash on Linux and macOS and pwsh on Windows, with DSH's sandbox-local, so that the mechanism is DSH's and only the place is ours ^ob-wsf7
9. As an owner, I want a Host's files and shell facets to carry a mode (read-only, workspace-write or full) and a list of write roots, defaulting to workspace-write with the Robot's directory as the only root, so that a Robot writes where I said ^ob-wh59
10. As a Robot, I want my directory on a Host (~/mr-robot/<robot>/ or the Windows equivalent) created on first use and used as the default cwd, so that I have a home on each Host ^ob-397e
11. As a Robot, I want a write the sandbox denied to come back as a denial that names the path, so that I know what was refused ^ob-vnld
12. As a Robot, I want to retry the same call with escalate, which puts a one-call Ask to my owner for an unconfined run, and to get the result when they approve, so that a rare wide write needs no permanent grant ^ob-ifak
13. As an owner, I want a confined call on a Host whose sandbox cannot be enforced to fail closed with the reason, and the Hosts page to show each Host's sandbox state, so that nothing runs unconfined by accident ^ob-n72n
14. As an owner, I want full mode to run unconfined even on a Host without a sandbox, so that a Host I trust fully still works ^ob-he20
15. As an owner, I want reads to stay as wide as the OS user in every mode, so that the Host behaves as v1.2 decided ^ob-xj2y
16. As a Host app user, I want a Host shared with the Home documented with the instruction to install the app under its own OS account, so that a NAS serves the Home without exposing my files ^ob-5c8k

### Jobs on a Host
17. As a Robot, I want run on a Host to wait up to its limit and then go on as a job, or start as a job at once with run_in_background, exactly as on the Box, so that a build or a watcher runs while I do something else ^ob-sja4
18. As a Robot, I want a finished Host job to wake me as a follow-up with its id, exit code and the tail of its output, the whole log under spill/, so that I hear the end without polling ^ob-ku5j
19. As an owner, I want a Host app restart or disconnect under a running job to mark the job lost and wake the Robot as failed, so that nothing is silently dropped ^ob-cgn1
20. As a Robot, I want job_output with wait on a Host job to stream what arrived since my last read, so that I follow a job the same way everywhere ^ob-6kkn

### Windows
21. As a person, I want a Windows build of the Host app with the same pairing, tray and status, so that the Windows machine in the household serves Robots ^ob-szqb
22. As a Robot, I want the runtime section to name each Host's shell (bash or pwsh) and platform, so that I write the right commands ^ob-vyyg
23. As an owner, I want the Windows sandbox to confine writes with DSH's restricted-token runner and to report partial enforcement honestly, so that I know what the gate is ^ob-e68m

### A Robot that waits for its Hosts
24. As an owner, I want a Robot setting "Do not run while any of my Hosts is offline", off by default, where its Hosts are those it holds any facet on, so that a Robot that needs a computer does not run without it ^ob-5nvd
25. As an owner, I want a recurring Task of such a Robot that finds a Host offline to end its Attempt as failed with the Host named, without a Turn, and to notify me once per outage, so that nothing runs needlessly ^ob-qgpy
26. As an owner, I want a scheduled Task of such a Robot to wait for the Host and run when it returns if the deadline still allows, else to fail, so that one-off work is not lost to a short outage ^ob-e271
27. As an owner, I want my messages to wake such a Robot even while a Host is offline, with its Host calls failing as today, so that I can always talk to it ^ob-amlz
28. As a Robot, I want the setup interview to propose the setting when I ask for a Host facet, so that the owner decides it once ^ob-kvw3

### Files without limit
29. As a Robot, I want copy from a Host to the Workspace to move a file of any size, so that a 2 GB video lands in the Workspace ^ob-d3rt
30. As an operator, I want Host-to-Workspace and Workspace-to-Host copies to go between the Host app and R2 through presigned URLs for one key in the Robot's prefix, multipart for uploads, so that the Worker is never the pipe and the limit is R2's ^ob-qshq
31. As a Robot, I want copy from the Workspace to the Box and back to move files of any size through ws, so that the Box gets its input without box/ ^ob-fgyk
32. As a Robot, I want copy from a Host to a Host, staged in the Workspace under tmp/ and cleaned up, so that two computers exchange a file without me in the middle ^ob-qr7v
33. As an owner, I want copies of large files shown in the Trajectory with their size and time and counted as Workspace storage, so that I see what moved ^ob-7hp3
34. As a Robot, I want a script on the Box to run ws ls, ws get, ws put and ws rm against my Workspace with a token valid for the Box's life and my prefix only, so that a program fetches what it needs mid-run ^ob-63nt
35. As an owner, I want the Box's token to reach only that Robot's Workspace prefix and to die with the Box, so that one Box can never read another's files ^ob-o6aw

### The Box image
36. As a Robot, I want the Box image to hold the tools the spec lists, so that I reach for ripgrep, ffmpeg or sqlite3 without installing them ^ob-asp3
37. As an owner, I want the image to stay without a browser, pandoc, tesseract, LibreOffice, Docker and login-bound CLIs, so that it boots fast and carries nothing idle ^ob-e8q1
38. As a Robot, I want the uv and Bun caches under box/.cache/, so that a second boot does not download the same packages ^ob-phi5
39. As a Robot, I want docs/box.md to carry the list of tools and versions generated from the image at build, so that I read what I have and never guess ^ob-m73k
40. As an owner, I want the Box to stay on standard-1 and its minutes to stay a cost source I see per Robot, Member and Home, so that I know if it starts to bite ^ob-g6vg

### Two browsers
41. As an owner, I want Container Chrome, Container Chrome via VPN and Container Chrome via proxy removed, with the Chrome image, wireproxy, the WireGuard and proxy credentials and the admin cards, so that the code holds only what is justified ^ob-ltsr
42. As an owner, I want the Home default browser backend to be Browser Rendering and every Robot on a removed backend moved to the Home default at the upgrade, so that nothing breaks ^ob-l24v
43. As an owner, I want the browser docs and the backend picker to show Browser Rendering and Host browsers only, and the block message to suggest the other, so that the choice is two ^ob-myzd
44. As an owner, I want past browser usage rows of removed backends kept in cost history, so that the past stays true ^ob-0c3o

### Asks and defaults on a Host
45. As an owner, I want a tool-call Ask for a facet of a Host shown as a native notification on that Host that opens the Ask in the app, so that I decide where the command would run ^ob-6jr5
46. As an owner, I want Mr. Robot's files and shell facets on a new Host to start at ask, raisable by me, so that the chief does not act on my disk unasked ^ob-2k5x
47. As a Robot, I want the Hosts line to name each Host's state, shell and sandbox state, so that I know what a call will meet ^ob-gjp9

### Skills, prompt, docs
48. As a Robot, I want a platform skill box: the three layers (Workspace, box/, scratch), big files straight to the Workspace and fetched with copy or ws, setup.sh and the caches, jobs, what the image has, so that I use the Box the way it is built ^ob-vw9d
49. As a Robot, I want a platform skill hosts: when a Host is the right place, my directory, modes and the denial path, jobs, offline behaviour, the shared-Host rule, so that I use a Host the way its owner expects ^ob-ivby
50. As a Robot, I want the platform prompt's source ladder to name the Box before a Host and a Host only for the owner's files, environment or connection, so that the order is written once ^ob-f7q7
51. As an owner, I want the glossary to define Place (workspace, box, Host), Job on a Host, Mode and Write roots, ws, and to drop Container Chrome and the host_*/box_* tool names, so that the vocabulary is one ^ob-2eyd
52. As an owner, I want docs/hosts.md, docs/box.md, docs/browser.md, docs/grants.md and docs/memory-and-files.md updated, so that what the Robot reads is what the platform does ^ob-3m3e
53. As an owner, I want old Conversations whose tool events name box_* or host_* tools to render, so that history survives ^ob-j9nx

## Implementation Decisions

- **Tools.** One capability "places" mounts run, read, write, edit, glob, grep, delete_file, copy and the job tools (job tools from DSH's tool-jobs over the Robot's registry). Every tool takes `on: 'workspace' | 'box' | string` (a Host name as the Hosts line shows it) and validates it against the Robot's grants before anything else: workspace needs the files group, box the box grant, a Host the facet the tool uses (files for the file tools and copy ends, shell for run). The file tools dispatch to a filesystem backend per place: the R2 filesystem, the Box backend's read/write/list/grep, the Host RPC. The old tools and their plugins are deleted; the projection renders old events by tool name as before.
- **copy.** `copy({ from: { on, path }, to: { on, path } })`. Pairs: workspace↔box (ws inside the Box, see below), workspace↔host (presigned URLs), host↔host (staged under workspace tmp/<id>/ and deleted after), box↔host (staged the same way), workspace↔workspace (R2 copy). A Worker endpoint `/api/files/presign` mints R2 presigned URLs (S3 API, credentials from an R2 API token created by the Alchemy stack and held as a Worker secret) for one key under the Robot's prefix: PUT for a part of a multipart upload, GET for a download; create and complete of a multipart upload go through the Worker (binding). Parts are 64 MB. The Host app's copy engine streams a file in parts with retries; the Member DO only coordinates. Tool results carry size and duration; the Trajectory shows them.
- **ws.** A Bun script in the image at /usr/local/bin/ws: `ws ls [path]`, `ws get <path> [dest]`, `ws put <file> <path>`, `ws rm <path>`. It calls the presign endpoint with a token the Box backend writes to the container at boot (/run/mr-robot/token), scoped to the Robot's prefix and valid while the container lives; the Worker rejects it after the Box stops. copy workspace↔box is implemented as a ws command run in the Box by the backend.
- **Host execution.** The Host app composes DSH: tool-bash (Linux, macOS) or tool-pwsh (Windows) through bash-sandbox / pwsh-sandbox with sandbox-local, and jobs-local. The RPC Run gains `mode`, `roots`, `background` and returns `{ kind: 'foreground' | 'promoted' | 'background', ... }` in DSH's shape; new RPCs JobOutput, JobList, JobKill; the app pushes `{ t: 'job', d: { id, status, exitCode, tail } }` frames when a job ends; the Member DO forwards them to the Robot DO's job registry, which queues the Wake-up and writes the log to spill/jobs/<id>.log. A disconnect marks the Host's running jobs lost. The Robot's directory is created by the app on the first call; cwd defaults to it. Heartbeat gains `shell` and `sandbox: 'full' | 'partial' | 'none'`.
- **Modes and roots on grants.** The Host facet grant payload gains `mode: 'read-only' | 'workspace-write' | 'full'` and `roots: string[]` (the Robot's directory is always a root in workspace-write). The Worker maps them to DSH sandbox policy per call. A denial returns `{ denied: true, path }`; a retry with `escalate: true` goes through the ask gate as a tool-call Ask whose approval runs the call once in full mode. A confined mode on a Host with sandbox none fails with SANDBOX_UNAVAILABLE; full runs.
- **Hosts required.** Robot setting `requiresHosts: boolean`. The Task scheduler, before starting a Turn for a Task Wake-up of such a Robot, checks the online state of every Host the Robot holds a facet on; recurring → Attempt failed "Host <name> offline", notification once per Host outage (a flag cleared when the Host comes back); scheduled → the Wake-up is parked and re-queued on the Host's online event or fails at the deadline. Owner and Robot message Wake-ups are not checked.
- **Windows.** electron-builder nsis target, unsigned for now; pwsh 7 required and reported in the heartbeat (the app points the user at the installer when missing); the Robot's directory under %USERPROFILE%.
- **Box image.** Dockerfile extends the python base with apt packages (ripgrep, fd-find, yq, sd, less, tree, file, xz-utils, zip, unzip, zstd, wget, sqlite3, ffmpeg, imagemagick, poppler-utils, build-essential, python3-dev, locales, tzdata, procps, iproute2), pip packages (requests, httpx, openpyxl, python-docx, pypdf, Pillow, beautifulsoup4, lxml, pyyaml, polars, uv), corepack enable pnpm, and ws. A build step runs each tool's version flag and writes /etc/box-manifest.json; the deploy script reads it and writes apps/worker/src/docs/box-tools.generated.ts, which docs/box.md includes. UV_CACHE_DIR and BUN_INSTALL_CACHE_DIR point to /workspace/box/.cache.
- **Browser removal.** Backend union shrinks to 'browser-run' | host backends; delete infra/chrome, the proxy backend, the WireGuard summary card and the Home credentials for VPN and proxy; a migration moves Robots and the Home default; usage rows keep their backend names as history.
- **Native Ask on a Host.** The Member DO sends a `notify` frame for a tool-call Ask whose items include a facet of that Host; the app shows a notification that opens the Ask's Conversation in its window.
- **Defaults.** On Host pairing, Mr. Robot's grants for files and shell on that Host are written at ask; browser stays allow.
- **Prompt and skills.** Platform skills box and hosts (visible with the box grant and with any Host facet); the Hosts line gains shell and sandbox; the source ladder names the Box before a Host.
- **Glossary** per ob-2eyd.

## Testing Decisions

A good test drives the system the way a person or a Robot does: through the edge API in workerd with the scripted model and the stub backends (Host stub speaking the new RPCs, Box stub), or through a rendered PWA component; the Host app and the image are checked by hand on the three platforms and on staging. No unit test on plugin internals; no test touches the network except the staging and manual runs.

- **Workerd through the API with the scripted model** (prior art: v1.14 Box tests, v1.2 Host tests, v1.15 job tests): run, the file tools and copy with each on, refused without the grant, refused for an unknown Host, owned paths only on workspace (ob-5fjs, ob-ff4g, ob-9afl, ob-dyg4, ob-qnf7, ob-pfcu); jobs on the Box and the Host stub in one list, output since last read, kill, the finished Wake-up with the spill log, lost on disconnect (ob-rc3b, ob-sja4, ob-ku5j, ob-cgn1, ob-6kkn); mode and roots passed to the stub per grant, the Robot's directory as default cwd, a denial result, escalate creating a tool-call Ask whose approval runs once in full, fail closed on sandbox none, full running on sandbox none (ob-wh59, ob-397e, ob-vnld, ob-ifak, ob-n72n, ob-he20); shell and sandbox in the Hosts line (ob-vyyg, ob-gjp9); requiresHosts: recurring fails without a Turn and notifies once, scheduled parks and runs on the online event or fails at the deadline, owner messages wake (ob-5nvd, ob-qgpy, ob-e271, ob-amlz); presign endpoint scoped to the Robot's prefix, refused outside it and after the Box stopped; copy workspace↔host through the stub's presigned flow, host↔host staged and cleaned, Trajectory shows size (ob-qshq, ob-qr7v, ob-7hp3, ob-o6aw); ws commands against the Box stub (ob-fgyk, ob-63nt); backend union, migration of Robots and the Home default, old usage rows kept (ob-ltsr, ob-l24v, ob-0c3o); Mr. Robot's facets at ask on pairing (ob-2k5x); the notify frame for a Host Ask (ob-6jr5); platform skills visible by grant and the ladder text (ob-vw9d, ob-ivby, ob-f7q7); old events render (ob-j9nx).
- **Component tests** (prior art: v1.12 to v1.15): the Host facet mode and roots editor, the requiresHosts switch, the backend picker with two choices, the Hosts page sandbox state (ob-wh59, ob-5nvd, ob-myzd, ob-n72n).
- **By hand, three platforms**: pairing and a confined run on Linux (bwrap or Landlock), macOS (Seatbelt) and Windows (ACL, pwsh); a denied write and its escalate Ask; a Host job surviving the Robot's Turn and waking it; the native Ask notification (ob-wsf7, ob-szqb, ob-e68m, ob-6jr5).
- **Staging**: a 2 GB file copied Host → Workspace → Box, ws get inside a run, docs/box.md listing the image's tools with versions, a Box boot time recorded (ob-d3rt, ob-fgyk, ob-asp3, ob-m73k).
- **Alchemy plan test**: the Chrome container and its credentials gone, the R2 API token present (ob-ltsr, ob-qshq).

## Out of Scope

A browser in the Box (returns only on evidence of a block that neither backend handles); residential proxies; a desktop on the Box or on a Host; a read-confined sandbox mode (reads stay as wide as the OS user); separate OS accounts managed by the app (the shared-Host instruction is documentation); FUSE or any mount of R2 in the Box; a persistent terminal session on a Host (each run is fresh, as in DSH); code signing and auto-update for the Windows build; cloud coding agents; a Robot assigned to one Host (the setting is about availability, not place).

## Further Notes

Decisions from the grill session 2026-10-20 (Hosts and the Box, four rounds), with what was weighed.

- **Explicit places.** The agent proposed an optional on with two defaults (files → Workspace, run → Box); the owner rejected any default: the tokens are few and a model that must name the place cannot act on a wrong assumption, least of all in copy.
- **Not assigned, but waiting.** A Robot "assigned to a Host" was replaced by a setting about availability, because a Robot may use several Hosts (a copier between two of them) and what the owner wants is that nothing runs needlessly.
- **DSH on the Host.** The owner asked why the mechanism should differ from the Box at all; it does not: DSH's bash, pwsh, sandbox-local and jobs-local run in the Host app, and only the place is Mr. Robot's. Landlock from another project was considered and dropped: DSH already has bwrap, Landlock, Seatbelt and the Windows ACL runner.
- **Reads stay wide.** The owner kept the v1.2 decision; a shared NAS is served by installing the app under its own OS account, documented, not coded.
- **Two browsers from evidence.** The four-site runs of v1.1 (tickets 02 and 03) justified Browser Rendering and the Host browser and nothing else; Container Chrome via VPN had been the Home default as a hedge that never paid. The agent proposed Chrome inside the Box as the one body; the owner cut further, and the one body is a Box without a browser.
- **Files bypass everything.** The owner insisted that a big file from a Host goes to R2 directly; presigned URLs make the Host app and R2 the only two parties, and ws gives a Box script the same path. rclone was rejected because R2 tokens are bucket-wide and would let one Box read every Workspace.
- **The image.** Chosen by what an agent reaches for before thinking; pandoc, tesseract and LibreOffice left out by size and because setup.sh exists; the tool list is generated so the docs never lie.
- Seams: the edge API in workerd with the scripted model and the stub backends for every behaviour; component tests for the new controls; manual runs on three platforms and one staging run. No new seam.
