# 02: Chrome in Cloudflare Containers backend

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-d59c, rb-wn96, rb-690z

**What to build:** A new backend runs headless Chrome in a Cloudflare Container, one per robot browser session, driven over CDP from the Robot DO, sleeping when the browser closes. It carries no Web Bot Auth signature. Live view, takeover and cookie persistence work on it. An integration run against Allegro (open a listing, add to cart, stop before payment), the eZUS login page, one bank login page and the owner's invoicing service records pass / blocked / challenged in this ticket.

**Blocked by:** 01 Browser backend seam and per-robot backend choice

**Status:** in-progress

- [x] Container image declared in Alchemy and deployed
- [x] A robot set to this backend opens, observes, acts and screenshots on the live deployment
- [x] Takeover and live view work on it
- [ ] Results for the four sites recorded below this list
- [x] Container sleeps after the browser closes; minutes appear in usage

## How it is built

- Image: infra/chrome/image.nix (Nix dockerTools, no Docker daemon): Chromium 154 headless with a normal Chrome user agent and `--disable-blink-features=AutomationControlled`, socat exposing DevTools on port 9222, wireproxy for ticket 03, fonts incl. CJK. infra/chrome/push.sh builds and pushes it to Cloudflare's registry; infra/stack.ts declares `Cloudflare.Container<ChromeContainer>` (standard-1, up to 10 instances) with that tag.
- Worker: `ChromeContainer` (apps/worker/src/browser/chrome.ts) on @cloudflare/containers; `ContainerDriver` (browser/driver.ts) drives its Chrome over a WebSocket CDP transport. One container per Robot and backend, named `container:<robot>`; closing the browser stops it, otherwise it sleeps after 5 minutes idle.
- First deploy note: a container can only be attached to a Durable Object namespace created as container-enabled; the class was renamed ChromeContainer and deployed twice (the first run creates the namespace, the second attaches).

## Live checks (2026-10-07)

- A Robot set to Container Chrome opened example.com, clicked "Learn more", took a screenshot; usage shows container minutes separately from Browser Run.
- Takeover: the live view streamed the container's page; taking over, scrolling and tapping "Learn more" navigated the real browser; handing back woke the Robot, which reported the new URL.
- After the Turn the container application reports 0 active instances.

## Four-site results (admin probe POST /api/admin/browser-probe, 2026-10-07 11:10–11:15)

Both backends leave from Cloudflare addresses (IP echo: Browser Run 104.28.161.181, Container 104.28.164.118).

| Site | Browser Run | Container Chrome |
|---|---|---|
| Allegro (listing "lego technic") | blocked: "You have been blocked" (DataDome) | blocked: "You have been blocked", naming IP 104.28.153.20 |
| eZUS login (zus.pl/ezus/logowanie) | pass: login form shown | blocked (silent): title "eZUS", empty page after 2.5 s and 15 s waits |
| Bank login: mBank (online.mbank.pl/pl/Login) | pass | pass |
| Bank login: PKO BP iPKO (ipko.pl) | pass | pass |
| Owner's invoicing service | not run: address needed from the owner | not run: address needed from the owner |

Allegro's cart flow (add to cart, stop before payment) could not be attempted on either backend: the first page is the block page. Without the bot signature Allegro still blocks Cloudflare addresses, which is what ticket 03 (Polish VPN address) is for.
