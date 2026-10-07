# 02: Memory plugin: scopes, baseline injection, change notes, cache warming

**Parent:** mr-robot-v1.3 (../mr-robot-v1.3.md) — stories pl-w3n0, pl-9n7w, pl-552r, pl-o3ck, pl-fkg7, pl-yqno, pl-jsdm, pl-s2d5

**What to build:** Memory becomes a plugin with member, robot and Home scopes, injected as one baseline message within a byte budget, change notes delivered with the next turn when a file changed (owner, Mr. Robot, another robot), full refresh after compaction and on rewind, member and Home files writable by Mr. Robot and proposed by others. Anthropic cache warming for one hour at provider level.

**Blocked by:** 01 Capabilities as Cordis plugins mounted by grant

**Status:** ready-for-agent

- [ ] Robot DO test: baseline message contains scoped files; a system prompt change does not occur on file edit
- [ ] Owner edit in Files view → next turn carries a 'changed' note; after compaction the fresh file is in the baseline
- [ ] Another robot's edit of USER.md is an ask, Mr. Robot's edit is direct
- [ ] Budget truncation order verified
- [ ] Cache warming observed on a live Anthropic turn within the hour
