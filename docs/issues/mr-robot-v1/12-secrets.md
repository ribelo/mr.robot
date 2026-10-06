# 12: Secrets vault and secret.get

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-vplt, robot-0bde, robot-4zi6

**What to build:** The Member stores site passwords in a vault; each secret is private or shared with the Home. A secret is granted to a robot like a tool; the robot calls secret.get(name) in code mode and uses the value; the value never appears in the trajectory, in chat or in robot messages.

**Blocked by:** 07 Code mode executor, tool grants, advanced settings

**Status:** done

- [x] Secrets encrypted at rest with the deploy key; plaintext only inside a turn
- [x] secret.get for an ungranted name fails
- [x] Trajectory and outbound robot messages show a mask where the value appeared
- [x] Home-shared secret is usable by another Member's robot once granted
