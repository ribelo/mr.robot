# 06: Files without limit: presigned R2 copies and ws in the Box

**What to build:** copy between a Host and the Workspace goes between the Host app and R2 through presigned URLs the Worker mints for one key in the Robot's prefix, multipart in 64 MB parts, no size cap (ob-d3rt, ob-qshq). A Bun program ws in the Box (ls, get, put, rm) uses the same presign endpoint with a token written into the container at boot, scoped to the Robot's prefix and dead with the Box; copy workspace↔box runs through it (ob-fgyk, ob-63nt, ob-o6aw). Host↔host and box↔host stage under workspace tmp/ and clean up (ob-qr7v). Tool results and the Trajectory show size and duration (ob-7hp3). The Alchemy stack creates the R2 API token and holds it as a Worker secret.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test: presign scoped to the prefix, refused outside it and after the Box stopped; copy workspace↔host through the stub's presigned flow; host↔host staged and cleaned; size in the Trajectory (ob-qshq, ob-qr7v, ob-7hp3, ob-o6aw)
- [ ] Workerd test: ws commands against the Box stub (ob-fgyk, ob-63nt)
- [ ] Staging: a 2 GB file Host → Workspace → Box and ws get inside a run (ob-d3rt, ob-fgyk)
- [ ] Alchemy plan test: the R2 API token resource (ob-qshq)
