# 01: The bounded-step helper and the snapshot plugin

**What to build:** One helper runs a bounded platform step with a tool allow-list, an instruction and a step limit; the idle plugins and the sweep are moved onto it; the snapshot plugin runs before every compaction with the contract in the spec, skipped without events, versioned by author snapshot, recorded in the Trajectory, costed under memory (dm-kg1p, dm-77dg, dm-tjlb, dm-r6km, dm-pifl).

**Blocked by:** None (can start immediately; needs v1.18 ticket 03 and v1.19 ticket 02 merged)

**Status:** ready-for-agent

- [ ] Workerd test: the snapshot before a mid-Turn and an idle compaction; tools and instruction; skip; versions; record; usage
- [ ] The sweep and idle plugins run on the helper with their tests green
- [ ] docs/memory-and-files.md carries the snapshot contract verbatim
