# 08: Person connections are never shared

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-bk91, ux-cop2, ux-dz8p, ux-ro7d

**What to build:** Connections that act as a person (Slack, Google) cannot be shared with the Home: the connector spec marks them, the UI shows no "Shared with the Home" checkbox for them, and the server refuses shared on create and update. A one-time migration unshares existing ones, revokes grants other Members' Robots held on them, puts a note on the owner's Connections section naming what changed and which Robots lost it, and tells the affected Robots at their next Turn. Discord bot, Provider accounts, Hosts and logins keep sharing.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] POST/PATCH refuse shared for Slack and Google (workerd test)
- [x] Migration unshares, revokes grants, queues the owner note and the Robot memory note (workerd test)
- [x] No checkbox for person connections; checkbox present for Discord bot (component test)
