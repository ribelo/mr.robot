# 09: The service Host

**What to build:** Two bundles from one source; pair from the terminal; the display check; infra/host/ with the Nix module, the systemd unit (graceful stop with a notice) and the launchd plist (cw-bi6y, cw-y7wy, cw-dr33, cw-ixto).

**Blocked by:** 01

**Status:** done (one check by hand)

- [x] Host Node tests: the display check per platform; the service entry starts without Electron
- [ ] By hand: pairing and a run on a display-less VM through the Nix module (see below)

## Closing note

Tests:
- apps/host/test/service.test.ts:
  - The display check on Linux (DISPLAY or WAYLAND_DISPLAY), macOS (launchd's Aqua session against Background and System) and Windows (an interactive SESSIONNAME against none).
  - The arguments and the config directory per platform.
  - It builds the app with build.mjs, as the package does, and runs dist/service.cjs with plain Node, without DISPLAY, against a WebSocket Worker of the test's own. The heartbeat reports graphical false, chrome null and shell bash, and a ListDirectory call is served. SIGTERM makes the app close with HOST_STOPPING (4003) and exit 0. The bundle holds no `require("electron")`.
- apps/worker/test/host-jobs.test.ts: a Host that closes with HOST_STOPPING wakes the Robot at once: "[Desk job … failed: the Mr. Robot app on Desk was stopped while it ran]", not after the five-minute wait.
- Checked by running: `nix-build apps/host/package.nix` builds; `mr-robot-host --help` and an unpaired `mr-robot-host --service` (exit 2 with the pairing sentence) run from the package without a display. The NixOS module evaluates (ExecStart `…/bin/mr-robot-host --service`, TimeoutStopSec 30, the user's home).

Decisions:
- One source, two entries: src/service.ts (the service) and src/main.ts (Electron), over the same modules: connection, shell, files, Workspaces, LSP, config. build.mjs bundles service.cjs with electron not external, so a service bundle that reached for Electron would fail to build.
- `mr-robot-host pair <server> [--name N]` prints the approval link and the code, waits, and writes host.json. `mr-robot-host --service` serves until SIGTERM or SIGINT. Both use the desktop app's config directory (~/.config/mr-robot-host on Linux, ~/Library/Application Support/mr-robot-host on macOS, %APPDATA%\mr-robot-host on Windows; MR_ROBOT_HOST_CONFIG overrides it), so one pairing serves both. In the Nix package, `mr-robot-host` is a small script: --service, pair and --help run the service under nodejs_24, anything else the Electron app.
- Display check (cw-ixto): hasGraphicalSession now asks for a display on every platform, not for the OS (macOS and Windows used to count as graphical always). A service also reports chrome null and graphical false whatever the display, so it never offers the browser facet.
- Stop notice: on SIGTERM the service closes its link with HOST_STOPPING (4003), then disposes the shell (its jobs and language servers go). The Worker, on that code, tells the Robots at once that their jobs on that Host ended. Any other close still waits up to five minutes for the app to come back.
- infra/host/: module.nix (services.mr-robot-host: a system user by default with its home in /var/lib/mr-robot-host, the package, git and bash on PATH, unprivileged user namespaces for bubblewrap, Restart=always, KillSignal=SIGTERM, KillMode=mixed, TimeoutStopSec=30; the flake exports it as nixosModules.host), mr-robot-host.service for another Linux, and ai.mr-robot.host.plist for macOS (node with service.cjs, ExitTimeOut 30).
- Not done: a Windows service. The spec names systemd and launchd; Windows keeps the desktop app.

By hand (a display-less NixOS VM): import nixosModules.host, set `services.mr-robot-host.enable = true`, rebuild, run `sudo -u mr-robot-host mr-robot-host pair <server>` and approve the link. Then `systemctl start mr-robot-host`. The Hosts page should show the VM online with no browser, and a Robot with its files and shell facets should run `uname -a` there. `systemctl stop mr-robot-host` while a Robot's job runs should wake that Robot at once with "was stopped while it ran".

Review findings: #20, #21 (no user manager; jobs end with the app) are said by the stop notice and the docs. #45 (the graphical check asked for the OS) fixed. #46: the service's git credentials are its user's, as for any Host (ticket 01's docs).
