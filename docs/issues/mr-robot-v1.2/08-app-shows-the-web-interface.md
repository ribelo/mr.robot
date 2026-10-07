# 08: The desktop app shows the Mr. Robot interface

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-pyn0, hs-p0jr, hs-upeq

**What to build:** The desktop app's window is Mr. Robot: it loads the web interface from the configured server address with the same Access session as the browser, so robot list, conversations, panel, settings and admin are identical to the web. Pairing (server address, computer name, autostart, status, unpair) becomes one page inside that interface, "This computer", reachable from the profile and the tray, replacing the bare pairing form. Sign-in happens once (Access in the app window); the host token is minted from that session. Tray and autostart stay.

**Blocked by:** 01 Host app, pairing, registry, channel

**Status:** ready-for-agent

- [ ] Opening the app shows the robot list and a conversation exactly as the web does
- [ ] "This computer" page shows server address, name, autostart, status, unpair; pairing from it works
- [ ] One sign-in: no second login for the host; the host appears under the signed-in Member
- [ ] First start without a server address shows only the address prompt, then the interface
- [ ] Verified on the owner's NixOS machine
