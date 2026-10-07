# 12: TOTP codes list beside logins

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories (postponed; spec Out of Scope)

**What to build:** A list of TOTP seeds, each granted per robot like a login entry, from which robots get current codes; the work is importing seeds from existing authenticator apps. Postponed because Polish banks and government use app confirmation or SMS.

**Blocked by:** 05 Login entries replacing secrets

**Status:** postponed

- [ ] Seed stored encrypted; code generated server-side; seed never shown to the robot
