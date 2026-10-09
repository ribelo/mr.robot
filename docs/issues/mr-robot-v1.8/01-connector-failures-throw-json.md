# 01: Connector failures throw; JSON results with account

**Parent:** mr-robot-v1.8 (../mr-robot-v1.8.md) — stories ts-jbep, ts-uy4d, ts-z0ip, ts-h8oy

**What to build:** A failed connector call (404, 401, rate limit, bad input) rejects, so a code-mode try/catch sees a ToolCallError with the current 'Failed: …' wording and reconnect hint. A success returns JSON { account, ...result } instead of a '[google · account]' text header. discord_accounts lists the services the bot grants. Every tool result is JSON; text-returning tools return structured values. web_fetch keeps returning the status on 404 and says so.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test with a 404 fixture: the connector tool call rejects; with a 200 fixture: JSON with account
- [ ] grep, glob and other text tools return arrays or { status, message }
- [ ] discord_accounts shows services; web_fetch description states the 404 behaviour
