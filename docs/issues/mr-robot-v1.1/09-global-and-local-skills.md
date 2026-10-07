# 09: Global and local skills, editable

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-a70a, rb-dkt1, rb-kkqu, rb-krq2, rb-lqwr, rb-5ku3, rb-t937

**What to build:** The Home library starts empty with no sync source; the anthropics/skills source and its skills are removed from the live deployment. Global skills (Home) and local skills (robot workspace) are separate: robots read granted global skills read-only, create and edit their own local skills, and propose a local skill for the global library as an ask. Every skill opens in an editor in the UI; create and delete for both kinds. An optional sync source keeps the owner's edits across syncs.

**Blocked by:** 08 Files view for workspace and memory

**Status:** ready-for-agent

- [ ] Live deployment has no skills and no sync source after migration
- [ ] Robot DO test: robot edits its local skill; editing a global skill is refused
- [ ] Promotion ask approved puts the skill in the library
- [ ] UI edits to a synced skill survive the next sync
