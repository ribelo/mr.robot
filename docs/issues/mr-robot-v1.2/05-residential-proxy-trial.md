# 05: Container Chrome via proxy and the Allegro trial

**Parent:** mr-robot-v1.2 (../mr-robot-v1.2.md) — stories hs-naw6, hs-800c, hs-c4lx

**What to build:** A 'Container Chrome via proxy' backend takes a proxy address with credentials stored as a Home credential and starts the container's Chrome through it; proxy bandwidth and minutes appear in usage. One Allegro run through a Polish residential proxy the owner buys pay-as-you-go is recorded here with its result.

**Blocked by:** None (can start immediately)

**Status:** in-progress

- [ ] Backend available once a proxy credential is stored; IP echo shows the proxy's address
- [ ] Allegro run recorded (pass / blocked / challenged) with the provider named
- [ ] Usage shows the run's cost

## Built (2026-10-07)

- **Backend:** "Container Chrome via proxy" (container-proxy) uses the same Container Chrome image, now with gost. Mr. Robot hands the stored proxy address to the container as PROXY_URL; gost forwards a local SOCKS5 port to that upstream proxy with its credentials (Chrome cannot send proxy credentials itself). Image krb9q3ahjn6b.
- **Admin:** Admin → Proxy stores the address sealed and write-only, as http://user:password@host:port or socks5://….
- **Usage:** container time is counted like the other containers (about $0.108 per hour). The provider bills proxy traffic separately.
- **Checks:**
  - Locally, the gost chain passed traffic through an authenticated proxy and refused wrong credentials.
  - Live after the image change, plain Container Chrome still leaves from Cloudflare (Stockholm) and the VPN variant from Proton in Warsaw.
  - Without an address, the proxy backend answers "needs a proxy address (Admin → Proxy)".
- **Waiting:** the owner's residential proxy address, for the IP echo and the Allegro run.
