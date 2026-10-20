# 03: Jobs on a Host through DSH jobs-local

**What to build:** run on a Host waits up to its limit and goes on as a job, or starts as a job with run_in_background, through DSH jobs-local in the Host app (ob-sja4). A finished job reaches the Robot DO's registry over a job frame, writes its log under spill/jobs/ and wakes the Robot as a follow-up with id, exit code and tail (ob-ku5j). job_output with wait streams since the last read (ob-6kkn). A disconnect or restart of the app marks the Host's running jobs lost and wakes the Robot as failed (ob-cgn1).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Workerd test with the Host stub: promotion on the limit; background at once; job_output since last read and with wait; kill; the finished Wake-up and the spill log; lost on disconnect (ob-sja4, ob-ku5j, ob-6kkn, ob-cgn1)
- [ ] By hand: a Host job survives the Robot's Turn and wakes it (ob-sja4)
