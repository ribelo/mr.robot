# 02: Google: guided OAuth client setup and Connect Google

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-fpyt, cn-aq2a, cn-lzqh, cn-j1la, cn-9s7r

**What to build:** A guided admin page for the one-time Google Cloud OAuth client (steps, callback URL, paste client id and secret); 'Connect Google' per Member with service choice at consent; refresh tokens in the vault, refreshed without the owner; re-consent surfaced with a one-click fix.

**Blocked by:** 01 Connector core, Plugins page, per-plugin settings rows

**Status:** ready-for-agent

- [ ] Live: the owner completes the client setup and connects one account from the page
- [ ] Second account connects with different services
- [ ] Refresh works after token expiry without the owner
- [ ] Revoked token shows 'needs re-consent' and reconnect fixes it
