# 02: Google: guided OAuth client setup and Connect Google

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-fpyt, cn-aq2a, cn-lzqh, cn-j1la, cn-9s7r

**What to build:** A guided admin page for the one-time Google Cloud OAuth client (steps, callback URL, paste client id and secret); 'Connect Google' per Member with service choice at consent; refresh tokens in the vault, refreshed without the owner; re-consent surfaced with a one-click fix.

**Blocked by:** 01 Connector core, Plugins page, per-plugin settings rows

**Status:** in-progress

- [ ] Live: the owner completes the client setup and connects one account from the page
- [ ] Second account connects with different services
- [ ] Refresh works after token expiry without the owner
- [ ] Revoked token shows 'needs re-consent' and reconnect fixes it

## How it works

- **Admin page (Plugins → Google):** a step-by-step guide in Markdown, checked against Google's current Auth Platform help.
  - Steps: create the project, enable the six APIs (direct links), Get started, publish to *In production*, create a Web client with **this** deployment's callback URL, paste the ID and secret.
  - *In production* matters: in *Testing*, Google ends every sign-in after 7 days.
  - The client secret is sealed in the Home's vault; the form says only "Stored".
- **Connect Google:** `/api/connections/google/oauth/start?services=…` asks Google only for the scopes of the chosen services, with offline access and prompt=consent, so a refresh token is always issued; a one-time state expires after 15 minutes.
  - The callback exchanges the code, reads the account's address, and stores what Google actually granted. If the person unticks Drive on Google's screen, the connection lists only Gmail and Calendar.
  - Connecting the same address again updates that connection instead of adding a second.
- **Refresh without the owner:** each use checks the token's expiry (with a two-minute margin) and refreshes through the Member DO, one refresh at a time per connection.
- **Re-consent:** a refused refresh ("invalid_grant") or a 401 sets **Needs consent again** with Google's note. **Reconnect** starts the consent again for that account (login_hint) and repairs the same connection.

## Verified

- **google-connect.test.ts** (Robot/Member DOs through the API, Google answers recorded):
  - With no client set, Connect returns to the page with "has not set up the Google OAuth client", and the guide carries this deployment's callback URL.
  - The consent URL carries exactly the chosen scopes, offline and consent; the exchange sends code, client and redirect URI; the state works once.
  - A second account keeps its own services.
  - An expired token is refreshed for a Robot's call, and the service sees the new token.
  - A revoked refresh shows "needs-reconsent" and Reconnect repairs the same connection id.
- **Live (2026-10-08):** the Plugins → Google page with the guide and the real callback URL on the deployed app (![](img/02-google-guide.webp)).
- **Open, needs the owner:** the client setup in his Google Cloud, a first and a second account connected, a refresh after expiry, a revoke and reconnect. All four are in the batched questions.
