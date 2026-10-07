---
title: "Mr. Robot v1.2 — hosts: the owner's computers as a place robots can act, and Allegro through a home browser"
status: ready-for-agent
story-prefix: hs
parent: mr-robot-v1.1.md
---

# Mr. Robot v1.2

## Problem Statement

Allegro is non-negotiable for the owner and no cloud browser reaches it: Browser Run, Chrome in a Cloudflare Container and the same Chrome through his Proton VPN in Warsaw are all hard-blocked by DataDome, which rejects data-centre addresses (results recorded in v1.1 tickets 02 and 03). The same listing opened from the owner's home Chrome shows 9,619 offers: a real browser on a residential connection passes. Grok Bot solves this with its desktop app, which gives the bot tools on the owner's computer while it is on. The owner's partner uses a Mac and must be able to use the same thing without Leash. Several old laptops could serve as always-on hosts so that Allegro works on holiday.

## Solution

A Mr. Robot desktop app (Electron, Linux and macOS) turns any computer the Member signs in on into a **Host**: it connects outbound to Mr. Robot, appears in the Member's profile as online or offline, can be shared with the Home, and offers robots three things on grant: files (host_read, host_write), a shell (host_run) and a **Host browser** — Chrome installed on that computer, driven over CDP through the app, behind the same browser seam as the cloud backends, with live view and takeover through the app. A robot assigned to a host browser reports an offline host instead of falling back to a blocked cloud browser. In parallel, one cheap experiment: Container Chrome through a residential proxy address, to learn whether the cloud can reach Allegro at all.

## User Stories

### Host application

1. As a person, I want a Mr. Robot desktop app for Linux and macOS, so that my computer, my partner's Mac or an old laptop can serve my robots ^hs-vtg3
2. As a person, I want to sign in to the app with the same one-time e-mail code (Cloudflare Access) and give the host a name, so that pairing is one step ^hs-hend
3. As a person, I want the app to start at login and sit in the tray with its status, so that the host is simply there ^hs-5slg
4. As a person, I want the app to connect outbound to Mr. Robot without opening ports or running a tunnel daemon, so that it works behind any home router ^hs-ebba
5. As a person, I want my hosts listed in my profile with online/offline and last seen, so that I know what the robots can reach ^hs-ro43
6. As a person, I want several hosts at once, so that my laptop and the always-on box both serve ^hs-qwlq
7. As a person, I want a host to be private to me or shared with the Home, so that the box in the corner serves my partner's robots too ^hs-0eka
8. As a person, I want to unpair a host from the app or from my profile, so that a lost laptop stops serving ^hs-rwxw
9. As an operator, I want the app and Mr. Robot to speak typed Effect RPC over the connection, so that every host call has a schema on both ends ^hs-xax9
10. As a person, I want a Nix package for NixOS and a .dmg for macOS, so that installing is one step on each ^hs-7pcx

### Host tools

11. As a robot, I want host_read, host_write and host_run on a granted host, so that I can read files, write files and run shell commands on that computer ^hs-n34u
12. As a person, I want host tools granted per robot per host, separately for browser, files and shell, so that one robot can use the box's browser without touching its files ^hs-5ktw
13. As a person, I want host_run to run as my user with my shell and environment, so that it can use everything I can (Leash included) ^hs-i785
14. As a robot, I want host tool calls to fail clearly when the host is offline, so that I tell the owner instead of hanging ^hs-bfr8
15. As a person, I want host calls visible in the trajectory with host name, command and output, so that I can see what was run where ^hs-869j
16. As a person, I want Mr. Robot to use every host I can reach without grants, so that the chief of staff can act on my computer ^hs-44cm

### Host browser

