# 10: External text is fenced

**What to build:** Tools that bring text from outside (web_fetch, every Exa tool, gmail_search, gmail_thread, gmail_attachment, Slack and Discord reads, browser_observe) declare external: true; their rendered text result is wrapped in <external source="<tool>"> … </external> with any closing marker inside the content made harmless (gb-75j6). Results of files, Tasks, Hosts and the Box are not fenced (gb-d0d4). The prompt's tools section says what the fence means (gb-1dxb).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test: a web_fetch and a gmail_thread result are fenced with the source; a read of a Workspace file and a box_run result are not (gb-75j6, gb-d0d4)
- [ ] Workerd test: a result containing the closing marker comes out with the marker rewritten (gb-75j6)
- [ ] The fence rule is in the prompt's tools section (gb-1dxb)
