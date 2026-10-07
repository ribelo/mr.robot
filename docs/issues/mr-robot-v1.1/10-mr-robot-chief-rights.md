# 10: Mr. Robot rights and defaults

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-b0rs, rb-axxy, rb-598m, rb-yagl

**What to build:** Mr. Robot holds every tool, every login entry the Member can reach and every skill without grants, edits global skills without approval, and for other robots can only propose grants (tools, logins, skills, recipients) that the Member approves. New and existing Mr. Robots get the default compaction instruction from the spec.

**Blocked by:** 05 Login entries replacing secrets; 09 Global and local skills, editable

**Status:** ready-for-agent

- [ ] Robot DO test: Mr. Robot uses an ungranted tool and login
- [ ] Mr. Robot's attempt to grant another robot produces an ask, not a grant
- [ ] Existing Mr. Robots on the live deployment get the instruction unless already set
