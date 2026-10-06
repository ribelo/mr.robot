# 22: Trajectory view with DeepSeek Harness parity

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-3ioa, robot-cmz9, robot-gq88, robot-s54i, robot-gr94

**What to build:** The trajectory view is rebuilt to match the DSH web client's Trajectory tab (packages/client/ui-trajectory in the DSH checkout; screenshot docs/reference/07): a turn-aware ledger with User, Assistant, Tool and nested Subtool records, turn and step boundaries, the Duration/Turns/Calls timing overview, a record inspector (input, output, token usage, duration, images), search and backwards paging. Code-mode programs render as a Tool record with their tool calls nested as Subtools. The chat view shows tool activity as compact collapsed cards and a 'working on…' line, not raw event names. The DSH package is the reference implementation: port it, reuse its components where the client dependencies allow, do not invent a new design.

**Blocked by:** 10 Trajectory view and rewind

**Status:** in-progress

- [x] Ledger groups records by turn and step like the DSH view, with role badges and nested subtools
- [x] Timing overview strip renders with Duration, Turns and Calls modes
- [x] Inspector opens for every record with input, output, usage, duration and images
- [x] Search filters the ledger; older pages load on demand
- [x] Code-mode program and its calls appear nested; rewind control stays available per record
- [x] Chat view shows collapsed tool cards instead of raw event names

Verified 2026-10-07 on the live deployment: Mr. Robot's trajectory renders through DSH's own ui-trajectory code (copied into apps/web/src/dsh, MIT) and ui-conversation assembler: turn ledger, Duration/Turns/Calls strip, inspector with Summary/Code/Result/Schema/Timing, the code-mode program with routine_create nested under it. Tests: apps/web robot-trajectory.test.tsx (a real anonymized session), code-mode-chat.test.ts.

Differences from the DSH client: rewind is per Turn from a "Rewind…" sheet next to the view (DSH's view has no rewind); images in records are not shown because Robots do not store image attachments.

Reopened 2026-10-07 by the story verification (verification.md): stories 95 (no images), 96 (search not tried live).
