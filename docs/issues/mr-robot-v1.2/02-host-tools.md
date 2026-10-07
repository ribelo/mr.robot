# 02: host_read, host_write, host_run

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-n34u, hs-5ktw, hs-i785, hs-bfr8, hs-869j, hs-44cm

**What to build:** Robots with the files or shell grant on a host read and write its files and run shell commands as the signed-in user with their environment; output and errors come back typed; offline hosts fail with a typed error the robot reports. Calls appear in the trajectory with host name, command and output. Mr. Robot needs no grant.

**Blocked by:** 01 Host app, pairing, registry, channel

**Status:** in-progress

- [x] Live: a robot runs `leash --help` on the owner's host through host_run and shows the output
- [x] Write then read round-trips a file; a path the user cannot access fails with the OS error
- [ ] Offline host: the call fails with 'host offline', the robot reports it, a routine hit notifies the owner
- [x] Trajectory shows the host call records

## Verified

- Robot DO tests (test/hosts.test.ts, fake app over the real protocol): host_read and host_write with a files grant; host_run is not offered and is refused at the Member DO without the shell grant; with the shell grant it runs; an OS error comes back as "permission denied (EACCES)"; the trajectory records the command; an offline host returns "… is offline … do not switch to a cloud browser".
- Live 2026-10-07 16:07 on heisenbug: Mr. Robot ran host_run "uname -sr && whoami && command -v leash" (Linux 7.2.9, ribelo, /etc/profiles/per-user/ribelo/bin/leash), wrote /tmp/mr-robot-host-test.txt with host_write (20 bytes, checked on disk) and read it back with host_read.
- Live 16:09: host_run "leash --help" returned "NAME / leash - A local managed Chrome for agents."; host_read /root/.bash_history failed with "EACCES: permission denied, stat '/root/.bash_history' (EACCES)".
- Live 16:10 with the app closed: host_run "date" came back "heisenbug is offline (last seen 14:09 UTC)" and Mr. Robot told the owner the computer needs the app running.
- Not yet verified: a Routine meeting an offline host notifying the owner (the code path is in Robot.hostCall; no test or live run).
