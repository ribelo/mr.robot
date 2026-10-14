# 05: Spend limits as types

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-dbx4, ux-q8ve, ux-ommv, ux-en86

**What to build:** Spend limits are typed values in the protocol: the Home's per-Robot and per-Member limits are No limit or An amount (integer USD, at least 1); a Robot's limit is the Home's, No limit or An amount. Nothing is null or zero with a meaning; existing values migrate (null → the Home's for a Robot, null → No limit for the Home, 0 → No limit). The forms are segmented controls with the amount field only for An amount. The Admin fleet table and the Robot's settings show the effective limit ("$20 (Home)", "no limit", "$50"), resolved by one function the spend check also uses.

**Blocked by:** 04 (Workers AI switch)

**Status:** done

- [x] Typed limits in the protocol; migration of null and 0 (workerd test)
- [x] Spend check, Admin table and settings view agree on the effective limit (workerd test)
- [x] Segmented controls in Home settings and Advanced settings; amount field only for An amount (component tests)
