# 11: Web Push and notification settings

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-lzu3, robot-7v9s, robot-6nkv, robot-6jqh

**What to build:** The Member installs the PWA and allows notifications; each device registers a push subscription in the Member DO. Robots notify on finished, needs you (takeover, grant proposal, question) and blocked. Per-robot notifications can be switched off in the panel. The robot reads PROACTIVE_PREFERENCES.md before composing and the platform enforces the Member's quiet hours.

**Blocked by:** 04 Robot creation interview, grant approval, Mr. Robot bootstrap

**Status:** done

- [x] Subscription stored per device; removal on unsubscribe
- [x] Each event kind produces one push with a deep link to the conversation
- [x] Robot with notifications off sends none
- [x] An event inside quiet hours is delivered at their end
