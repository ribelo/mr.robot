# 08: Robot e-mail address (design only)

**Parent:** mr-robot-v1.6 (../mr-robot-v1.6.md) — stories —

**What to build:** Each Robot gets an address <robot>.<member>@<home domain>. Cloudflare Email Routing sends every address of the domain to an Email Worker that parses the local part and wakes the Robot through a mail Channel with the parsed message (sender, subject, text, attachments into the Workspace). Outbound through a transactional provider (Resend or equivalent) with the Robot's address as sender. Needs a domain the owner owns on Cloudflare.

**Blocked by:** None

**Status:** postponed

- [ ] Owner buys and adds a domain to the Cloudflare account
- [ ] Email Routing catch-all → Email Worker → Robot wake-up
- [ ] Outbound provider key in the Home settings; tool mail_send behind a write grant

## Notes

Postponed by the owner on 2026-10-09: he is curious, not insisting. Until then robots use Gmail through the Google connector; plus-addressing (owner+robot@gmail.com) gives a per-robot inbox with no infrastructure.
