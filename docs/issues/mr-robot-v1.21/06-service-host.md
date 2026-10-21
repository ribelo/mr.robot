# 06: The service Host

**What to build:** One codebase, two entries: host-service.cjs without Electron (pair from the terminal, run as a service, no display), the Electron main importing the same modules; heartbeat without graphical and Chrome; a Nix module, a systemd unit and a launchd plist under infra/host/ (cw-8b27, cw-x1x8, cw-shtf, cw-k0vx).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] By hand: pairing and a run on a display-less VM through the Nix module
- [ ] The desktop entry unchanged in behaviour; the build produces both bundles
