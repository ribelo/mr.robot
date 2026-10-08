# 01: Application state, API and live feed on Effect

**Parent:** mr-robot-v1.4 (../mr-robot-v1.4.md) — stories fe-2hh0, fe-tln3, fe-xp06, fe-4miu

**What to build:** Our own screens (robot list, conversation, panel, settings, admin, hosts, This computer, takeover) run on Effect Atom; API calls go through one Effect HttpClient layer decoded with Schema from the shared protocol; the live WebSocket is an Atom stream. Behaviour and look unchanged.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] No hand-written fetch or WebSocket remains in our own components
- [ ] Every screen checked live after deploy; screenshots match v1.3
- [ ] Existing web tests pass or are replaced where they were coupled to removed code
