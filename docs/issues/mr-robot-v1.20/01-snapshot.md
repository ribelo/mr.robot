# 01: The bounded-step helper and the snapshot plugin

**What to build:** One helper runs a bounded platform step with a tool allow-list, an instruction and a step limit; the idle plugins and the sweep are moved onto it; the snapshot plugin runs before every compaction with the contract in the spec, skipped without events, versioned by author snapshot, recorded in the Trajectory, costed under memory (dm-kg1p, dm-77dg, dm-tjlb, dm-r6km, dm-pifl).

**Blocked by:** 00

**Status:** done

- [x] Workerd test: the snapshot before a mid-Turn and an idle compaction; tools and instruction; skip; versions; record; usage
- [x] The sweep and idle plugins run on the helper with their tests green
- [x] docs/memory-and-files.md carries the snapshot contract verbatim

## Closing note

apps/worker/test/snapshot.test.ts: in a Turn, pressure puts the compaction off, the instruction reaches the model, three steps run with say and a Box write refused, then the compaction and the Turn's reply; the note and MEMORY.md are versions by the snapshot, the record names them, memory tokens are booked. Idle: snapshot, then sweep, then compaction, with the spec's instruction; skipped when nothing happened since. idle.test.ts and memory-sweep.test.ts script the snapshot step before the sweep.

Decisions:
- The trigger in a Turn: compaction.ts overrides compactIfNeeded and compactRegion, so the Robot is asked exactly when DSH has decided that pressure compacts, before it summarises; once per decision (DSH's own retries do not ask again); never for an overflow. A true answer puts the compaction off; the next step boundary asks again.
- The snapshot cannot stop a Turn, so it is a steer with the instruction, and its three steps count from the first request that carries it (a steer reaches the model one step after the boundary). While it runs, the step fence allows only read, write, edit, glob and grep, with on "workspace", and the Workspace writes are by the snapshot. The in-Turn instruction ends "You have 3 steps for it; then go on with your work." instead of "Then end.", which would end the person's Turn. The idle instruction is the spec's, word for word.
- Once per compaction: after a snapshot the compaction it was for is not put off again, until a compaction runs. No snapshot starts inside another platform step (the safety net, an idle step): that step has its own instruction and limit, and the compaction goes ahead.
- Skip: a memory mark (session and stored length) set after a snapshot or sweep and when a chapter opens (its seed is not an event).
- Usage: UsageSource memory, a line under Model in the cost breakdown. An in-Turn snapshot's events are booked as memory by the Turn's accounting (the stored ranges); the idle snapshot and the sweep book memory through platformStep; the compaction stays robot.
- Moved onto platformStep too: the Save as definition scrub (now with the Workspace file tools only, booked as robot; it was not booked before).
- docs/memory-and-files.md has the contract; to stay under 900 words, the Files view and tmp/ lines were shortened.
