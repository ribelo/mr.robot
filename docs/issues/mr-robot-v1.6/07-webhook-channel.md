# 07: Webhook Channel

**Parent:** mr-robot-v1.6 (../mr-robot-v1.6.md) — stories cd-pqt8, cd-q7mc, cd-s07d

**What to build:** Each Robot has a webhook address and a secret key shown in its settings with Regenerate. POST /hooks/<robotId>/<key> with a JSON or text body up to 64 KB wakes the Robot once (Idempotency-Key header deduplicates) with the body and content type quoted in the Wake-up. A wrong key answers 401 and an oversized body 413 without waking the Robot. The route is exempt from the Access check because the key is its credential.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Settings show the address and key with Regenerate (owner), and the deputy can regenerate too once ticket 03 lands (not required here)
- [x] Edge tests: good key wakes once with the same Idempotency-Key, wrong key 401, 70 KB body 413
- [x] Replies of a webhook-woken Turn behave like a Routine's: app plus opted-in Channels
