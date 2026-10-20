# 11: Tasks triggered by external events (postponed; its own spec)

**What to build:** A Task whose Timing is an event with a filter, not a moment: a Discord reaction or mention, a webhook whose payload matches, later a Gmail message from an address. Only Mr. Robot's own Connectors; no MCP. Agreed in the grill session of 2026-10-20 (v1.15) as a separate spec, first Discord and the webhook Channel because they already wake Robots, then Gmail. Grok Bot's listener shapes (Slack mention/keyword/reaction with bySelf, GitHub events with user allowlist and ciBranch) are the reference; an event-driven watch deletes itself after its matching event.

**Blocked by:** None (needs its own spec first)

**Status:** postponed
