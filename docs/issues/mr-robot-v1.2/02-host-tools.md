# 02: host_read, host_write, host_run

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-n34u, hs-5ktw, hs-i785, hs-bfr8, hs-869j, hs-44cm

**What to build:** Robots with the files or shell grant on a host read and write its files and run shell commands as the signed-in user with their environment; output and errors come back typed; offline hosts fail with a typed error the robot reports. Calls appear in the trajectory with host name, command and output. Mr. Robot needs no grant.

**Blocked by:** 01 Host app, pairing, registry, channel

**Status:** ready-for-agent

- [ ] Live: a robot runs `leash --help` on the owner's host through host_run and shows the output
- [ ] Write then read round-trips a file; a path the user cannot access fails with the OS error
- [ ] Offline host: the call fails with 'host offline', the robot reports it, a routine hit notifies the owner
- [ ] Trajectory shows the host call records
