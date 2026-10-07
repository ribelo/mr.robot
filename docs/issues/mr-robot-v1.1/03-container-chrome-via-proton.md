# 03: Container Chrome via Proton VPN

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-j5ml, rb-rb1x, rb-690z, rb-ybt4

**What to build:** A variant of the container backend sends Chrome's traffic through a userspace WireGuard client (wireproxy, local SOCKS5) connected to the owner's Proton VPN on a Polish server; the WireGuard configuration is stored once as a Home credential. The same four-site run is repeated and recorded; the Home default backend is set from the recorded results of tickets 02 and 03.

**Blocked by:** 02 Chrome in Cloudflare Containers backend

**Status:** ready-for-agent

- [ ] WireGuard configuration stored as a Home credential, never shown in logs
- [ ] Pages report a Polish Proton address (an IP-echo page in the run)
- [ ] Four-site results recorded
- [ ] Home default backend set and the reason written in this ticket
