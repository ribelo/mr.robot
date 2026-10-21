# 04: Robot definitions: export, YAML forms, library sync

**What to build:** A definition directory robots/<slug>/ in the library repository; Save as definition copies the Robot's files, runs one bounded owner-scrub step that writes README.md, and commits through the library sync; tasks.yaml and grants.yaml are produced by the platform in YAML 1.2 and parsed by schemas that refuse unknown keys; grants name connector kinds and login purposes only; definitions sync like skills; a definition is a snapshot (rm-hjpa, rm-gv6s, rm-tszp, rm-vob8, rm-gxp7, rm-77oh).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test: export through the library stub with the scrub step; YAML round-trip; unknown keys refused; 'no' stays a string; grants carry kinds and purposes only; sync lists definitions (rm-hjpa, rm-gv6s, rm-tszp, rm-vob8, rm-gxp7, rm-77oh)
