# 06: Mr. Robot as steward

**What to build:** Mr. Robot's dream reads his Robots' notes through his deputy reads and proposes Member-file edits; no memory is moved between Robots; his dream tidies memory/people/ and INDEX.md (dm-pt5b, dm-w15l, dm-kkgy).

**Blocked by:** 04, 05

**Status:** done

- [x] Workerd test: the chief's dream proposes a Member-file edit from a Robot's note; no write into another Robot's files; the people tidy

## Closing note

apps/worker/test/chief-dream.test.ts: Seller writes a daily note and two pages of one person; Mr. Robot's dream lists Seller's note in its Wake-up, reads it with robot_file_read, proposes the memory/world.md edit (an Ask that waits for the owner), is refused robot_file_write and memory_write_shared, writes the merged page and deletes the duplicate; INDEX.md lists one page; Seller's MEMORY.md is untouched; Seller cannot delete a page.

Decisions:
- His dream's evidence also lists the daily notes his owner's Robots changed since the last dream, as "<name> (<id>): <path>"; they count for the skip rule.
- His dream's tools: the dream's set plus robot_files and robot_file_read (his deputy reads) and delete_file; never robot_file_write, and not memory_write_shared, so what follows from another Robot's note reaches the owner's files only as a proposal (dm-pt5b, dm-w15l). For that, Mr. Robot now has propose_member_file_edit too, beside memory_write_shared.
- The people tidy (dm-kkgy): Mr. Robot alone may delete a people page (to merge two pages of one person); its last version is kept in the history and INDEX.md is made again. Other Robots are refused with the reason.
