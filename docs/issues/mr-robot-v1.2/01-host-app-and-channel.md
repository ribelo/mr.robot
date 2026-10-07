# 01: Host app, pairing, registry, channel

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-vtg3, hs-hend, hs-5slg, hs-ebba, hs-ro43, hs-qwlq, hs-0eka, hs-rwxw, hs-xax9, hs-ntbd, hs-7dlt, hs-w8vi, hs-0cr2

**What to build:** The Mr. Robot desktop app (Electron, Linux and macOS, run from source in this ticket) signs the Member in with Cloudflare Access, takes a host name, and connects outbound over one WebSocket to the edge; the Member DO registers the host (online, last seen, platform), shows it in the profile, allows sharing with the Home and unpairing. Effect RPC schemas shared by app and Worker; per-robot per-host grants (browser, files, shell) exist and are enforced at the Member DO; Mr. Robot is exempt. The app requires the server address at first start (no built-in default) and can change it and re-pair; while connected it heartbeats version, platform and capabilities (graphical session, Chrome found), the Member DO marks the host offline when heartbeats stop, and the admin view lists every host of the Home with owner, sharing, online/offline, last seen, version and the robots using it. A tray icon shows status; the app starts at login.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Pairing from the app shows the host online in the profile within seconds; closing the app shows it offline
- [ ] Host shared with the Home is visible to the other Member; private is not
- [ ] Unpair from the profile disconnects the app and revokes its token
- [ ] Robot DO test with a fake host: a call without the matching grant is refused at the Member DO
- [ ] Tray status and autostart verified on Linux and macOS
- [ ] First start without a server address cannot proceed; changing the address re-pairs
- [ ] Admin view lists the host with last seen and capabilities; stopping heartbeats marks it offline
