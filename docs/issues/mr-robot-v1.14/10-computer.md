# 10: A computer: Sandbox backend, grant, tools, sync, idle stop, cost

**What to build:** A Robot with the computer grant has a Cloudflare Sandbox container on the python image (one per Robot, a Dockerfile in the repository extending docker.io/cloudflare/sandbox:<sdk version>-python, built and pushed by the deploy through Alchemy) (ao-8x0c, ao-h1wn). Tools computer_run (command, output, exit code, time limit; stdout through the spill policy), computer_read and computer_write under /workspace (ao-xokp). At boot the Workspace's computer/ folder is copied in and computer/setup.sh runs when present; on Turn end and before stop, changed files under /workspace/computer are written back (ao-7ptt, ao-ia4z). The computer stops ten minutes after the last command and boots on the next (ao-joux). Running milliseconds are priced at Cloudflare's container rates into a computer source counted toward the spend limit (ao-54j2). Commands pass Auto review when it is on (ao-7lcd). A ComputerBackend seam (start, run, read, write, stop, state) with the Sandbox adapter and a stub, like the browser seam (ao-33fs). The Robot panel shows the computer's state with Stop (ao-9q18). Subagents use the Robot's computer when granted (ao-ab01).

**Blocked by:** 02, 05

**Status:** ready-for-agent

- [ ] Alchemy plan test: the Sandbox container and binding appear in the plan; the Dockerfile is in the repository (ao-h1wn)
- [ ] Grant item tool:computer; the three tools exist only when granted (ao-8x0c)
- [ ] Workerd test against the stub backend: boot copies computer/ in and runs setup.sh; computer_run returns output and exit code; a long output spills; computer_write then sync back on Turn end lands in the Workspace (ao-xokp, ao-7ptt, ao-ia4z)
- [ ] Workerd test: the idle alarm stops the computer ten minutes after the last command; the next command boots it (ao-joux)
- [ ] Workerd test: computer_usage rows and the spend limit counting them (ao-54j2)
- [ ] Workerd test: with Auto review on, computer_run is reviewed (ao-7lcd)
- [ ] Component test: the Computer section in the panel with state and Stop (ao-9q18)
- [ ] Integration by hand on staging: a Robot runs a Pandas script and reads the result; recorded in the ticket's closing note (ao-8x0c)