17. As a robot, I want a browser backend 'Host browser: <name>' that drives Chrome installed on that host, so that sites that block cloud addresses see a real browser on a home connection ^hs-mqwd
18. As a robot, I want the same browser tools on a host browser as in the cloud, so that nothing changes in how I work ^hs-3wqx
19. As a person, I want the host Chrome to use its own 'Mr. Robot' profile with a visible window, so that it neither touches my own browsing nor looks headless ^hs-zmbc
20. As a robot, I want cookies and logins on the host browser kept in its profile between tasks, so that I stay logged in ^hs-43aj
21. As a person, I want live view and takeover of a host browser from my phone through the app, so that logins and 2FA work there too ^hs-1fp6
22. As a person, I want a robot set to a host browser to report and notify me when the host is offline instead of silently using a cloud browser, so that an Allegro task never ends on a block page ^hs-nwcl
23. As a person, I want an Allegro run on the host browser (search, open an offer, add to cart, stop before payment) recorded with its result, so that the decision rests on evidence ^hs-8teq
24. As a person, I want host browser minutes shown in usage like cloud minutes, so that I see where robots browse ^hs-fnpy

### Residential address trial

25. As a Home admin, I want a 'Container Chrome via proxy' backend that takes any proxy address (HTTP or SOCKS, with credentials) stored as a Home credential, so that a pay-as-you-go residential provider can be tried without new code ^hs-naw6
26. As a person, I want one recorded Allegro run through a Polish residential proxy, so that we know whether the cloud can reach Allegro at all ^hs-800c
27. As a person, I want proxy bandwidth and minutes in usage, so that a residential run shows its cost ^hs-c4lx

### Added 2026-10-07 15:25 (micro-SaaS readiness)

28. As a person, I want the app to require the Mr. Robot server address at first start (no built-in default), so that one app build serves any deployment ^hs-ntbd
29. As an operator, I want each host to send a heartbeat with its version, platform and capabilities (graphical session, Chrome found) while connected, so that the server knows what each host can do and when it was last alive ^hs-7dlt
30. As a Home admin, I want the admin view to list every host in the Home with owner, sharing, online/offline, last seen, version and the robots currently using it, so that I see what is connected ^hs-w8vi
31. As a person, I want to change the server address in the app and re-pair, so that a host can move to another deployment ^hs-0cr2

### Added 2026-10-07 17:50 (the app is the product, not a pairing form)

32. As a person, I want the desktop app to show the same Mr. Robot interface as the web app (robot list, conversations, panel, settings, admin), so that the app on my computer is Mr. Robot, as Grok Bot's desktop app is Grok Bot ^hs-pyn0
33. As a person, I want the host pairing (server address, computer name, autostart, status, unpair) to live as one page inside that interface ("This computer"), so that pairing is a setting, not the whole app ^hs-p0jr
34. As a person, I want the app signed in with the same account as the web, so that the host and my conversations belong to one person without a second login ^hs-upeq

## Implementation Decisions

### Vocabulary
GLOSSARY.md applies. New words: **Host** (a computer running the Mr. Robot app, paired to a Member), **Host browser** (the browser backend served by a Host), **Host tools** (host_read, host_write, host_run).

### Host application
- Electron app in this repository (apps/host), Linux and macOS, Windows not built. Signs in with Cloudflare Access (system browser opens, one-time code), then holds a host token minted by the edge for that Member and host; the token is revoked on unpair.
- The app keeps one outbound WebSocket to the edge Worker; the edge routes it to the Member DO, which owns the host registry (name, platform, online, last seen, sharing). No inbound ports, no tunnel daemon.
- Protocol: Effect RPC with schemas shared between app and Worker (one package), multiplexed over the socket: host tool calls, browser CDP transport, screencast frames, health. Every call carries the robot id and the grant it runs under; the Member DO checks the grant before forwarding.
- First start asks for the server address (the deployment URL); nothing is built in. The app keeps the address and the host token; both can be changed in the app window (re-pair). While connected the app heartbeats (version, platform, capabilities: graphical session, Chrome found); the Member DO records last seen and marks the host offline when heartbeats stop. The admin view lists all hosts of the Home.
- Tray icon with status (connected, host name, robots currently using it); starts at login; a minimal window with sign-in, host name, unpair.
- Distribution: Nix package (flake output) for NixOS; .dmg via electron-builder for macOS; no auto-update this round.

