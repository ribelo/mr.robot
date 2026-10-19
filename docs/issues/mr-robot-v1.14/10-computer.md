# 10: A computer: Sandbox backend, grant, tools, sync, idle stop, cost

**What to build:** A Robot with the computer grant has a Cloudflare Sandbox container on the python image (one per Robot, a Dockerfile in the repository extending docker.io/cloudflare/sandbox:<sdk version>-python, built and pushed by the deploy through Alchemy) (ao-8x0c, ao-h1wn). Tools computer_run (command, output, exit code, time limit; stdout through the spill policy), computer_read and computer_write under /workspace (ao-xokp). At boot the Workspace's computer/ folder is copied in and computer/setup.sh runs when present; on Turn end and before stop, changed files under /workspace/computer are written back (ao-7ptt, ao-ia4z). The computer stops ten minutes after the last command and boots on the next (ao-joux). Running milliseconds are priced at Cloudflare's container rates into a computer source counted toward the spend limit (ao-54j2). Commands pass Auto review when it is on (ao-7lcd). A ComputerBackend seam (start, run, read, write, stop, state) with the Sandbox adapter and a stub, like the browser seam (ao-33fs). The Robot panel shows the computer's state with Stop (ao-9q18). Subagents use the Robot's computer when granted (ao-ab01).

**Blocked by:** 02, 05

**Status:** done

- [x] Alchemy plan test: the Sandbox container and binding appear in the plan; the Dockerfile is in the repository (ao-h1wn)
- [x] Grant item tool:computer; the three tools exist only when granted (ao-8x0c)
- [x] Workerd test against the stub backend: boot copies computer/ in and runs setup.sh; computer_run returns output and exit code; a long output spills; computer_write then sync back on Turn end lands in the Workspace (ao-xokp, ao-7ptt, ao-ia4z)
- [x] Workerd test: the idle alarm stops the computer ten minutes after the last command; the next command boots it (ao-joux)
- [x] Workerd test: computer_usage rows and the spend limit counting them (ao-54j2)
- [x] Workerd test: with Auto review on, computer_run is reviewed (ao-7lcd)
- [x] Component test: the Computer section in the panel with state and Stop (ao-9q18)
- [ ] Integration by hand on staging: a Robot runs a Pandas script and reads the result; recorded in the ticket's closing note (ao-8x0c)

**Closing note:** Decision, to reverse if wanted: `@cloudflare/sandbox` 1.x has no Sandbox class and no python image (its images hold only a shim), and 0.x ends its fixes on 2026-12-31. So the computer is a Cloudflare Container class of our own (`ComputerContainer`, apps/worker/src/computer/container.ts, on @cloudflare/containers like the Chrome container) that runs commands with the Container exec API, on infra/computer/Dockerfile: `FROM docker.io/cloudflare/sandbox:0.12.10-python` (Python 3.11, NumPy, Pandas, matplotlib, Node, Bun, git) with its control server replaced by an idle process. No new dependency. Alchemy builds and pushes the image at deploy (Docker). Sync back writes changed and new files only; a file deleted on the computer stays in the Workspace. Files over 20 MB are not synced. The time is billed at the Chrome container's rate (`BACKENDS.container.hourlyUsd`) at each Turn end and at stop. A new container class needs two deploys the first time (the namespace, then the attachment), as Chrome did.

Not done: the staging run by hand (a Robot runs a Pandas script). It needs a deploy with Docker; it was not run in this session. `ctx.container.exec` under Alchemy's default scheduling policy is not yet tried on a live account; that run checks it.
