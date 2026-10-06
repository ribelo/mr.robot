# 05: Workspace in R2, persona files, basic tools

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-jlzk, robot-om9f, robot-h1nm, robot-mj7v, robot-jpzp, robot-zzif, robot-sw54, robot-8pqy, robot-o6lf, robot-scwl

**What to build:** Every robot has a workspace in R2 with the Muse persona files seeded at creation (SOUL, IDENTITY, AGENTS, TOOLS, MEMORY, daily notes) and the Member's USER.md and PROACTIVE_PREFERENCES.md mounted read-only. The robot edits its files with read/write/edit/glob/grep over R2, tells the Member when SOUL.md changes, proposes edits to the Member files as a question, and can fetch and search the web. Files attached in the chat land in the workspace. The robot's compaction instruction and context budget are settings that compaction honours.

**Blocked by:** 03 A Robot Durable Object runs one turn

**Status:** ready-for-agent

- [ ] A new robot's workspace contains the seeded files; USER.md edits by the robot are refused and surface as a proposal
- [ ] File tools operate only inside the robot's R2 prefix
- [ ] Attachment sent in chat is readable by the robot
- [ ] Compaction uses the robot's instruction and triggers at the robot's budget
- [ ] SOUL.md change produces a message to the Member
