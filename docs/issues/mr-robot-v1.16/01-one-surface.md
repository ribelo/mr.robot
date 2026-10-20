# 01: One execution surface: run, file tools, copy and jobs with a mandatory on

**What to build:** The tools run, read, write, edit, glob, grep, delete_file, copy, job_list, job_output and job_kill replace box_*, host_* and the Workspace-only file tools; every call names its place with a mandatory on (workspace, box or a Host name), copy names both ends, and a call to a place the Robot holds no grant on, or to an unknown Host, is refused with the grant named (ob-5fjs, ob-ff4g, ob-9afl, ob-rc3b, ob-dyg4, ob-qnf7). Member files, docs and platform skills are reachable only on workspace (ob-pfcu). Old events still render (ob-j9nx). In this ticket the Host side keeps today's RPCs (a fresh login shell, text and base64 files); copy covers workspace↔workspace, workspace↔box through the Box backend and workspace↔host through the existing chunk RPCs; the unlimited paths come in 06.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Workerd test: each tool with each on; refused without the grant; refused for an unknown Host; owned paths only on workspace (ob-5fjs, ob-ff4g, ob-9afl, ob-dyg4, ob-qnf7, ob-pfcu)
- [x] Workerd test: Box jobs and Host-stub jobs in one job_list with the place; old box_*/host_* events render (ob-rc3b, ob-j9nx)
- [x] The old tools, their plugins and their docs mentions are gone; the grants and their UI are unchanged (the product docs in apps/worker/src/docs follow; GLOSSARY.md still names Host tools and the Job of the Box, which ticket 10 rewrites)
