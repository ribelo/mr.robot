# 11: Exa tools with a Home key

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-cfvy, rb-x8i3, rb-a0x0, rb-pb26, rb-qm74

**What to build:** A plugin provides the Exa tools with the same names and schemas as the owner's desktop plugin (web search, crawling, code context) behind an 'Exa research' grant, and the agent-run tools behind a separate 'Exa agent runs' grant, using an Exa API key stored as a Home credential. Each call records its cost in usage and counts towards limits. New robots start with nothing granted.

**Blocked by:** None (can start immediately)

**Status:** in-progress

- [ ] With a key and the grant, a robot's search returns live Exa results
- [x] Without the agent-runs grant those tools are absent
- [x] Usage shows Exa calls and cost
- [x] Without a key the grant explains that the admin must add one

## How it works

- apps/worker/src/agent/exa.ts: web_search_exa, crawling_exa, get_code_context_exa (group "exa") and exa_agent_create_run / get_run / list_runs / list_events / cancel_run (group "exa-agent"), with the desktop plugin's names and parameters (read from its validation messages). They call api.exa.ai (/search, /contents, /context, /agent/runs) with the Home's key, stored sealed via Admin → Exa.
- Each call is counted in the Robot's usage ("N Exa calls" in the panel) with the cost Exa reports; an agent run's cost is counted once. Costs feed the spend limits.

## Verified

- Robot DO tests (exa.test.ts, Exa faked): search with the Home key returns results and records 1 call at $0.007; agent-run tools are absent without "exa-agent"; without a key the catalog note and the tool error say the admin must add one.
- Against the real Exa API from this machine with the owner's desktop key (kept in memory, not stored): search returned the Cloudflare Containers pricing pages ($0.007), crawl returned example.com ($0.001), code context returned Puppeteer docs, the agent run list answered.
- Live 2026-10-07 without a key: both groups carry the note "Needs the Home's Exa API key: the Home admin adds it under Admin → Exa."
- Not yet: a live Robot search, which needs an Exa key stored in the Home (owner's step).