### The app's interface
- The Electron window loads the web app from the configured server address (the same PWA bundle, same Access session; the app holds the session cookie), so every view is identical to the web. Pairing, status, autostart and unpair are one page in that interface, "This computer", reachable from the profile and the tray; the current bare pairing form is replaced by it. Tray stays.

### Hosts, sharing, grants
- A Host belongs to the Member who paired it; scope private or Home, like login entries. Any number of hosts per Member.
- Grants per robot per host, three independent: browser, files, shell. Mr. Robot is exempt. Grant proposals and approval as for other grants.
- Host tools run as the signed-in OS user with their login shell and environment; the whole filesystem that user can reach. No sandbox in this round (owner's decision; the grant is the gate).
- Offline host: host tools and the host browser fail with a typed "host offline" error; the robot reports it, the owner is notified when a routine hit it; no silent fallback to a cloud backend. A per-robot optional fallback backend may be set explicitly.

### Host browser
- The app launches the installed Chrome/Chromium (found per platform) with a dedicated "Mr. Robot" user-data directory, headed, remote debugging on localhost; the app proxies CDP over the RPC channel. The Robot DO sees it as one more backend behind the browser seam: same tools, same cookie/storage handling (kept in the host profile), same block detection, same usage counting (host minutes).
- Live view and takeover: the same screencast and input relay as cloud backends, carried through the app; the owner's phone talks to the Robot DO, never to the host directly.
- Requires a graphical session on the host; a host without one offers files and shell only (virtual display is a postponed ticket).
- Evidence: an Allegro run (search, open an offer, add to cart, stop before payment) on the owner's host, recorded in the ticket.

### Residential address trial
- Backend "Container Chrome via proxy": the container's Chrome starts with --proxy-server from a proxy address (http/https/socks5 with credentials) stored sealed as a Home credential; otherwise identical to Container Chrome. The owner buys any pay-as-you-go residential provider; nothing provider-specific is built. One recorded Allegro run; proxy bandwidth and minutes in usage.

## Testing Decisions

1. **Robot DO API** with a fake host attached to the Member DO (an in-process RPC peer): registry, sharing, grants, host tools, offline errors, trajectory records, Mr. Robot exemption, heartbeats and the admin host list (hs-7dlt, hs-w8vi, hs-ro43, hs-qwlq, hs-0eka, hs-rwxw, hs-xax9, hs-n34u, hs-5ktw, hs-i785, hs-bfr8, hs-869j, hs-44cm, hs-nwcl, hs-fnpy).
2. **Host app integration**, manual on the owner's machine and on a Mac: server address prompt and re-pair (hs-ntbd, hs-0cr2), pairing, tray, autostart, unpair, host browser with live view and takeover, the Allegro run (hs-vtg3, hs-hend, hs-5slg, hs-ebba, hs-7pcx, hs-mqwd, hs-3wqx, hs-zmbc, hs-43aj, hs-1fp6, hs-8teq).
3. **Browser backend integration** (staging, manual): proxy backend, Allegro run (hs-naw6, hs-800c, hs-c4lx).
Prior art: v1 Robot DO tests with stub browser; v1.1 four-site probe.

## Out of Scope (postponed tickets)
- Virtual display (Xvfb) so a monitor-less box can serve a host browser.
- Electron window with a local takeover view and screen of what robots do on this host.
- Windows build; auto-update.
- Host-side sandboxing of host_run/host_write.

## Further Notes
- Fact base (2026-10-07): Allegro blocked on all three cloud backends incl. Proton PL (DataDome hard block); Allegro listing opened fine from the owner's home Chrome via Leash the same afternoon.
- Cloud backends remain the Home default for everything that passes (eZUS, mBank, PKO, Scanye).
