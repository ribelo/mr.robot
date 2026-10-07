# 02: Chrome in Cloudflare Containers backend

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-d59c, rb-wn96, rb-690z

**What to build:** A new backend runs headless Chrome in a Cloudflare Container, one per robot browser session, driven over CDP from the Robot DO, sleeping when the browser closes. It carries no Web Bot Auth signature. Live view, takeover and cookie persistence work on it. An integration run against Allegro (open a listing, add to cart, stop before payment), the eZUS login page, one bank login page and the owner's invoicing service records pass / blocked / challenged in this ticket.

**Blocked by:** 01 Browser backend seam and per-robot backend choice

**Status:** ready-for-agent

- [ ] Container image declared in Alchemy and deployed
- [ ] A robot set to this backend opens, observes, acts and screenshots on the live deployment
- [ ] Takeover and live view work on it
- [ ] Results for the four sites recorded below this list
- [ ] Container sleeps after the browser closes; minutes appear in usage
