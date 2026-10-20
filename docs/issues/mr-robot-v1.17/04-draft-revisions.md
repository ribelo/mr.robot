# 04: Draft revisions and 'this Robot sends on its own'

**What to build:** draft_revise replaces the body or subject of an open draft Ask and appends a revision; the card shows a word diff of the latest two versions and the history; 'This Robot sends on its own' raises the Connection's write grant to allow after a confirmation and sends; the grant settings lower it back; the prompt and the asking skill carry the draft rules (dp-5ixt, dp-o3st, dp-ef0p, dp-fjh7, dp-41yj).

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Workerd test: draft_revise appends a revision and the view carries both versions; sends-on-its-own raises the grant and approves; lowering restores ask (dp-5ixt, dp-o3st, dp-ef0p, dp-fjh7)
- [ ] Component test: the revision diff (dp-o3st)
- [ ] The asking skill and the prompt name when to draft and what gmail_draft is (dp-41yj)
