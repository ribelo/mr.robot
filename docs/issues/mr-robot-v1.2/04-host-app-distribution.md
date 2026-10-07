# 04: Nix package and macOS .dmg

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-7pcx, hs-5slg

**What to build:** The app is installable: a Nix flake output for NixOS (with the systemd user autostart) and a signed-or-unsigned .dmg for macOS with login-item autostart. Installed on the owner's machine and on the partner's Mac.

**Blocked by:** 01 Host app, pairing, registry, channel

**Status:** in-progress

- [ ] nix build .#host produces the app; installed and paired on NixOS
- [ ] .dmg installed and paired on the Mac
- [ ] Both start at login

## Linux (NixOS), 2026-10-07

- **Package:** apps/host/package.nix builds the app from the pnpm workspace (fetchPnpmDeps, fetcherVersion 4) and wraps nixpkgs' Electron 43 as `mr-robot-host`, with a desktop entry. flake.nix exposes it as `.#host` (and `.#default`).
- **Build and run:** `nix build .#host` succeeds. The packaged app runs on heisenbug against the live server and is the instance connected now (online, version 0.1.0). Its "Start when I log in" writes ~/.config/autostart/mr-robot-host.desktop running `mr-robot-host --hidden` from the user's profile.
- **Not done:** adding it to the owner's NixOS configuration, so the command is in his profile and the autostart entry resolves. That is his system configuration. Until then, the autostart entry written by the running instance points at its store path.

## macOS

Not started: building and checking a .dmg needs a Mac.
