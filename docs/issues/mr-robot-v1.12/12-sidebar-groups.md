# 12: Sidebar groups

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-wxbm, ux-o7po, ux-xbvi, ux-0qjq, ux-sj2f, ux-dice, ux-x62j, ux-oltg, ux-gieb, ux-lywk

**What to build:** A Member sorts the Robots they reach into named groups of their own: create, rename, reorder, delete (its Robots return to the ungrouped list), collapse with the state remembered. A Robot moves by drag and drop in the sidebar (HTML drag API, no library) or by "Move to…" in its menu. "Hidden" is a built-in collapsed group at the bottom; pinned Robots stay on top of their group; unread marks are unchanged; search finds Robots across collapsed groups and shows the group name. Groups and the per-Robot group live in the Member's list preferences; a Robot that is deleted or leaves reach is dropped from its group.

**Blocked by:** 03 (Avatars)

**Status:** ready-for-agent

- [ ] Group preferences round trip and cleanup on lost reach (workerd test)
- [ ] Create, rename, collapse, move by menu, drag, hidden group, pinned order, search across groups (component tests)
- [ ] Another Member sees their own groups
