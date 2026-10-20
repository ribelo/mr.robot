# 01: say

**What to build:** A Robot speaks to people only through a tool say (text, optional attachments by Workspace path or screenshot id, optional channel). Each call is one reply in the Conversation at once; assistant text stays in the Trajectory and is no longer a reply (gb-s81e, gb-6c8d, gb-wma6, gb-25jb). Image attachments render inside the message, other files as a card to open or download (gb-4wgm, gb-ekga). Every say goes out on the Channel the Wake-up came from, with the attachment when Discord can carry it, else a link; an explicit channel overrides (gb-s6lx, gb-jdzo). Subagent child presets have no say (gb-bdwb). Robots from before the upgrade keep their old replies: a per-Robot marker written at the upgrade makes the projection read assistant text before it and say after it (gb-psyl).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test: a say call makes a reply item at once; assistant text in the same Turn makes none; the same in direct mode (gb-s81e, gb-6c8d, gb-wma6, gb-25jb)
- [ ] Workerd test: attachments resolve to a Workspace file and a stored screenshot; a missing path fails the call with a clear error (gb-4wgm)
- [ ] Workerd test: each say of a Turn reaches the Channel route; an explicit channel overrides; a child has no say (gb-s6lx, gb-jdzo, gb-bdwb)
- [ ] Workerd test: an old session log renders replies from assistant text before the marker and from say after it (gb-psyl)
- [ ] Component test: a reply with an image inline and a file card (gb-ekga)
- [ ] Channel seam emits one reply output per say; Discord uploads a small attachment and links a large one (gb-s6lx)
