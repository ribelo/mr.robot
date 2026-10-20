# 09: host_copy

**What to build:** A tool host_copy copies a file between a granted Host and the Workspace in either direction, binary-safe, streamed over the Host channel without passing through the model, under the Host's file Grant and a 100 MB cap (gb-iw01, gb-rvj5). A copy into the Workspace under box/ reaches the Box at its next boot (gb-mcnc).

**Blocked by:** 06

**Status:** done

- [x] Workerd test with the Host stub: a binary file copied each way is byte-equal; a file over the cap is refused with the reason; a Host without the file Grant refuses (gb-iw01, gb-rvj5)
- [x] Workerd test: a file copied under box/ is in the Box stub after boot (gb-mcnc)
- [x] The Host app streams the copy in chunks; the result names both paths and the size
