# 03: File tools on a Host: hash, line endings, idempotent writes, limits

**What to build:** Read returns size, line-ending style and hash; Write and Edit take expectedHash and an id, answer with the new hash, repeat an id's result; edit matches and writes in the file's style; the frame limit refuses with the copy advice; shared-root conflicts refuse and ask for a re-read (cw-jko0, cw-vwo1, cw-71bx, cw-6b3r, cw-1ov7).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test through the stub: read fields; a stale-hash write refused; CRLF edits; a repeated write id; the frame limit
- [ ] Host Node tests for the handlers
