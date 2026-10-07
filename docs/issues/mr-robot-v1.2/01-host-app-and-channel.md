# 01: Host app, pairing, registry, channel

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-vtg3, hs-hend, hs-5slg, hs-ebba, hs-ro43, hs-qwlq, hs-0eka, hs-rwxw, hs-xax9

**What to build:** The Mr. Robot desktop app (Electron, Linux and macOS, run from source in this ticket) signs the Member in with Cloudflare Access, takes a host name, and connects outbound over one WebSocket to the edge; the Member DO registers the host (online, last seen, platform), shows it in the profile, allows sharing with the Home and unpairing. Effect RPC schemas shared by app and Worker; per-robot per-host grants (browser, files, shell) exist and are enforced at the Member DO; Mr. Robot is exempt. A tray icon shows status; the app starts at login.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Pairing from the app shows the host online in the profile within seconds; closing the app shows it offline
- [ ] Host shared with the Home is visible to the other Member; private is not
- [ ] Unpair from the profile disconnects the app and revokes its token
- [ ] Robot DO test with a fake host: a call without the matching grant is refused at the Member DO
- [ ] Tray status and autostart verified on Linux and macOS
