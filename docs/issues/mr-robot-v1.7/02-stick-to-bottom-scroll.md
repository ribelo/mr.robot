# 02: Stick-to-bottom scrolling with jump to latest

**Parent:** mr-robot-v1.7 (../mr-robot-v1.7.md) — stories ap-iyej, ap-8rui, ap-oe45

**What to build:** The Conversation follows new items and streamed text only while the reader is at the bottom (small threshold). Scrolled up, a floating '↓ N new' button counts new messages; clicking it scrolls down and re-arms following. Works with the windowed row renderer.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Component test: stream growth does not move the scroll position when scrolled up; it does when at bottom
- [ ] Button appears with the count and disappears at bottom
- [ ] Works on a 2000-item conversation (windowed)
