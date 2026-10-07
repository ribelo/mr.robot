# 04: Nix package and macOS .dmg

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-7pcx, hs-5slg

**What to build:** The app is installable: a Nix flake output for NixOS (with the systemd user autostart) and a signed-or-unsigned .dmg for macOS with login-item autostart. Installed on the owner's machine and on the partner's Mac.

**Blocked by:** 01 Host app, pairing, registry, channel

**Status:** ready-for-agent

- [ ] nix build .#host produces the app; installed and paired on NixOS
- [ ] .dmg installed and paired on the Mac
- [ ] Both start at login
