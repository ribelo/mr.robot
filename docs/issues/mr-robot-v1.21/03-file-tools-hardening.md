# 03: File tools on a Host: hash, line endings, idempotent writes, limits

**What to build:** Read returns size, line-ending style and hash; Write and Edit take expectedHash and an id, answer with the new hash, repeat an id's result; edit matches and writes in the file's style; the frame limit refuses with the copy advice; shared-root conflicts refuse and ask for a re-read (cw-jko0, cw-vwo1, cw-71bx, cw-6b3r, cw-1ov7).

**Blocked by:** 01

**Status:** done

- [x] Workerd test through the stub: read fields; a stale-hash write refused; CRLF edits; a repeated write id; the frame limit
- [x] Host Node tests for the handlers

## Closing note

Tests:
- apps/worker/test/host-file-tools.test.ts:
  - read shows `<size>`, `<line-ending>` and `<hash>` above the window.
  - Two Robots read one file and the second edits it. The first one's write is refused with STALE_CONTENT and the file stays. After a new read its edit goes through.
  - An edit given in LF lines changes a CRLF file and writes CRLF.
  - A write whose answer is cut off by a dropped link is sent again with the same id. The fake app answers from its memory: one write done, one answered.
  - A write over the frame limit is refused with the copy advice, and no Write reaches the app.
- apps/host/test/robot-files.test.ts: the real handlers read size, line ending and hash; a write with the hash read succeeds; a repeated id returns the stored answer without touching the file; a stale hash is refused with STALE_CONTENT.

Decisions:
- Protocol (backward compatible): Read answers `lineEnding` and `hash` (sha256 of the bytes, "sha256:<hex>"), optional for an older app. Write takes `expectedHash` and `id` and answers `hash`. lineEndingOf, contentHash, READ_MAX_FILE_BYTES (10 MB), WRITE_FRAME_MAX_BYTES (1 MiB) and STALE_CONTENT are in host-protocol, so the app, the Worker and the fake use one definition.
- There is no Edit RPC: edit stays read, replace in the Worker, write. The write of an edit names the hash its own read returned, so a change between them is refused. This gives cw-jko0 without a second write path on the app.
- The Worker keeps the hashes an agent read, per agent session (the Robot, each Subagent), keyed by Host and path from the current directory or the Robot's directory. A write or edit names the hash when the agent read that file; a file it never read is written as before, without a check. That keeps v1.16's behaviour for new files and for blind overwrites, and protects every edit. A successful write records its new hash, so the agent's next write passes. A delete forgets the hash. 500 hashes are kept per agent.
- On the app, the hash is compared just before the sandboxed write. A change in between those two steps is not caught (said in the code).
- Idempotency: each write gets a fresh id in the Worker. The app keeps the last 500 answers by id in HostShell, so they outlive a connection. HostHub sends a write whose answer was cut off (connection lost, or no answer while online) once more, after the Host is back within 30 s, with the same id. Every other call is still not retried.
- Line endings: replaceInStyle. In a CRLF file the old and new text are matched and written with CRLF. In a mixed file the text is tried as given first, then in CRLF. A text without a line break is matched as given. This applies on every place, R2 included, since the read window strips CR everywhere.
- Frame limit: the JSON-encoded content of a write to a Host must fit WRITE_FRAME_MAX_BYTES (1 MiB). The Worker refuses a bigger one before sending, with the advice to write to the Files and copy. The tool descriptions state the limits: a 2,000-line and 50 KiB read window, 10 MB per read, 1 MiB per write to a computer.

Review findings confirmed and fixed: #48 (clobbering writes on a shared root), #49 (a cut write had no defined outcome), #50 (limits not stated), #51 (CRLF edits failed). Accepted: binary files are still sent as base64 and cannot be edited; the frame limit counts the base64 text.
