# 07: Box jobs

**What to build:** box_run waits in the foreground up to its limit and then lets the command go on as a job, returning the job id and the output so far; run_in_background returns a job id at once (gb-lnph, gb-lco0). job_list, job_output (since the last read, or with a wait) and job_kill manage jobs (gb-p4r5). A finished job wakes the Robot as a follow-up with its id, exit code and the last 40 lines; the whole log goes to spill/jobs/ in the Workspace (gb-pptr). The Box stays up while a job runs and the idle stop counts from the last job end (gb-5bfw). The Turn may end with running jobs; a Box lost under a running job marks it lost and wakes the Robot as failed (gb-aafm). The Box section lists running jobs with Stop (gb-66kh). docs/box.md explains jobs (gb-g39d).

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Workerd test with the Box stub: a command past the limit is promoted with its output so far; run_in_background returns at once (gb-lnph, gb-lco0)
- [ ] Workerd test: job_output returns output since the last read and waits up to the timeout; job_kill ends a job (gb-p4r5)
- [ ] Workerd test: a finished job queues the follow-up Wake-up with exit code and tail, and the log exists under spill/jobs/ (gb-pptr)
- [ ] Workerd test: the idle stop is not set while a job runs and starts from the job's end; the Turn ends while the job runs (gb-5bfw, gb-aafm)
- [ ] Workerd test: a stub restart with a job gone marks it lost and wakes the Robot as failed (gb-aafm)
- [ ] Component test: the Box section with running jobs and Stop (gb-66kh)
- [ ] Staging, by hand: a two-minute script, the Turn ends, the finished job wakes the Robot, the Robot says the result with the log attached (gb-pptr, gb-5bfw, gb-aafm)
- [ ] docs/box.md describes jobs the DSH way (gb-g39d)
