# 10: Mr. Robot rights and defaults

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-b0rs, rb-axxy, rb-598m, rb-yagl

**What to build:** Mr. Robot holds every tool, every login entry the Member can reach and every skill without grants, edits global skills without approval, and for other robots can only propose grants (tools, logins, skills, recipients) that the Member approves. New and existing Mr. Robots get the default compaction instruction from the spec.

**Blocked by:** 05 Login entries replacing secrets; 09 Global and local skills, editable

**Status:** done

- [x] Robot DO test: Mr. Robot uses an ungranted tool and login
- [x] Mr. Robot's attempt to grant another robot produces an ask, not a grant
- [x] Existing Mr. Robots on the live deployment get the instruction unless already set

## How it works

- Mr. Robot's effective grants are every tool group (browser included), every login and every skill its owner can reach, refreshed at each Turn; its stored grants (what Advanced settings shows) are unchanged.
- `skill_write` on a library skill changes the library directly for Mr. Robot; other Robots are refused.
- `robot_propose_grants` (tools, skills, logins, recipients) puts an ask "Mr. Robot asks: …" in the target Robot's chat; nothing is granted until the owner approves there.
- New Mr. Robots get the spec's compaction instruction; an existing one gets it once on its first start after the deploy, unless one was already set.

## Verified

- Tests (mr-robot-rights.test.ts): Mr. Robot opens the browser and fills a login it was never granted, then signs in; its request for another Robot's web access is an ask in that Robot's chat and the grant stays absent; it edits a library skill directly; a new Mr. Robot has the instruction.
- Live 2026-10-07: the owner's existing Mr. Robot shows the default compaction instruction; with no stored login grants, login_list showed "herokuapp-demo"; asked to give Browser Check the notify group, it created "Mr. Robot asks: test of chief rights" in Browser Check's chat and Browser Check's tools stayed browser, secrets, skills (the test ask was then rejected).
