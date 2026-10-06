# 22: Trajectory view with DeepSeek Harness parity

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-3ioa, robot-cmz9, robot-gq88, robot-s54i, robot-gr94

**What to build:** The trajectory view is rebuilt to match the DSH web client's Trajectory tab (packages/client/ui-trajectory in the DSH checkout; screenshot docs/reference/07): a turn-aware ledger with User, Assistant, Tool and nested Subtool records, turn and step boundaries, the Duration/Turns/Calls timing overview, a record inspector (input, output, token usage, duration, images), search and backwards paging. Code-mode programs render as a Tool record with their tool calls nested as Subtools. The chat view shows tool activity as compact collapsed cards and a 'working on…' line, not raw event names. The DSH package is the reference implementation: port it, reuse its components where the client dependencies allow, do not invent a new design.

**Blocked by:** 10 Trajectory view and rewind

**Status:** ready-for-agent

- [ ] Ledger groups records by turn and step like the DSH view, with role badges and nested subtools
- [ ] Timing overview strip renders with Duration, Turns and Calls modes
- [ ] Inspector opens for every record with input, output, usage, duration and images
- [ ] Search filters the ledger; older pages load on demand
- [ ] Code-mode program and its calls appear nested; rewind control stays available per record
- [ ] Chat view shows collapsed tool cards instead of raw event names
