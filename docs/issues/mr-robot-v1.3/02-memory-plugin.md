# 02: Memory plugin: scopes, baseline injection, change notes, cache warming

**Parent:** mr-robot-v1.3 (../mr-robot-v1.3.md) — stories pl-w3n0, pl-9n7w, pl-552r, pl-o3ck, pl-fkg7, pl-yqno, pl-jsdm, pl-s2d5

**What to build:** Memory becomes a plugin with member, robot and Home scopes, injected as one baseline message within a byte budget, change notes delivered with the next turn when a file changed (owner, Mr. Robot, another robot), full refresh after compaction and on rewind, member and Home files writable by Mr. Robot and proposed by others. Anthropic cache warming for one hour at provider level.

**Blocked by:** 01 Capabilities as Cordis plugins mounted by grant

**Status:** done

- [x] Robot DO test: baseline message contains scoped files; a system prompt change does not occur on file edit
- [x] Owner edit in Files view → next turn carries a 'changed' note; after compaction the fresh file is in the baseline
- [x] Another robot's edit of USER.md is an ask, Mr. Robot's edit is direct
- [x] Budget truncation order verified
- [x] Cache warming observed on a live Anthropic turn within the hour

## How it works

- **Scopes** (apps/worker/src/agent/memory.ts):
  - Home: HOME.md, kept in the Home DO, edited in Admin → Home memory.
  - Member: USER.md, PROACTIVE_PREFERENCES.md and the new memory/world.md, edited in Profile → What your Robots know about you.
  - Robot: SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, MEMORY.md, memory/bank/experience.md, memory/bank/opinions.md, yesterday's and today's daily notes.
- **Memory plugin** (apps/worker/src/plugins/memory.ts, always mounted), modelled on DSH agent-instructions:
  - On agent/pre-step it folds one durable user message, framed in <system-reminder>, after the entering messages. It is the full baseline when the session has none (first step, after compaction, a new session after a rewind), otherwise a note "changed: X by Y" with the current content of each changed file.
  - The persona section is gone from the system prompt.
  - The message is a hidden platform message, so it stays out of the chat.
- **Change notes:** recorded per Robot when someone else changes a file it reads. Sources: the owner's edit in the Files view; the Member DO's writeFile, fanned out by the Home to every Robot of the Member except the writer; HOME.md, fanned out to every Robot.
- **Writes:** Mr. Robot gets memory_write_shared (direct). Other Robots get propose_member_file_edit for USER.md, PROACTIVE_PREFERENCES.md, memory/world.md and HOME.md (an ask; approval writes the file and notifies).
- **Budget:** 32 KiB. Ordered broad to specific (Home, member, robot, daily notes): broader files are dropped whole first, the most specific is truncated last, and a notice names them.
- **Prompt caching** (port of claude-subscription's long retention): the Anthropic adapter marks the system prompt, the last tool and the latest message as cache breakpoints with ttl 1h (beta extended-cache-ttl-2025-04-11), and counts cache writes in usage. Provider-level default, no UI.

## Verified

- **Robot DO tests** (memory.test.ts):
  - The baseline holds the HOME.md, USER.md and MEMORY.md content in a user message, not the system prompt.
  - After an owner edit the system prompt is byte-identical, and the next turn carries "changed: MEMORY.md by your owner" with the new text; one baseline only, nothing in the chat.
  - After compaction the fresh MEMORY.md is in a new baseline.
  - Another Robot's USER.md edit is an ask and has no direct tool; Mr. Robot's memory_write_shared writes it and another Robot then gets "changed: USER.md by Mr. Robot".
  - Budget order and limits.
  - The three earlier tests that asserted the old design (persona in the system prompt, the old edit-note wording, the preview section name) were updated to the new behaviour.
- **Adapter test:** cache_control ttl 1h on the system prompt, the last tool and the latest message; the beta header; cache read and write counted.
- **Live, Mr. Robot on Claude Sonnet** (the owner's subscription), 2026-10-07:

| Time | Cache read | Cache write |
|---|---|---|
| 22:04 first message | 0 | 27,969 |
| 22:05 | 27,969 | 20 |
| 22:09 | 27,989 | 20 |
| 22:18, 8 min 45 s after the last use (past Anthropic's 5-minute default) | 28,009 | 20 |
