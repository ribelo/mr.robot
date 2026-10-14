# 06: WireGuard summary

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-t4wi, ux-a3ec

**What to build:** After the admin saves a Proton WireGuard configuration, the card shows the endpoint (host:port), the server name from the configuration's comment lines and the country when the name carries it ("PL" from "PL#45" or "pl-free-12"). The private key and preshared key stay sealed and never reach the view.

**Blocked by:** 04 (Workers AI switch)

**Status:** done

- [x] Summary parsed from a recorded Proton configuration (fixture) and returned in the Admin view; no secret in the view (workerd test)
- [x] Card shows the summary when configured
