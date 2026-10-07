# 01: Capabilities as Cordis plugins mounted by grant

**Parent:** mr-robot-v1.3 (../mr-robot-v1.3.md) — stories pl-vfxd, pl-rsoy, pl-d1oz, pl-kdmm

**What to build:** Every capability becomes a Cordis plugin with a config schema; a robot's composition mounts exactly the plugins its grants allow; behaviour is unchanged and the existing Robot DO tests pass with only wiring changes. Plugins free of Workers bindings expose a build loadable in the desktop DeepSeek Harness.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] robot.ts no longer assembles tool lists by hand; each capability is a plugin under packages/ or apps/worker/src/plugins
- [ ] Robot DO test: an ungranted capability's plugin is not mounted (no tools, no prompt section)
- [ ] All v1–v1.2 Robot DO tests pass
- [ ] One pure-TS plugin (Exa or grant proposals) loads in a desktop DSH profile as a smoke check
