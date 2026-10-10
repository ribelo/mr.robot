# 01: Platform prompt: core, bridge, name, Mr. Robot role block, language rule

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-74ym, sk-5hes, sk-78g5, sk-yw30, sk-nitq, sk-d9dk, sk-xsat, sk-9sju, sk-9mvx, sk-jksr, sk-zktt, sk-9ekj, sk-a2yy

**What to build:** Every Robot gets the Muse-derived platform prompt: on a Claude subscription the required first line is followed by the bridge sentence naming the application and the Robot; the Robot's name comes from its configuration (Mr. Robot included); Mr. Robot's prompt carries the immutable role block (chief Robot, Chief of Staff); the core covers who you work for, discretion and alignment, how you work, initiative, memory discipline, date and time, context after compaction, writing style, the language rule (owner's language in replies and between Robots, English in files, USER.md overrides), tool rules, scheduled work, and which file is whose. Prompt sections registered by DSH plugins ("not shell commands like cat") are no longer rendered; the memory header names only the tools the Robot has. The prompt preview in Advanced settings shows all of it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Prompt preview shows the bridge on a Claude subscription and not elsewhere; the config name after a rename; Mr. Robot's role block unchanged after editing SOUL.md
- [ ] Core sections and the language rule present for every Robot; the memory header per Robot kind; no DSH plugin prompt text
- [ ] Workerd tests through the prompt preview endpoint for the above
